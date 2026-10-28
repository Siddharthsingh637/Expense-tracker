import React, { useState, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  TextInput,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  PieChart,
  List,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Plus,
  X,
  Check,
  Edit2,
  Trash2,
  Copy,
  RotateCcw,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget, Fonts, FontSize } from '@/theme';
import {
  Text,
  AmountText,
  BudgetBar,
  Button,
  Chip,
  Divider,
  EmptyState,
  DraftCard,
} from '@/components';
import { useFinancerStore } from '@/data/local/store';
import { useToastStore } from '@/lib/toast-store';
import { aiService } from '@/ai';
import {
  budgetTotals,
  pace,
  parseBudgetPeriod,
} from '@/engine/budget';
import { allocate } from '@/engine/allocate';
import {
  formatMoney,
  rupeesToPaise,
} from '@/lib/format';
import { Category, CategoryType, MonthBudget } from '@/engine/types';
import { BUDGET_TEMPLATES, MAX_BUDGET_CATEGORIES } from '@/lib/constants';
import BudgetMapCanvas, { BudgetMapNode } from '@/features/budget/BudgetMapCanvas';

export default function BudgetScreen() {
  const { width: screenWidth } = useWindowDimensions();
  const canvasSize = Math.min(screenWidth - Spacing.base * 2, 380);

  const currentMonth = useFinancerStore((s) => s.currentMonth);
  const budgetStartDay = useFinancerStore((s) => s.budgetStartDay);
  const monthBudgets = useFinancerStore((s) => s.monthBudgets);
  const allocations = useFinancerStore((s) => s.budgetAllocations);
  const transactions = useFinancerStore((s) => s.transactions);
  const categories = useFinancerStore((s) => s.categories);
  const setMonthBudget = useFinancerStore((s) => s.setMonthBudget);
  const setBudgetAllocation = useFinancerStore((s) => s.setBudgetAllocation);
  const removeBudgetAllocation = useFinancerStore((s) => s.removeBudgetAllocation);
  const addCategory = useFinancerStore((s) => s.addCategory);
  const updateCategory = useFinancerStore((s) => s.updateCategory);
  const removeCategory = useFinancerStore((s) => s.removeCategory);
  const showToast = useToastStore((s) => s.showToast);

  // Active view modes: 'live' vs 'setup'
  const [mode, setMode] = useState<'live' | 'setup'>('live');
  // Visual layout: 'map' vs 'list'
  const [viewType, setViewType] = useState<'map' | 'list'>('map');

  // Budget for current month
  const budget =
    monthBudgets.find((b) => b.month === currentMonth) ??
    monthBudgets[monthBudgets.length - 1];
  const totalPaise = budget?.totalPaise ?? 0;

  const period = parseBudgetPeriod(currentMonth, budgetStartDay);

  // Computed pace and category totals
  const paceResult = budget ? pace(budget, transactions, new Date()) : null;
  const currentAllocations = useMemo(
    () => allocations.filter((a) => a.month === currentMonth),
    [allocations, currentMonth]
  );
  const catTotals = useMemo(
    () => (budget ? budgetTotals(currentAllocations, transactions, period) : []),
    [budget, currentAllocations, transactions, period]
  );

  const totalSpent = catTotals.reduce((s, c) => s + c.spentPaise, 0);
  const totalAllocated = currentAllocations.reduce((s, c) => s + c.allocatedPaise, 0);
  const unallocated = totalPaise - totalAllocated;
  const isOverAllocated = unallocated < 0;

  // Modals state
  const [editingNode, setEditingNode] = useState<BudgetMapNode | null>(null);
  const [inputRupees, setInputRupees] = useState('');
  const [editCatName, setEditCatName] = useState('');
  const [editCatType, setEditCatType] = useState<CategoryType>('variable');

  // Total budget edit modal
  const [isEditingTotal, setIsEditingTotal] = useState(false);
  const [inputTotalRupees, setInputTotalRupees] = useState('');

  // Add category modal
  const [isAddingCat, setIsAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<CategoryType>('variable');

  // AI Suggest draft
  const [aiDraft, setAiDraft] = useState<{
    allocations: Array<{ categoryId: string; allocatedPaise: number; reason: string }>;
    confidence: number;
    reason: string;
  } | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Build nodes for the Budget Map Canvas
  const mapNodes = useMemo<BudgetMapNode[]>(() => {
    const activeCats = categories.filter((c) => !c.isArchived);
    const sortedCats = [...activeCats].sort((a, b) => {
      const allocA =
        currentAllocations.find((al) => al.categoryId === a.id)?.allocatedPaise ?? 0;
      const allocB =
        currentAllocations.find((al) => al.categoryId === b.id)?.allocatedPaise ?? 0;
      return allocB - allocA;
    });

    const maxItems = MAX_BUDGET_CATEGORIES - 1; // leave room for unallocated
    const primaryCats = sortedCats.slice(0, maxItems);
    const overflowCats = sortedCats.slice(maxItems);

    const nodes: BudgetMapNode[] = primaryCats.map((cat) => {
      const alloc = currentAllocations.find((al) => al.categoryId === cat.id);
      const ct = catTotals.find((c) => c.categoryId === cat.id);
      return {
        id: cat.id,
        name: cat.name,
        allocatedPaise: alloc?.allocatedPaise ?? 0,
        spentPaise: ct?.spentPaise ?? 0,
        color: cat.color,
      };
    });

    // Group overflow into "Other" if present
    if (overflowCats.length > 0) {
      const otherAlloc = overflowCats.reduce((s, cat) => {
        const al = currentAllocations.find((a) => a.categoryId === cat.id);
        return s + (al?.allocatedPaise ?? 0);
      }, 0);
      const otherSpent = overflowCats.reduce((s, cat) => {
        const ct = catTotals.find((c) => c.categoryId === cat.id);
        return s + (ct?.spentPaise ?? 0);
      }, 0);

      nodes.push({
        id: 'grouped-other',
        name: `+${overflowCats.length} More`,
        allocatedPaise: otherAlloc,
        spentPaise: otherSpent,
        color: Colors.muted,
      });
    }

    // Always include Unallocated node
    nodes.push({
      id: 'unallocated',
      name: isOverAllocated ? 'Over Budget' : 'Unallocated',
      allocatedPaise: Math.abs(unallocated),
      spentPaise: 0,
      color: isOverAllocated ? Colors.overBudget : Colors.income,
      isUnallocated: true,
      isOverAllocated,
    });

    return nodes;
  }, [categories, currentAllocations, catTotals, unallocated, isOverAllocated]);

  // Handle node selection on map
  function handleSelectNode(node: BudgetMapNode) {
    if (node.isCenter) {
      setInputTotalRupees(String(totalPaise / 100));
      setIsEditingTotal(true);
      return;
    }

    if (node.isUnallocated) {
      if (mode === 'setup') {
        setInputTotalRupees(String(totalPaise / 100));
        setIsEditingTotal(true);
      }
      return;
    }

    if (mode === 'live') {
      // In live mode, navigate to Category Detail
      router.push(`/budget/category/${node.id}`);
    } else {
      // In setup mode, open category edit modal
      const cat = categories.find((c) => c.id === node.id);
      setEditingNode(node);
      setInputRupees(node.allocatedPaise > 0 ? String(node.allocatedPaise / 100) : '');
      setEditCatName(cat?.name ?? node.name);
      setEditCatType(cat?.type ?? 'variable');
    }
  }

  // Save category allocation & name
  function handleSaveNodeAmount() {
    if (!editingNode) return;
    const paise = rupeesToPaise(Number(inputRupees) || 0);

    // Save allocation
    setBudgetAllocation({
      month: currentMonth,
      categoryId: editingNode.id,
      allocatedPaise: paise,
    });

    // Update category name / type if changed
    if (editCatName.trim()) {
      updateCategory(editingNode.id, {
        name: editCatName.trim(),
        type: editCatType,
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEditingNode(null);
  }

  // Remove category completely
  function handleRemoveCurrentCategory() {
    if (!editingNode) return;
    const catId = editingNode.id;
    const existingAlloc = allocations.find((a) => a.categoryId === catId && a.month === currentMonth);
    if (existingAlloc) {
      removeBudgetAllocation(existingAlloc.id);
    }
    removeCategory(catId);
    setEditingNode(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    showToast({ message: 'Category removed' });
  }

  // Save Total Budget
  function handleSaveTotalBudget() {
    const paise = rupeesToPaise(Number(inputTotalRupees) || 0);
    if (paise > 0) {
      setMonthBudget({
        month: currentMonth,
        totalPaise: paise,
        startDay: budgetStartDay,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setIsEditingTotal(false);
  }

  // Add custom category
  function handleCreateCategory() {
    const name = newCatName.trim();
    if (!name) return;
    addCategory({
      name,
      type: newCatType,
      icon: 'tag',
      color: '#8E44AD',
      isArchived: false,
      sortOrder: categories.length,
    });
    setNewCatName('');
    setIsAddingCat(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({ message: `Added ${name}` });
  }

  // Template: 50/30/20
  function apply503020() {
    const template = BUDGET_TEMPLATES[0];
    for (const cat of categories) {
      const frac = template.fractions[cat.name] ?? 0;
      setBudgetAllocation({
        month: currentMonth,
        categoryId: cat.id,
        allocatedPaise: Math.round(totalPaise * frac),
      });
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast({ message: 'Applied 50/30/20 template' });
  }

  // Template: Copy last month
  function handleCopyLastMonth() {
    const [y, m] = currentMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevAllocs = allocations.filter((a) => a.month === prevMonth);

    if (prevAllocs.length === 0) {
      showToast({ message: 'No allocations found for previous month' });
      return;
    }

    for (const pa of prevAllocs) {
      setBudgetAllocation({
        month: currentMonth,
        categoryId: pa.categoryId,
        allocatedPaise: pa.allocatedPaise,
      });
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast({ message: `Copied allocations from ${prevMonth}` });
  }

  // Template: Reset all
  function handleClearAll() {
    for (const cat of categories) {
      setBudgetAllocation({
        month: currentMonth,
        categoryId: cat.id,
        allocatedPaise: 0,
      });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    showToast({ message: 'Budget cleared to ₹0' });
  }

  // AI Suggest
  async function handleAiSuggest() {
    setIsAiLoading(true);
    try {
      const draft = await aiService.proposeBudget(transactions, totalPaise);
      const enriched = draft.data.map((item) => {
        const cat = categories.find((c) => c.id === item.categoryId);
        return {
          ...item,
          reason: `Recommended based on your spending history for ${cat?.name ?? 'category'}`,
        };
      });
      setAiDraft({
        allocations: enriched,
        confidence: draft.confidence,
        reason: draft.reason,
      });
    } catch {
      showToast({ message: 'Could not generate AI suggestions' });
    } finally {
      setIsAiLoading(false);
    }
  }

  function handleConfirmAiDraft() {
    if (!aiDraft) return;
    for (const item of aiDraft.allocations) {
      setBudgetAllocation({
        month: currentMonth,
        categoryId: item.categoryId,
        allocatedPaise: item.allocatedPaise,
      });
    }
    setAiDraft(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast({ message: 'Applied AI budget suggestions' });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header */}
        <View style={styles.topHeader}>
          <View>
            <Text variant="serifBold" style={styles.title}>
              Budget Map
            </Text>
            <Text variant="caption" color={Colors.text2}>
              {new Date(currentMonth + '-02').toLocaleDateString('en-IN', {
                month: 'long',
                year: 'numeric',
              })}
            </Text>
          </View>

          {/* Controls: Mode Switch & View Switch */}
          <View style={styles.headerControls}>
            {/* Live / Setup Switch */}
            <View style={styles.segmentedToggle}>
              <Pressable
                style={[
                  styles.segmentBtn,
                  mode === 'live' && styles.segmentBtnActive,
                ]}
                onPress={() => {
                  setMode('live');
                  Haptics.selectionAsync();
                }}
              >
                <Text
                  variant="captionBold"
                  color={mode === 'live' ? Colors.text : Colors.muted}
                >
                  Live
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.segmentBtn,
                  mode === 'setup' && styles.segmentBtnActive,
                ]}
                onPress={() => {
                  setMode('setup');
                  Haptics.selectionAsync();
                }}
              >
                <Text
                  variant="captionBold"
                  color={mode === 'setup' ? Colors.text : Colors.muted}
                >
                  Setup
                </Text>
              </Pressable>
            </View>

            {/* Map / List View Toggle */}
            <Pressable
              style={styles.iconToggleBtn}
              onPress={() => {
                setViewType(viewType === 'map' ? 'list' : 'map');
                Haptics.selectionAsync();
              }}
              accessibilityRole="button"
              accessibilityLabel={
                viewType === 'map'
                  ? 'Switch to list view'
                  : 'Switch to map view'
              }
            >
              {viewType === 'map' ? (
                <List size={18} color={Colors.text2} />
              ) : (
                <PieChart size={18} color={Colors.text2} />
              )}
            </Pressable>
          </View>
        </View>

        {!budget ? (
          <EmptyState
            icon={<PieChart size={40} color={Colors.muted} />}
            title="No budget set this month"
            subtitle="Enter your monthly budget to unlock the Budget Map"
            action={{
              label: 'Set budget',
              onPress: () => {
                setInputTotalRupees('25000');
                setIsEditingTotal(true);
              },
            }}
          />
        ) : (
          <>
            {/* Live Pace Banner (in Live Mode) */}
            {mode === 'live' && paceResult && (
              <View style={styles.paceBanner}>
                <View style={styles.paceIconRow}>
                  {paceResult.isOnTrack ? (
                    <TrendingDown size={16} color={Colors.income} />
                  ) : (
                    <TrendingUp size={16} color={Colors.overBudget} />
                  )}
                  <Text
                    variant="captionBold"
                    color={
                      paceResult.isOnTrack ? Colors.income : Colors.overBudget
                    }
                  >
                    {paceResult.isOnTrack ? 'ON TRACK' : 'PACING HIGH'}
                  </Text>
                </View>
                <Text variant="body" color={Colors.text}>
                  <Text variant="bodySemiBold">
                    {formatMoney(paceResult.safePerDayPaise)}/day safe
                  </Text>{' '}
                  · {paceResult.daysLeft} days remaining
                </Text>
              </View>
            )}

            {/* Setup Mode Action Chips */}
            {mode === 'setup' && (
              <View style={styles.setupActionSection}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.templateChipsRow}
                >
                  <Pressable
                    style={styles.actionChip}
                    onPress={apply503020}
                    accessibilityRole="button"
                  >
                    <Text variant="caption" color={Colors.accentLight}>
                      50/30/20 rule
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.actionChip}
                    onPress={handleCopyLastMonth}
                    accessibilityRole="button"
                  >
                    <Copy size={12} color={Colors.accentLight} />
                    <Text variant="caption" color={Colors.accentLight}>
                      Copy last month
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.actionChip}
                    onPress={handleAiSuggest}
                    accessibilityRole="button"
                  >
                    <Sparkles size={12} color={Colors.accentLight} />
                    <Text variant="caption" color={Colors.accentLight}>
                      {isAiLoading ? 'Analyzing…' : 'AI suggest'}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.actionChip}
                    onPress={handleClearAll}
                    accessibilityRole="button"
                  >
                    <RotateCcw size={12} color={Colors.muted} />
                    <Text variant="caption" color={Colors.muted}>
                      Reset to ₹0
                    </Text>
                  </Pressable>
                </ScrollView>

                {/* AI Draft Card Preview */}
                {aiDraft && (
                  <DraftCard
                    confidence={aiDraft.confidence}
                    reason={aiDraft.reason}
                    onConfirm={handleConfirmAiDraft}
                    onEdit={handleConfirmAiDraft}
                    onDiscard={() => setAiDraft(null)}
                    style={styles.draftCard}
                  >
                    <View style={styles.draftContent}>
                      <Text variant="bodyBold" color={Colors.text}>
                        AI Suggested Budget Distribution
                      </Text>
                      {aiDraft.allocations.slice(0, 4).map((item) => {
                        const cat = categories.find((c) => c.id === item.categoryId);
                        return (
                          <View key={item.categoryId} style={styles.draftItemRow}>
                            <Text variant="caption" color={Colors.text2}>
                              {cat?.name}: {formatMoney(item.allocatedPaise)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </DraftCard>
                )}
              </View>
            )}

            {/* Unallocated Status Banner */}
            <View
              style={[
                styles.unallocatedBanner,
                isOverAllocated && styles.unallocatedBannerOver,
              ]}
            >
              <View style={styles.unallocatedInfo}>
                <Text
                  variant="captionBold"
                  color={isOverAllocated ? Colors.overBudget : Colors.muted}
                >
                  {isOverAllocated ? 'OVER-ALLOCATED BY' : 'UNALLOCATED REMAINDER'}
                </Text>
                <AmountText
                  paise={Math.abs(unallocated)}
                  variant="large"
                  color={isOverAllocated ? Colors.overBudget : Colors.income}
                />
              </View>
              {isOverAllocated && (
                <Text variant="caption" color={Colors.overBudget} style={{ flex: 1 }}>
                  Allocations exceed your monthly budget. Reduce some categories.
                </Text>
              )}
            </View>

            {/* MAP VIEW vs LIST VIEW */}
            {viewType === 'map' ? (
              <View style={styles.canvasWrapper}>
                <BudgetMapCanvas
                  mode={mode}
                  totalPaise={totalPaise}
                  totalSpentPaise={totalSpent}
                  nodes={mapNodes}
                  onSelectNode={handleSelectNode}
                  width={canvasSize}
                  height={canvasSize}
                />
                <Text variant="caption" color={Colors.muted} center>
                  {mode === 'setup'
                    ? 'Tap any node to customize its budget'
                    : 'Tap any node to view category details & transactions'}
                </Text>
              </View>
            ) : (
              /* LIST VIEW */
              <View style={styles.listViewCard}>
                {categories
                  .filter((c) => !c.isArchived)
                  .map((cat, i, arr) => {
                    const ct = catTotals.find((c) => c.categoryId === cat.id);
                    const alloc = currentAllocations.find((a) => a.categoryId === cat.id);
                    const allocatedPaise = alloc?.allocatedPaise ?? 0;
                    const spentPaise = ct?.spentPaise ?? 0;

                    return (
                      <View key={cat.id}>
                        <Pressable
                          style={styles.listRow}
                          onPress={() => {
                            if (mode === 'live') {
                              router.push(`/budget/category/${cat.id}`);
                            } else {
                              handleSelectNode({
                                id: cat.id,
                                name: cat.name,
                                allocatedPaise,
                                spentPaise,
                                color: cat.color,
                              });
                            }
                          }}
                          accessibilityRole="button"
                        >
                          <View style={styles.catLeft}>
                            <View
                              style={[
                                styles.catDot,
                                { backgroundColor: cat.color },
                              ]}
                            />
                            <View style={{ gap: 2 }}>
                              <Text variant="bodySemiBold">{cat.name}</Text>
                              <Text variant="caption" color={Colors.muted}>
                                {cat.type.toUpperCase()} ·{' '}
                                {formatMoney(spentPaise)} of{' '}
                                {formatMoney(allocatedPaise)}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.catRight}>
                            <BudgetBar
                              allocatedPaise={allocatedPaise}
                              spentPaise={spentPaise}
                              style={{ width: 90 }}
                            />
                            {allocatedPaise > 0 && spentPaise > allocatedPaise && (
                              <Text variant="caption" color={Colors.overBudget}>
                                Over
                              </Text>
                            )}
                          </View>
                        </Pressable>
                        {i < arr.length - 1 && <Divider inset={36} />}
                      </View>
                    );
                  })}
              </View>
            )}

            {/* Quick Button to Add Category in Setup Mode */}
            {mode === 'setup' && (
              <Pressable
                style={styles.addCategoryRow}
                onPress={() => setIsAddingCat(true)}
                accessibilityRole="button"
                accessibilityLabel="Add custom category"
              >
                <Plus size={16} color={Colors.accentLight} />
                <Text variant="label" color={Colors.accentLight}>
                  Add custom category
                </Text>
              </Pressable>
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Direct Category Amount & Info Edit Modal */}
      {editingNode && (
        <Modal
          visible={!!editingNode}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingNode(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderLeft}>
                  <View
                    style={[
                      styles.catDot,
                      { backgroundColor: editingNode.color },
                    ]}
                  />
                  <Text variant="bodySemiBold">{editCatName} Budget</Text>
                </View>
                <Pressable
                  onPress={() => setEditingNode(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <X size={20} color={Colors.text2} />
                </Pressable>
              </View>

              {/* Category Name Input */}
              <View style={styles.modalField}>
                <Text variant="caption" color={Colors.muted}>
                  Category Name
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={editCatName}
                  onChangeText={setEditCatName}
                  placeholder="Category Name"
                  placeholderTextColor={Colors.muted}
                />
              </View>

              {/* Category Type Chips */}
              <View style={styles.modalField}>
                <Text variant="caption" color={Colors.muted}>
                  Type
                </Text>
                <View style={styles.typeChipsRow}>
                  {(['variable', 'fixed', 'savings'] as CategoryType[]).map((t) => (
                    <Chip
                      key={t}
                      label={t.charAt(0).toUpperCase() + t.slice(1)}
                      selected={editCatType === t}
                      onPress={() => setEditCatType(t)}
                    />
                  ))}
                </View>
              </View>

              {/* Amount Input */}
              <View style={styles.modalField}>
                <Text variant="caption" color={Colors.muted}>
                  Monthly Allocation (₹)
                </Text>
                <View style={styles.modalAmountRow}>
                  <Text variant="serifBold" style={styles.rupeeSymbol}>
                    ₹
                  </Text>
                  <TextInput
                    style={styles.modalAmountInput}
                    value={inputRupees}
                    onChangeText={setInputRupees}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.muted}
                    autoFocus
                  />
                </View>
              </View>

              {/* Quick Steppers / Increments */}
              <View style={styles.quickAddersRow}>
                {[500, 1000, 2000, 5000].map((step) => (
                  <Pressable
                    key={step}
                    style={styles.quickChip}
                    onPress={() => {
                      const cur = Number(inputRupees) || 0;
                      setInputRupees(String(cur + step));
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
                    onPress={() => {
                      const cur = editingNode.allocatedPaise ?? 0;
                      const next = cur + unallocated;
                      setInputRupees(String(next / 100));
                      Haptics.selectionAsync();
                    }}
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
                  label="Save"
                  variant="primary"
                  fullWidth
                  onPress={handleSaveNodeAmount}
                />
                <Button
                  label="Clear to ₹0"
                  variant="ghost"
                  fullWidth
                  onPress={() => {
                    setInputRupees('0');
                  }}
                />
                <Button
                  label="Remove Category"
                  variant="destructive"
                  fullWidth
                  onPress={handleRemoveCurrentCategory}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Edit Total Monthly Budget Modal */}
      {isEditingTotal && (
        <Modal
          visible={isEditingTotal}
          transparent
          animationType="fade"
          onRequestClose={() => setIsEditingTotal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text variant="bodySemiBold">Edit Total Monthly Budget</Text>
                <Pressable
                  onPress={() => setIsEditingTotal(false)}
                  hitSlop={8}
                >
                  <X size={20} color={Colors.text2} />
                </Pressable>
              </View>

              <Text variant="caption" color={Colors.muted}>
                Enter the total money you want to budget for this month:
              </Text>

              <View style={styles.modalAmountRow}>
                <Text variant="serifBold" style={styles.rupeeSymbol}>
                  ₹
                </Text>
                <TextInput
                  style={styles.modalAmountInput}
                  value={inputTotalRupees}
                  onChangeText={setInputTotalRupees}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={Colors.muted}
                  autoFocus
                />
              </View>

              <Button
                label="Update Total Budget"
                variant="primary"
                fullWidth
                onPress={handleSaveTotalBudget}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Add Custom Category Modal */}
      {isAddingCat && (
        <Modal
          visible={isAddingCat}
          transparent
          animationType="fade"
          onRequestClose={() => setIsAddingCat(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text variant="bodySemiBold">Add Category</Text>
                <Pressable
                  onPress={() => setIsAddingCat(false)}
                  hitSlop={8}
                >
                  <X size={20} color={Colors.text2} />
                </Pressable>
              </View>

              <TextInput
                style={styles.modalInput}
                value={newCatName}
                onChangeText={setNewCatName}
                placeholder="Category name (e.g. Gym, Books)"
                placeholderTextColor={Colors.muted}
                autoFocus
              />

              <View style={styles.typeChipsRow}>
                {(['variable', 'fixed', 'savings'] as CategoryType[]).map((t) => (
                  <Chip
                    key={t}
                    label={t.charAt(0).toUpperCase() + t.slice(1)}
                    selected={newCatType === t}
                    onPress={() => setNewCatType(t)}
                  />
                ))}
              </View>

              <Button
                label="Create Category"
                variant="primary"
                fullWidth
                disabled={!newCatName.trim()}
                onPress={handleCreateCategory}
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
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: 100,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.xs,
  },
  title: {
    fontSize: FontSize.xl,
    color: Colors.text,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  segmentedToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface2,
    borderRadius: Radius.full,
    padding: 2,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  segmentBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  segmentBtnActive: {
    backgroundColor: Colors.accent,
  },
  iconToggleBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paceBanner: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 4,
  },
  paceIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  setupActionSection: {
    gap: Spacing.xs,
  },
  templateChipsRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    minHeight: 32,
  },
  draftCard: {
    marginTop: Spacing.xs,
  },
  draftContent: {
    gap: 4,
    paddingVertical: Spacing.xs,
  },
  draftItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  unallocatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.md,
  },
  unallocatedBannerOver: {
    borderColor: Colors.overBudget,
  },
  unallocatedInfo: {
    gap: 2,
  },
  canvasWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  listViewCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    minHeight: 52,
  },
  catLeft: {
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
  catRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  addCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget,
  },
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,10,13,0.88)',
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
  modalField: {
    gap: 4,
  },
  modalInput: {
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
  typeChipsRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  modalAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingHorizontal: Spacing.base,
    height: 52,
  },
  rupeeSymbol: {
    fontSize: FontSize.xl,
    color: Colors.text,
    marginRight: Spacing.xs,
  },
  modalAmountInput: {
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
});
