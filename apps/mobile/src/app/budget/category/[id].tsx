import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  ArrowRightLeft,
  X,
  Check,
  TrendingDown,
  TrendingUp,
  CreditCard,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget, Fonts, FontSize } from '@/theme';
import {
  Text,
  AmountText,
  BudgetBar,
  Divider,
  Button,
  Chip,
  EmptyState,
  ProgressRing,
} from '@/components';
import { useFinancerStore } from '@/data/local/store';
import { useToastStore } from '@/lib/toast-store';
import { categorySpend, parseBudgetPeriod, pace } from '@/engine/budget';
import {
  formatMoney,
  formatDate,
  formatTime,
  toISODate,
  toHHMM,
  rupeesToPaise,
} from '@/lib/format';
import { PAYMENT_MODE_LABELS } from '@/lib/constants';

export default function CategoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const categories = useFinancerStore((s) => s.categories);
  const transactions = useFinancerStore((s) => s.transactions);
  const allocations = useFinancerStore((s) => s.budgetAllocations);
  const monthBudgets = useFinancerStore((s) => s.monthBudgets);
  const currentMonth = useFinancerStore((s) => s.currentMonth);
  const budgetStartDay = useFinancerStore((s) => s.budgetStartDay);
  const setBudgetAllocation = useFinancerStore((s) => s.setBudgetAllocation);
  const addTransaction = useFinancerStore((s) => s.addTransaction);
  const showToast = useToastStore((s) => s.showToast);

  const cat = categories.find((c) => c.id === id);
  const period = parseBudgetPeriod(currentMonth, budgetStartDay);
  const alloc = allocations.find(
    (a) => a.month === currentMonth && a.categoryId === id
  );
  const allocatedPaise = alloc?.allocatedPaise ?? 0;
  const spentPaise = categorySpend(transactions, id ?? '', period);
  const remainingPaise = allocatedPaise - spentPaise;
  const isOverBudget = spentPaise > allocatedPaise;

  const budget = monthBudgets.find((b) => b.month === currentMonth);
  const paceResult = budget ? pace(budget, transactions, new Date()) : null;

  // Filter category transactions
  const catTxns = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.categoryId === id &&
            t.date >= period.start &&
            t.date <= period.end &&
            t.amount > 0 &&
            !t.isTransfer
        )
        .sort((a, b) =>
          b.date === a.date
            ? b.createdAt > a.createdAt
              ? 1
              : -1
            : b.date > a.date
            ? 1
            : -1
        ),
    [transactions, id, period]
  );

  // Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [destCatId, setDestCatId] = useState<string>(() => {
    const other = categories.find((c) => c.id !== id && !c.isArchived);
    return other?.id ?? '';
  });
  const [transferRupees, setTransferRupees] = useState('');
  const [transferNote, setTransferNote] = useState('');

  if (!cat) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
          >
            <ChevronLeft size={22} color={Colors.text} />
          </Pressable>
          <Text variant="bodySemiBold">Category</Text>
          <View style={{ width: TouchTarget }} />
        </View>
        <EmptyState
          icon={<CreditCard size={40} color={Colors.muted} />}
          title="Category not found"
          action={{ label: 'Go back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  // Handle Logged Budget Transfer
  function handleExecuteTransfer() {
    const transferPaise = rupeesToPaise(Number(transferRupees) || 0);
    if (transferPaise <= 0 || !destCatId) return;

    const destCat = categories.find((c) => c.id === destCatId);
    if (!destCat) return;

    const destAlloc = allocations.find(
      (a) => a.month === currentMonth && a.categoryId === destCatId
    );
    const destAllocPaise = destAlloc?.allocatedPaise ?? 0;

    // 1. Update source category allocation (decrement)
    setBudgetAllocation({
      month: currentMonth,
      categoryId: cat!.id,
      allocatedPaise: Math.max(0, allocatedPaise - transferPaise),
    });

    // 2. Update destination category allocation (increment)
    setBudgetAllocation({
      month: currentMonth,
      categoryId: destCatId,
      allocatedPaise: destAllocPaise + transferPaise,
    });

    // 3. Log an internal transfer transaction record for audit/history
    addTransaction({
      amount: transferPaise,
      categoryId: cat!.id,
      place: `Transfer to ${destCat.name}`,
      note: transferNote.trim() || `Moved from ${cat!.name} to ${destCat.name}`,
      paymentMode: 'upi',
      date: toISODate(new Date()),
      time: toHHMM(new Date()),
      isTransfer: true,
      provenance: 'user',
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsTransferModalOpen(false);
    setTransferRupees('');
    setTransferNote('');

    showToast({
      message: `Moved ${formatMoney(transferPaise)} to ${destCat.name}`,
    });
  }

  const progress =
    allocatedPaise > 0 ? Math.min(1.2, spentPaise / allocatedPaise) : 0;
  const progressRingColor =
    progress > 1.0 ? Colors.overBudget : progress > 0.8 ? '#D97706' : Colors.income;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitle}>
          <View style={[styles.catDot, { backgroundColor: cat.color }]} />
          <Text variant="bodySemiBold">{cat.name}</Text>
        </View>
        <Pressable
          style={styles.transferHeaderBtn}
          onPress={() => {
            setIsTransferModalOpen(true);
            Haptics.selectionAsync();
          }}
          accessibilityRole="button"
          accessibilityLabel="Transfer budget"
        >
          <ArrowRightLeft size={18} color={Colors.accentLight} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Main Category Metric Card */}
        <View style={[styles.heroCard, { borderLeftColor: cat.color }]}>
          <View style={styles.heroRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.typeBadge}>
                <Text variant="captionBold" color={Colors.muted}>
                  {cat.type.toUpperCase()}
                </Text>
              </View>
              <Text variant="caption" color={Colors.muted}>
                SPENT
              </Text>
              <AmountText
                paise={spentPaise}
                variant="hero"
                color={isOverBudget ? Colors.overBudget : Colors.expense}
              />
              <Text
                variant="caption"
                color={isOverBudget ? Colors.overBudget : Colors.income}
              >
                {isOverBudget
                  ? `Over budget by ${formatMoney(Math.abs(remainingPaise))}`
                  : `${formatMoney(remainingPaise)} remaining`}
              </Text>
            </View>

            {/* Circular Progress Ring */}
            <View style={styles.ringContainer}>
              <ProgressRing
                size={80}
                progress={progress}
                strokeWidth={5}
                color={progressRingColor}
              >
                <Text variant="captionBold" color={Colors.text}>
                  {(progress * 100).toFixed(0)}%
                </Text>
              </ProgressRing>
            </View>
          </View>

          <Divider />

          {/* Allocation details */}
          <View style={styles.statGrid}>
            <View style={styles.statItem}>
              <Text variant="caption" color={Colors.muted}>
                Allocated
              </Text>
              <Text variant="bodySemiBold">{formatMoney(allocatedPaise)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="caption" color={Colors.muted}>
                Transactions
              </Text>
              <Text variant="bodySemiBold">{catTxns.length}</Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="caption" color={Colors.muted}>
                Avg / Expense
              </Text>
              <Text variant="bodySemiBold">
                {catTxns.length > 0
                  ? formatMoney(Math.round(spentPaise / catTxns.length))
                  : '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* Transfer Money CTA Card */}
        <Pressable
          style={styles.transferCtaCard}
          onPress={() => {
            setIsTransferModalOpen(true);
            Haptics.selectionAsync();
          }}
          accessibilityRole="button"
          accessibilityLabel="Move money to another category"
        >
          <View style={styles.transferCtaIcon}>
            <ArrowRightLeft size={20} color={Colors.accentLight} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodySemiBold" color={Colors.text}>
              Move money to another category
            </Text>
            <Text variant="caption" color={Colors.muted}>
              Rebalance your budget with a logged transfer
            </Text>
          </View>
        </Pressable>

        {/* Category Transactions Section */}
        <View style={styles.sectionHeaderRow}>
          <Text variant="bodySemiBold">This Month's Expenses</Text>
          <Text variant="caption" color={Colors.muted}>
            {catTxns.length} expense{catTxns.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {catTxns.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={36} color={Colors.muted} />}
            title="No expenses in this category"
            subtitle="Expenses logged in this category will appear here"
          />
        ) : (
          <View style={styles.txnCard}>
            {catTxns.map((txn, i) => (
              <View key={txn.id}>
                <Pressable
                  style={styles.txnRow}
                  onPress={() => router.push(`/transaction/${txn.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${txn.place}, ${formatMoney(txn.amount)}`}
                >
                  <View style={styles.txnInfo}>
                    <Text variant="bodyMedium" numberOfLines={1}>
                      {txn.place || 'Expense'}
                    </Text>
                    <Text variant="caption" color={Colors.muted}>
                      {formatDate(txn.date)} · {formatTime(txn.time)} ·{' '}
                      {PAYMENT_MODE_LABELS[txn.paymentMode]}
                    </Text>
                  </View>
                  <Text variant="bodySemiBold" color={Colors.expense}>
                    {formatMoney(txn.amount)}
                  </Text>
                </Pressable>
                {i < catTxns.length - 1 && <Divider inset={16} />}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Transfer Budget Modal */}
      {isTransferModalOpen && (
        <Modal
          visible={isTransferModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsTransferModalOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderLeft}>
                  <ArrowRightLeft size={18} color={Colors.accentLight} />
                  <Text variant="bodySemiBold">Move Budget Money</Text>
                </View>
                <Pressable
                  onPress={() => setIsTransferModalOpen(false)}
                  hitSlop={8}
                >
                  <X size={20} color={Colors.text2} />
                </Pressable>
              </View>

              <Text variant="caption" color={Colors.text2}>
                Move allocated money from{' '}
                <Text variant="captionBold" color={cat.color}>
                  {cat.name}
                </Text>{' '}
                to another category:
              </Text>

              {/* Destination Category Picker */}
              <View style={styles.modalField}>
                <Text variant="caption" color={Colors.muted}>
                  Destination Category
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.destCategoryChips}
                >
                  {categories
                    .filter((c) => c.id !== cat.id && !c.isArchived)
                    .map((dest) => (
                      <Chip
                        key={dest.id}
                        label={dest.name}
                        selected={destCatId === dest.id}
                        color={dest.color}
                        onPress={() => setDestCatId(dest.id)}
                      />
                    ))}
                </ScrollView>
              </View>

              {/* Transfer Amount */}
              <View style={styles.modalField}>
                <Text variant="caption" color={Colors.muted}>
                  Transfer Amount (₹)
                </Text>
                <View style={styles.modalAmountRow}>
                  <Text variant="serifBold" style={styles.rupeeSymbol}>
                    ₹
                  </Text>
                  <TextInput
                    style={styles.modalAmountInput}
                    value={transferRupees}
                    onChangeText={setTransferRupees}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.muted}
                    autoFocus
                  />
                </View>
              </View>

              {/* Quick Steppers */}
              <View style={styles.quickAddersRow}>
                {[500, 1000, 2000].map((step) => (
                  <Pressable
                    key={step}
                    style={styles.quickChip}
                    onPress={() => {
                      const cur = Number(transferRupees) || 0;
                      setTransferRupees(String(cur + step));
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text variant="caption" color={Colors.text2}>
                      +₹{step}
                    </Text>
                  </Pressable>
                ))}
                {remainingPaise > 0 && (
                  <Pressable
                    style={[styles.quickChip, styles.quickChipHighlight]}
                    onPress={() => {
                      setTransferRupees(String(remainingPaise / 100));
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text variant="captionBold" color={Colors.accentLight}>
                      All Remaining ({formatMoney(remainingPaise)})
                    </Text>
                  </Pressable>
                )}
              </View>

              {/* Note */}
              <View style={styles.modalField}>
                <Text variant="caption" color={Colors.muted}>
                  Reason / Note (optional)
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={transferNote}
                  onChangeText={setTransferNote}
                  placeholder="e.g. Covering dining overspend"
                  placeholderTextColor={Colors.muted}
                />
              </View>

              {/* Buttons */}
              <View style={styles.modalButtonsRow}>
                <Button
                  label="Confirm Transfer"
                  variant="primary"
                  fullWidth
                  disabled={!transferRupees || Number(transferRupees) <= 0 || !destCatId}
                  onPress={handleExecuteTransfer}
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  fullWidth
                  onPress={() => setIsTransferModalOpen(false)}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  backBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferHeaderBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  scroll: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderLeftWidth: 4,
    gap: Spacing.base,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  ringContainer: {
    paddingRight: Spacing.sm,
  },
  statGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    gap: 2,
  },
  transferCtaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.accent,
    minHeight: TouchTarget,
  },
  transferCtaIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  txnCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    overflow: 'hidden',
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget,
    gap: Spacing.sm,
  },
  txnInfo: { flex: 1, gap: 2 },
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
  destCategoryChips: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingVertical: 2,
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
  modalInput: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
    height: 44,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.sm,
  },
  modalButtonsRow: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
});
