/**
 * Settings screen — Phase E full implementation.
 * AI feature toggles, Guest Mode banner, budget start day picker,
 * categories manager, CSV export via native Share, and data reset.
 */
import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Switch,
  Pressable,
  Alert,
  Share,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  ChevronRight,
  WifiOff,
  Check,
  X,
  Plus,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget } from '@/theme';
import { Text, Divider, Button } from '@/components';
import { activateGuestStore, useFinancerStore } from '@/data/local/store';
import { currentUser, signOut, hasSession } from '@/data/remote/api';
import { startSyncService, stopSyncService, syncNow } from '@/data/remote/sync';
import { useSyncStatus } from '@/lib/sync-status';
import { useToastStore } from '@/lib/toast-store';
import { CategoryType } from '@/engine/types';

function SettingRow({
  label,
  value,
  subtitle,
  disabled,
  onPress,
}: {
  label: string;
  value?: string;
  subtitle?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={[styles.row, disabled && { opacity: 0.6 }]}
      onPress={disabled ? undefined : onPress}
      disabled={!onPress || disabled}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {subtitle ? <Text variant="caption" color={Colors.muted}>{subtitle}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        {value && <Text variant="body" color={Colors.text2}>{value}</Text>}
        {onPress && !disabled && <ChevronRight size={16} color={Colors.muted} />}
      </View>
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onToggle,
  subtitle,
}: {
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  subtitle?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.toggleLabel}>
        <Text variant="body">{label}</Text>
        {subtitle && <Text variant="caption" color={Colors.muted}>{subtitle}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: Colors.surface2, true: Colors.accent }}
        thumbColor={Colors.text}
        accessibilityLabel={label}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const aiEnabled = useFinancerStore((s) => s.aiEnabled);
  const aiFeatureToggles = useFinancerStore((s) => s.aiFeatureToggles);
  const budgetStartDay = useFinancerStore((s) => s.budgetStartDay);
  const setAIEnabled = useFinancerStore((s) => s.setAIEnabled);
  const setAIFeatureToggle = useFinancerStore((s) => s.setAIFeatureToggle);
  const setBudgetStartDay = useFinancerStore((s) => s.setBudgetStartDay);
  const categories = useFinancerStore((s) => s.categories);
  const addCategory = useFinancerStore((s) => s.addCategory);
  const removeCategory = useFinancerStore((s) => s.removeCategory);
  const transactions = useFinancerStore((s) => s.transactions);
  const loadDemoData = useFinancerStore((s) => s.loadDemoData);
  const resetAll = useFinancerStore((s) => s.resetAll);

  const syncStatus = useSyncStatus((s) => s.status);
  const syncMessage = useSyncStatus((s) => s.message);
  const lastSyncedAt = useSyncStatus((s) => s.lastSyncedAt);
  const showToast = useToastStore((s) => s.showToast);
  const user = currentUser();

  function formatSyncTime(iso?: string): string {
    if (!iso) return 'Not synced in this session';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 30) return 'Last synced: Just now';
    if (diff < 60) return `Last synced: ${diff}s ago`;
    if (diff < 3600) return `Last synced: ${Math.floor(diff / 60)}m ago`;
    return `Last synced: ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Modals state
  const [isDayPickerOpen, setIsDayPickerOpen] = useState(false);
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<CategoryType>('variable');

  // Guest Mode banner; connectivity remains a separate network state.
  const isGuestMode = !hasSession();

  // CSV Export handler
  const handleExportCSV = async () => {
    if (transactions.length === 0) {
      showToast({ message: 'No transactions to export' });
      return;
    }

    const headers = [
      'ID',
      'Date',
      'Time',
      'Place',
      'Amount_INR',
      'Category',
      'Payment_Mode',
      'Note',
      'Provenance',
    ];

    const rows = transactions.map((t) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      const rupees = (t.amount / 100).toFixed(2);
      const escape = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
      return [
        t.id,
        t.date,
        t.time,
        escape(t.place),
        rupees,
        escape(cat?.name ?? t.categoryId),
        t.paymentMode,
        escape(t.note),
        t.provenance,
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');

    try {
      await Share.share({
        title: 'financer_transactions.csv',
        message: csvContent,
      });
      showToast({ message: `Exported ${transactions.length} transactions as CSV` });
    } catch {
      showToast({ message: 'Could not export CSV' });
    }
  };

  const handleLoadDemoData = () => {
    Alert.alert(
      'Load Demo Data?',
      'This will populate 60 realistic transactions across the last 2 months, a budget, and a group bill.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load Demo',
          onPress: () => {
            loadDemoData();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showToast({ message: 'Demo data loaded successfully' });
          },
        },
      ]
    );
  };

  const handleResetAll = () => {
    Alert.alert(
      'Reset All Data?',
      'This will permanently delete all your transactions, budgets, splits, and custom categories. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Everything',
          style: 'destructive',
          onPress: () => {
            resetAll();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            showToast({ message: 'All data has been reset' });
          },
        },
      ]
    );
  };

  const handleAddCategory = () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    const catColors = ['#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#009688', '#FF9800'];
    const randomColor = catColors[Math.floor(Math.random() * catColors.length)];

    addCategory({
      name: trimmed,
      type: newCatType,
      color: randomColor,
      icon: 'Tag',
      isArchived: false,
      sortOrder: categories.length,
    });

    setNewCatName('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text variant="bodySemiBold">Settings</Text>
        <View style={{ width: TouchTarget }} />
      </View>

      {/* Guest Mode Banner */}
      {isGuestMode && (
        <View style={styles.offlineBanner}>
          <WifiOff size={16} color={Colors.muted} />
          <Text variant="caption" color={Colors.text2} style={{ flex: 1 }}>
            Guest Mode: data stays on this device and is not automatically synced to an account.
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Budget */}
        <Text variant="captionBold" color={Colors.muted} style={styles.sectionLabel}>
          BUDGET
        </Text>
        <View style={styles.section}>
          <SettingRow
            label="Budget start day"
            value={`${budgetStartDay}${ordinal(budgetStartDay)} of month`}
            onPress={() => setIsDayPickerOpen(true)}
          />
          <Divider />
          <SettingRow
            label="Categories"
            value={`${categories.length} categories`}
            onPress={() => setIsCategoriesModalOpen(true)}
          />
        </View>

        {/* AI Assistant */}
        <Text variant="captionBold" color={Colors.muted} style={styles.sectionLabel}>
          AI ASSISTANT
        </Text>
        <View style={styles.section}>
          <ToggleRow
            label="AI features"
            value={aiEnabled}
            onToggle={setAIEnabled}
            subtitle="Master toggle for all AI functionality"
          />
          {aiEnabled && (
            <>
              <Divider />
              <ToggleRow
                label="Entry parsing"
                value={aiFeatureToggles.entryParsing}
                onToggle={(v) => setAIFeatureToggle('entryParsing', v)}
                subtitle="Natural language text parsing"
              />
              <Divider />
              <ToggleRow
                label="Auto-categorisation"
                value={aiFeatureToggles.categorization}
                onToggle={(v) => setAIFeatureToggle('categorization', v)}
                subtitle="Auto-suggest category from place"
              />
              <Divider />
              <ToggleRow
                label="Split drafting"
                value={aiFeatureToggles.splitDrafting}
                onToggle={(v) => setAIFeatureToggle('splitDrafting', v)}
                subtitle="Parse group bills into split drafts"
              />
              <Divider />
              <ToggleRow
                label="Budget suggestions"
                value={aiFeatureToggles.budgetSuggestions}
                onToggle={(v) => setAIFeatureToggle('budgetSuggestions', v)}
                subtitle="Propose allocations from history"
              />
              <Divider />
              <ToggleRow
                label="Monthly summaries"
                value={aiFeatureToggles.summaries}
                onToggle={(v) => setAIFeatureToggle('summaries', v)}
                subtitle="AI narrative card in Insights"
              />
            </>
          )}
        </View>

        {/* Data */}
        <Text variant="captionBold" color={Colors.muted} style={styles.sectionLabel}>
          DATA
        </Text>
        <View style={styles.section}>
          <SettingRow
            label="Export as CSV"
            value={`${transactions.length} txns`}
            onPress={handleExportCSV}
          />
          <Divider />
          <SettingRow label="Load demo data" onPress={handleLoadDemoData} />
        </View>

        {/* Account & Sync */}
        <Text variant="captionBold" color={Colors.muted} style={styles.sectionLabel}>
          ACCOUNT & STORAGE
        </Text>
        <View style={styles.section}>
          <SettingRow
            label="Account"
            value={user?.email ?? 'Guest Mode · local data'}
            onPress={() => router.push('/(auth)/welcome')}
          />
          {user && (
            <>
              <Divider />
              <SettingRow
                label="Sync now"
                value={
                  syncStatus === 'syncing'
                    ? 'Syncing…'
                    : syncStatus === 'error'
                    ? 'Needs attention'
                    : 'Up to date'
                }
                subtitle={formatSyncTime(lastSyncedAt)}
                disabled={syncStatus === 'syncing'}
                onPress={() => {
                  startSyncService((status, message) =>
                    useSyncStatus.getState().setStatus(status, message)
                  );
                  void syncNow(true);
                }}
              />
              {syncMessage ? (
                <View style={styles.syncError}>
                  <Text variant="caption" color={Colors.overBudget}>
                    {syncMessage}
                  </Text>
                </View>
              ) : null}
              <Divider />
              <SettingRow
                label="Sign out"
                onPress={() => {
                  stopSyncService();
                  void signOut().finally(() => {
                    useSyncStatus.getState().setStatus('idle');
                    router.replace('/(auth)/welcome');
                    void activateGuestStore();
                  });
                }}
              />
            </>
          )}
          <Divider />
          <SettingRow label="Reset all data" onPress={handleResetAll} />
        </View>

        <Text variant="caption" color={Colors.muted} center style={styles.version}>
          Financer v1.0.0 · Data stored locally on device
        </Text>
      </ScrollView>

      {/* Budget Start Day Modal */}
      <Modal
        visible={isDayPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setIsDayPickerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <View style={styles.dialogHeader}>
              <Text variant="bodySemiBold">Select Budget Start Day</Text>
              <Pressable
                onPress={() => setIsDayPickerOpen(false)}
                hitSlop={8}
                style={styles.dialogCloseBtn}
              >
                <X size={18} color={Colors.text2} />
              </Pressable>
            </View>

            <Text variant="caption" color={Colors.text2} style={{ marginBottom: Spacing.sm }}>
              Choose which day of the month your monthly budget cycle starts (1 to 28).
            </Text>

            <View style={styles.dayGrid}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => {
                const isSelected = day === budgetStartDay;
                return (
                  <Pressable
                    key={day}
                    style={[
                      styles.dayGridItem,
                      isSelected && styles.dayGridItemSelected,
                    ]}
                    onPress={() => {
                      setBudgetStartDay(day);
                      setIsDayPickerOpen(false);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    <Text
                      variant="label"
                      color={isSelected ? Colors.text : Colors.text2}
                    >
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* Categories Management Modal */}
      <Modal
        visible={isCategoriesModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsCategoriesModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.dialogHeader}>
              <Text variant="bodySemiBold">Manage Categories</Text>
              <Pressable
                onPress={() => setIsCategoriesModalOpen(false)}
                hitSlop={8}
                style={styles.dialogCloseBtn}
              >
                <X size={18} color={Colors.text2} />
              </Pressable>
            </View>

            {/* Add Category Row */}
            <View style={styles.addCatRow}>
              <TextInput
                style={styles.catInput}
                placeholder="Category name (e.g. Gym)"
                placeholderTextColor={Colors.muted}
                value={newCatName}
                onChangeText={setNewCatName}
              />
              <Pressable
                style={styles.addCatBtn}
                onPress={handleAddCategory}
                disabled={!newCatName.trim()}
              >
                <Plus size={18} color={newCatName.trim() ? Colors.text : Colors.muted} />
              </Pressable>
            </View>

            {/* Categories List */}
            <ScrollView
              style={{ maxHeight: 340 }}
              contentContainerStyle={{ gap: Spacing.xs }}
              showsVerticalScrollIndicator={false}
            >
              {categories.map((cat) => (
                <View key={cat.id} style={styles.catItemRow}>
                  <View style={styles.catItemLeft}>
                    <View style={[styles.catColorDot, { backgroundColor: cat.color }]} />
                    <Text variant="body">{cat.name}</Text>
                    <View style={styles.typeBadge}>
                      <Text variant="caption" color={Colors.muted}>
                        {cat.type}
                      </Text>
                    </View>
                  </View>

                  {categories.length > 3 && (
                    <Pressable
                      onPress={() => removeCategory(cat.id)}
                      hitSlop={8}
                      style={{ padding: 4 }}
                    >
                      <Trash2 size={16} color={Colors.muted} />
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ordinal(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  backBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  scroll: {
    padding: Spacing.base,
    gap: Spacing.sm,
    paddingBottom: 60,
  },
  sectionLabel: {
    letterSpacing: 0.8,
    marginTop: Spacing.sm,
    marginBottom: 2,
    marginLeft: 2,
  },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    minHeight: TouchTarget,
    paddingVertical: Spacing.sm,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  toggleLabel: {
    flex: 1,
    gap: 2,
  },
  version: {
    marginTop: Spacing.xl,
  },
  syncError: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.base,
  },
  modalDialog: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.base,
  },
  dialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  dialogCloseBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  dayGridItem: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  dayGridItemSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accentLight,
  },
  addCatRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'center',
  },
  catInput: {
    flex: 1,
    height: TouchTarget,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  addCatBtn: {
    width: TouchTarget,
    height: TouchTarget,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
  },
  catItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  catColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  typeBadge: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
});
