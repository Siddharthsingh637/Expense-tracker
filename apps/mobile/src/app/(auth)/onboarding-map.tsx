import { router } from 'expo-router';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Check, X, Plus, Sparkles, RotateCcw, Trash2 } from 'lucide-react-native';

import { Colors, Spacing, Radius, FontSize, TouchTarget, Fonts } from '@/theme';
import { Text, Button, AmountText, Divider, Chip } from '@/components';
import { usePaisaStore } from '@/data/local/store';
import { formatMoney, rupeesToPaise } from '@/lib/format';
import { allocate } from '@/engine/allocate';
import { BUDGET_TEMPLATES } from '@/lib/constants';

export default function OnboardingMapScreen() {
  const categories = usePaisaStore((s) => s.categories);
  const monthBudgets = usePaisaStore((s) => s.monthBudgets);
  const setBudgetAllocation = usePaisaStore((s) => s.setBudgetAllocation);
  const addCategory = usePaisaStore((s) => s.addCategory);
  const removeCategory = usePaisaStore((s) => s.removeCategory);
  const completeOnboarding = usePaisaStore((s) => s.completeOnboarding);

  const currentMonth = usePaisaStore((s) => s.currentMonth);
  const latestBudget =
    monthBudgets.find((b) => b.month === currentMonth) ??
    monthBudgets[monthBudgets.length - 1];
  const totalPaise = latestBudget?.totalPaise ?? 0;

  // IMPORTANT: Distribution is NOT pre-made. Starts completely at ₹0 so the
  // user enters their own individual spending pattern.
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  // Direct editing modal state for a specific category
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [inputRupees, setInputRupees] = useState('');

  // Add custom category modal state
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const allocated = Object.values(allocations).reduce((s, v) => s + v, 0);
  const unallocated = totalPaise - allocated;
  const isOverAllocated = unallocated < 0;

  // Step adjustment (+ / -)
  function adjustAllocation(catId: string, deltaPaise: number) {
    setAllocations((prev) => {
      const current = prev[catId] ?? 0;
      const next = Math.max(0, current + deltaPaise);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[catId];
        return copy;
      }
      return { ...prev, [catId]: next };
    });
    Haptics.selectionAsync();
  }

  // Open direct numeric editor for a category
  function openCategoryEditor(catId: string) {
    setEditingCatId(catId);
    const currentPaise = allocations[catId] ?? 0;
    setInputRupees(currentPaise > 0 ? String(currentPaise / 100) : '');
    Haptics.selectionAsync();
  }

  // Save direct numeric edit
  function saveCategoryAmount() {
    if (!editingCatId) return;
    const paise = rupeesToPaise(Number(inputRupees) || 0);
    setAllocations((prev) => {
      if (paise <= 0) {
        const copy = { ...prev };
        delete copy[editingCatId];
        return copy;
      }
      return { ...prev, [editingCatId]: paise };
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingCatId(null);
  }

  // Remove a category completely
  function handleRemoveCategory(catId: string) {
    setAllocations((prev) => {
      const copy = { ...prev };
      delete copy[catId];
      return copy;
    });
    removeCategory(catId);
    if (editingCatId === catId) {
      setEditingCatId(null);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }

  // Quick helper to allocate all remaining money to this category
  function allocateAllRemainingToCategory() {
    if (!editingCatId) return;
    const current = allocations[editingCatId] ?? 0;
    const target = Math.max(0, current + unallocated);
    setInputRupees(String(target / 100));
    Haptics.selectionAsync();
  }

  // Optional templates (strictly user-triggered)
  function applyTemplate(templateIndex: number) {
    const t = BUDGET_TEMPLATES[templateIndex];
    if (!t) return;
    const newAllocs: Record<string, number> = {};
    for (const cat of categories) {
      const frac = t.fractions[cat.name] ?? 0;
      if (frac > 0) {
        newAllocs[cat.id] = Math.round(totalPaise * frac);
      }
    }
    setAllocations(newAllocs);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleEqualSplit() {
    const activeCats = categories.filter((c) => !c.isArchived);
    const weights = activeCats.map(() => 1);
    const parts = allocate(totalPaise, weights);
    const newAllocs: Record<string, number> = {};
    activeCats.forEach((cat, i) => {
      newAllocs[cat.id] = parts[i] ?? 0;
    });
    setAllocations(newAllocs);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleResetToZero() {
    setAllocations({});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }

  // Add new category
  function handleAddCustomCategory() {
    const name = newCatName.trim();
    if (!name) return;
    addCategory({
      name,
      type: 'variable',
      icon: 'tag',
      color: '#9B59B6',
      isArchived: false,
      sortOrder: categories.length,
    });
    setNewCatName('');
    setIsAddingCategory(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  // Finish setup
  function handleDone() {
    const month = currentMonth;
    for (const cat of categories) {
      const paise = allocations[cat.id] ?? 0;
      if (paise > 0) {
        setBudgetAllocation({ month, categoryId: cat.id, allocatedPaise: paise });
      }
    }
    completeOnboarding();
    router.replace('/(tabs)');
  }

  const editingCategory = categories.find((c) => c.id === editingCatId);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text variant="bodySemiBold" color={Colors.muted}>
            Step 2 of 2
          </Text>
          <Text variant="serifBold" style={styles.title}>
            Your budget distribution
          </Text>
          <Text variant="body" color={Colors.text2}>
            Set budgets only for the categories you spend on. Tap any category to enter an amount.
          </Text>
        </View>

        {/* Budget Status Card */}
        <View style={[styles.statusCard, isOverAllocated && styles.statusCardOver]}>
          <View style={styles.statusCol}>
            <Text variant="caption" color={Colors.muted}>
              Total budget
            </Text>
            <AmountText paise={totalPaise} variant="large" />
          </View>

          <View style={styles.statusDivider} />

          <View style={styles.statusCol}>
            <Text
              variant="caption"
              color={isOverAllocated ? Colors.overBudget : Colors.muted}
            >
              {isOverAllocated ? 'Over by' : 'Unallocated'}
            </Text>
            <AmountText
              paise={Math.abs(unallocated)}
              variant="large"
              color={isOverAllocated ? Colors.overBudget : Colors.income}
            />
          </View>
        </View>

        {/* Optional quick templates (user can opt-in) */}
        <View style={styles.templatesSection}>
          <Text variant="caption" color={Colors.muted}>
            Optional presets:
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.templateChipsRow}
          >
            <Pressable
              style={styles.templateChip}
              onPress={() => applyTemplate(0)}
              accessibilityRole="button"
              accessibilityLabel="Apply 50/30/20 template"
            >
              <Sparkles size={12} color={Colors.accentLight} />
              <Text variant="caption" color={Colors.accentLight}>
                50/30/20
              </Text>
            </Pressable>

            <Pressable
              style={styles.templateChip}
              onPress={handleEqualSplit}
              accessibilityRole="button"
              accessibilityLabel="Split equally"
            >
              <Text variant="caption" color={Colors.accentLight}>
                Split equally
              </Text>
            </Pressable>

            {allocated > 0 && (
              <Pressable
                style={styles.templateChip}
                onPress={handleResetToZero}
                accessibilityRole="button"
                accessibilityLabel="Reset all to zero"
              >
                <RotateCcw size={12} color={Colors.muted} />
                <Text variant="caption" color={Colors.muted}>
                  Clear all
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>

        <Divider />

        {/* Category list with custom input triggers */}
        <View style={styles.categoryList}>
          {categories
            .filter((c) => !c.isArchived)
            .map((cat) => {
              const paise = allocations[cat.id] ?? 0;
              const fraction = totalPaise > 0 ? paise / totalPaise : 0;
              const isSet = paise > 0;

              return (
                <View key={cat.id} style={styles.catCard}>
                  {/* Left: Tap to edit amount directly */}
                  <Pressable
                    style={styles.catInfo}
                    onPress={() => openCategoryEditor(cat.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${cat.name}: ${formatMoney(paise)}. Tap to set amount.`}
                  >
                    <View style={[styles.catDot, { backgroundColor: cat.color }]} />
                    <View style={styles.catTextGroup}>
                      <Text variant="bodySemiBold">{cat.name}</Text>
                      <Text variant="caption" color={isSet ? Colors.text2 : Colors.muted}>
                        {isSet ? `${(fraction * 100).toFixed(0)}% of total` : 'Not budgeted (₹0)'}
                      </Text>
                    </View>
                  </Pressable>

                  {/* Right: Quick steppers and display */}
                  <View style={styles.catControls}>
                    {isSet && (
                      <Pressable
                        style={styles.stepperBtn}
                        onPress={() => adjustAllocation(cat.id, -500_00)}
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${cat.name} by ₹500`}
                        hitSlop={8}
                      >
                        <Text variant="bodyBold" color={Colors.text2}>
                          −
                        </Text>
                      </Pressable>
                    )}

                    <Pressable
                      onPress={() => openCategoryEditor(cat.id)}
                      style={[
                        styles.amountPill,
                        isSet && styles.amountPillSet,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Tap to edit ${cat.name} amount`}
                    >
                      <Text
                        variant="bodySemiBold"
                        color={isSet ? Colors.text : Colors.muted}
                      >
                        {formatMoney(paise)}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.stepperBtn}
                      onPress={() => adjustAllocation(cat.id, 500_00)}
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${cat.name} by ₹500`}
                      hitSlop={8}
                    >
                      <Text variant="bodyBold" color={Colors.accentLight}>
                        +
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.stepperBtn}
                      onPress={() => handleRemoveCategory(cat.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${cat.name}`}
                      hitSlop={8}
                    >
                      <Trash2 size={14} color={Colors.muted} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
        </View>

        {/* Add custom category link */}
        <Pressable
          style={styles.addCategoryBtn}
          onPress={() => setIsAddingCategory(true)}
          accessibilityRole="button"
          accessibilityLabel="Add custom category"
        >
          <Plus size={16} color={Colors.accentLight} />
          <Text variant="label" color={Colors.accentLight}>
            Add a category
          </Text>
        </Pressable>

        <Divider />

        {/* Footer */}
        <View style={styles.footer}>
          <Button
            label={isOverAllocated ? 'Over-allocated' : 'Start tracking →'}
            onPress={handleDone}
            variant="primary"
            fullWidth
            size="lg"
            disabled={isOverAllocated}
            icon={<Check size={18} color={Colors.text} />}
            iconPosition="right"
          />
          {isOverAllocated ? (
            <Text variant="caption" color={Colors.overBudget} center>
              Your allocations exceed your total budget by {formatMoney(Math.abs(unallocated))}.
            </Text>
          ) : unallocated > 0 ? (
            <Text variant="caption" color={Colors.muted} center>
              {formatMoney(unallocated)} will remain unallocated as a buffer.
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Direct Numeric Input Modal */}
      {editingCatId && editingCategory && (
        <Modal
          visible={!!editingCatId}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingCatId(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderLeft}>
                  <View
                    style={[
                      styles.catDot,
                      { backgroundColor: editingCategory.color },
                    ]}
                  />
                  <Text variant="bodySemiBold">
                    {editingCategory.name} Budget
                  </Text>
                </View>
                <Pressable
                  onPress={() => setEditingCatId(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <X size={20} color={Colors.text2} />
                </Pressable>
              </View>

              <Text variant="caption" color={Colors.muted}>
                Enter the amount you want to allocate for {editingCategory.name}:
              </Text>

              {/* Rupee Input */}
              <View style={styles.modalInputRow}>
                <Text variant="serifBold" style={styles.rupeeSymbol}>
                  ₹
                </Text>
                <TextInput
                  style={styles.modalTextInput}
                  value={inputRupees}
                  onChangeText={setInputRupees}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={Colors.muted}
                  autoFocus
                  accessibilityLabel="Amount in rupees"
                />
              </View>

              {/* Quick Adder Chips */}
              <View style={styles.quickAddersRow}>
                {[500, 1000, 2000, 5000].map((step) => (
                  <Pressable
                    key={step}
                    style={styles.quickChip}
                    onPress={() => {
                      const current = Number(inputRupees) || 0;
                      setInputRupees(String(current + step));
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text variant="caption" color={Colors.text2}>
                      +₹{step}
                    </Text>
                  </Pressable>
                ))}
                {unallocated > 0 && (
                  <Pressable
                    style={[styles.quickChip, styles.quickChipHighlight]}
                    onPress={allocateAllRemainingToCategory}
                  >
                    <Text variant="captionBold" color={Colors.accentLight}>
                      All Remaining ({formatMoney(unallocated)})
                    </Text>
                  </Pressable>
                )}
              </View>

              {/* Modal Buttons */}
              <View style={styles.modalButtonsRow}>
                <Button
                  label="Done"
                  variant="primary"
                  fullWidth
                  onPress={saveCategoryAmount}
                />
                <Button
                  label="Clear to ₹0"
                  variant="ghost"
                  fullWidth
                  onPress={() => {
                    setInputRupees('0');
                    saveCategoryAmount();
                  }}
                />
                <Button
                  label="Remove this category"
                  variant="destructive"
                  fullWidth
                  onPress={() => {
                    if (editingCatId) handleRemoveCategory(editingCatId);
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Add Custom Category Modal */}
      {isAddingCategory && (
        <Modal
          visible={isAddingCategory}
          transparent
          animationType="fade"
          onRequestClose={() => setIsAddingCategory(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text variant="bodySemiBold">Add Category</Text>
                <Pressable
                  onPress={() => setIsAddingCategory(false)}
                  hitSlop={8}
                >
                  <X size={20} color={Colors.text2} />
                </Pressable>
              </View>

              <TextInput
                style={styles.newCatInput}
                value={newCatName}
                onChangeText={setNewCatName}
                placeholder="Category name (e.g. Gym, Books)"
                placeholderTextColor={Colors.muted}
                autoFocus
              />

              <Button
                label="Add Category"
                variant="primary"
                fullWidth
                disabled={!newCatName.trim()}
                onPress={handleAddCustomCategory}
              />
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxxl + 40,
    gap: Spacing.base,
  },
  header: {
    gap: Spacing.xs,
  },
  title: {
    fontSize: FontSize.xl,
    lineHeight: 34,
    color: Colors.text,
  },
  statusCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  statusCardOver: {
    borderColor: Colors.overBudget,
  },
  statusCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statusDivider: {
    width: 1,
    backgroundColor: Colors.hairline,
    marginVertical: Spacing.xs,
  },
  templatesSection: {
    gap: Spacing.xs,
  },
  templateChipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    minHeight: 32,
  },
  categoryList: {
    gap: Spacing.sm,
  },
  catCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.hairline,
    minHeight: 52,
  },
  catInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  catDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  catTextGroup: {
    gap: 2,
  },
  catControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountPill: {
    minWidth: 80,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
  },
  amountPillSet: {
    backgroundColor: Colors.accent + '33',
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  addCategoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget,
  },
  footer: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,10,13,0.85)',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.base,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingHorizontal: Spacing.base,
    height: 56,
  },
  rupeeSymbol: {
    fontSize: FontSize.xl,
    color: Colors.text,
    marginRight: Spacing.xs,
  },
  modalTextInput: {
    flex: 1,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.lg,
  },
  quickAddersRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  quickChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  quickChipHighlight: {
    borderColor: Colors.accentLight,
  },
  modalButtonsRow: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  newCatInput: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
    height: 48,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.base,
  },
});
