/**
 * Insights tab — Phase E complete implementation.
 * Period selector, SVG Charts (Daily bar, Category donut),
 * Category breakdown table, Biggest changes, Duplicate detection,
 * AI Narrative Card, and Close Month rollover flow.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  ActivityIndicator,
  Modal,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  CalendarCheck,
  CheckCircle2,
  X,
  Users,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget } from '@/theme';
import { Text, AmountText, Divider, EmptyState, Button } from '@/components';
import { usePaisaStore } from '@/data/local/store';
import { monthReport } from '@/engine/report';
import { parseBudgetPeriod, budgetTotals } from '@/engine/budget';
import { formatMoney, toYYYYMM } from '@/lib/format';
import { aiService } from '@/ai';
import { useToastStore } from '@/lib/toast-store';
import DailySpendBarChart from '@/features/insights/DailySpendBarChart';
import CategoryDonutChart from '@/features/insights/CategoryDonutChart';

export default function InsightsScreen() {
  const currentMonth = usePaisaStore((s) => s.currentMonth);
  const [viewMonth, setViewMonth] = useState(currentMonth);

  const transactions = usePaisaStore((s) => s.transactions);
  const monthBudgets = usePaisaStore((s) => s.monthBudgets);
  const allocations = usePaisaStore((s) => s.budgetAllocations);
  const budgetStartDay = usePaisaStore((s) => s.budgetStartDay);
  const categories = usePaisaStore((s) => s.categories);
  const groupBills = usePaisaStore((s) => s.groupBills);
  const aiEnabled = usePaisaStore((s) => s.aiEnabled);

  // Store actions
  const setCurrentMonth = usePaisaStore((s) => s.setCurrentMonth);
  const setMonthBudget = usePaisaStore((s) => s.setMonthBudget);
  const showToast = useToastStore((s) => s.showToast);

  // Month Period & Transactions
  const budget = monthBudgets.find((b) => b.month === viewMonth);
  const period = useMemo(
    () => parseBudgetPeriod(viewMonth, budgetStartDay),
    [viewMonth, budgetStartDay]
  );

  const monthTxns = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.date >= period.start &&
          t.date <= period.end &&
          t.amount > 0 &&
          !t.isTransfer
      ),
    [transactions, period]
  );

  const totalSpent = useMemo(
    () => monthTxns.reduce((s, t) => s + t.amount, 0),
    [monthTxns]
  );

  const cashSpent = useMemo(
    () =>
      monthTxns
        .filter((t) => t.paymentMode === 'cash')
        .reduce((s, t) => s + t.amount, 0),
    [monthTxns]
  );

  const monthAllocations = useMemo(
    () => allocations.filter((a) => a.month === viewMonth),
    [allocations, viewMonth]
  );

  const totalAllocated = useMemo(
    () => monthAllocations.reduce((s, a) => s + a.allocatedPaise, 0),
    [monthAllocations]
  );

  const catTotals = useMemo(
    () => budgetTotals(monthAllocations, transactions, period),
    [monthAllocations, transactions, period]
  );

  // Previous 3 Months Transactions for Comparisons
  const previousMonthsTxns = useMemo(() => {
    const [y, m] = viewMonth.split('-').map(Number);
    const result: typeof transactions[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(y, m - 1 - i, 1);
      const prevMonthStr = toYYYYMM(d);
      const prevPeriod = parseBudgetPeriod(prevMonthStr, budgetStartDay);
      const txns = transactions.filter(
        (t) =>
          t.date >= prevPeriod.start &&
          t.date <= prevPeriod.end &&
          t.amount > 0 &&
          !t.isTransfer
      );
      result.push(txns);
    }
    return result;
  }, [viewMonth, budgetStartDay, transactions]);

  // Month Report
  const report = useMemo(
    () =>
      monthReport(viewMonth, {
        monthBudget: budget,
        allocations: monthAllocations,
        transactions,
        previousMonthsTxns,
        today: new Date(),
      }),
    [viewMonth, budget, monthAllocations, transactions, previousMonthsTxns]
  );

  // Group bills in this month
  const monthGroupBills = useMemo(
    () =>
      groupBills.filter(
        (b) => b.date >= period.start && b.date <= period.end
      ),
    [groupBills, period]
  );

  // Chart Data: Daily Spend Map
  const [yearNum, monthNum] = viewMonth.split('-').map(Number);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

  const dailySpendMap = useMemo(() => {
    const map: Record<number, number> = {};
    for (const t of monthTxns) {
      const day = parseInt(t.date.split('-')[2], 10);
      if (!isNaN(day)) {
        map[day] = (map[day] ?? 0) + t.amount;
      }
    }
    return map;
  }, [monthTxns]);

  // Chart Data: Category Donut Slices
  const donutSlices = useMemo(() => {
    const spendByCat: Record<string, number> = {};
    for (const t of monthTxns) {
      spendByCat[t.categoryId] = (spendByCat[t.categoryId] ?? 0) + t.amount;
    }
    return Object.entries(spendByCat).map(([catId, amountPaise]) => {
      const cat = categories.find((c) => c.id === catId);
      return {
        categoryId: catId,
        name: cat?.name ?? 'Other',
        color: cat?.color ?? Colors.muted,
        amountPaise,
      };
    });
  }, [monthTxns, categories]);

  // AI Narrative state
  const [narrative, setNarrative] = useState<string>('');
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeReason, setNarrativeReason] = useState<string>('Local AI summary');
  const [narrativeConfidence, setNarrativeConfidence] = useState(0.85);

  const fetchNarrative = async () => {
    if (!aiEnabled) {
      setNarrative(
        `You spent ${formatMoney(totalSpent)} in ${viewMonth}. AI features are currently turned off in Settings.`
      );
      return;
    }
    setNarrativeLoading(true);
    try {
      const draft = await aiService.monthNarrative(report);
      setNarrative(draft.data);
      setNarrativeReason(draft.reason);
      setNarrativeConfidence(draft.confidence);
    } catch {
      setNarrative(
        `Total spending for ${viewMonth} is ${formatMoney(totalSpent)} across ${monthTxns.length} transactions.`
      );
    } finally {
      setNarrativeLoading(false);
    }
  };

  useEffect(() => {
    fetchNarrative();
  }, [viewMonth, totalSpent, aiEnabled]);

  // Close Month Modal state
  const [isCloseMonthModalOpen, setIsCloseMonthModalOpen] = useState(false);
  const [rolloverUnspent, setRolloverUnspent] = useState(true);

  const unspentSavings = Math.max(0, totalAllocated - totalSpent);
  const nextMonthDate = new Date(yearNum, monthNum, 1);
  const nextMonthStr = toYYYYMM(nextMonthDate);
  const nextMonthBudgetTotal =
    (budget?.totalPaise ?? totalAllocated) + (rolloverUnspent ? unspentSavings : 0);

  function shiftMonth(delta: number) {
    const [y, m] = viewMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const monthLabel = new Date(viewMonth + '-02').toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const handleConfirmCloseMonth = () => {
    // 1. Advance current month
    setCurrentMonth(nextMonthStr);

    // 2. Set next month budget with rollover if enabled
    setMonthBudget({
      month: nextMonthStr,
      totalPaise: nextMonthBudgetTotal,
      startDay: budgetStartDay,
    });

    setIsCloseMonthModalOpen(false);
    setViewMonth(nextMonthStr);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    showToast({
      message: `Closed ${monthLabel}. Active month is now ${nextMonthDate.toLocaleDateString(
        'en-IN',
        { month: 'long', year: 'numeric' }
      )} (${formatMoney(nextMonthBudgetTotal)} budget).`,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text variant="serifBold" style={styles.title}>
            Insights
          </Text>
        </View>

        {/* Month picker */}
        <View style={styles.monthPicker}>
          <Pressable
            style={styles.navBtn}
            onPress={() => shiftMonth(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            hitSlop={8}
          >
            <ChevronLeft size={20} color={Colors.text} />
          </Pressable>
          <View style={styles.monthPickerCenter}>
            <Text variant="bodySemiBold" center>
              {monthLabel}
            </Text>
            {viewMonth === currentMonth && (
              <View style={styles.currentMonthBadge}>
                <Text variant="caption" color={Colors.accentLight}>
                  Current
                </Text>
              </View>
            )}
          </View>
          <Pressable
            style={styles.navBtn}
            onPress={() => shiftMonth(1)}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            hitSlop={8}
          >
            <ChevronRight size={20} color={Colors.text} />
          </Pressable>
        </View>

        {monthTxns.length === 0 ? (
          <EmptyState
            icon={<BarChart2 size={40} color={Colors.muted} />}
            title="No data for this month"
            subtitle="Record transactions or choose another month to see spending trends and insights."
          />
        ) : (
          <>
            {/* Headline Numbers Grid */}
            <View style={styles.grid}>
              <View style={styles.gridItem}>
                <Text variant="caption" color={Colors.muted}>
                  Total Spent
                </Text>
                <AmountText paise={totalSpent} variant="medium" color={Colors.expense} />
              </View>

              <View style={styles.gridItem}>
                <Text variant="caption" color={Colors.muted}>
                  Cash Paid
                </Text>
                <AmountText paise={cashSpent} variant="medium" />
              </View>

              <View style={styles.gridItem}>
                <Text variant="caption" color={Colors.muted}>
                  Budget
                </Text>
                <AmountText
                  paise={budget?.totalPaise ?? totalAllocated}
                  variant="medium"
                />
              </View>

              <View style={styles.gridItem}>
                <Text variant="caption" color={Colors.muted}>
                  {totalSpent <= (budget?.totalPaise ?? totalAllocated)
                    ? 'Saved'
                    : 'Over Budget'}
                </Text>
                <AmountText
                  paise={Math.abs((budget?.totalPaise ?? totalAllocated) - totalSpent)}
                  variant="medium"
                  color={
                    totalSpent <= (budget?.totalPaise ?? totalAllocated)
                      ? Colors.income
                      : Colors.overBudget
                  }
                />
              </View>
            </View>

            {/* AI Narrative Card */}
            <View style={styles.narrativeCard}>
              <View style={styles.narrativeTopRow}>
                <View style={styles.aiBadge}>
                  <Sparkles size={14} color={Colors.accentLight} />
                  <Text variant="captionBold" color={Colors.muted} style={styles.aiBadgeText}>
                    AI MONTH SUMMARY
                  </Text>
                </View>

                <Pressable
                  onPress={fetchNarrative}
                  style={styles.refreshBtn}
                  disabled={narrativeLoading}
                  hitSlop={8}
                  accessibilityLabel="Regenerate summary"
                  accessibilityRole="button"
                >
                  {narrativeLoading ? (
                    <ActivityIndicator size="small" color={Colors.accentLight} />
                  ) : (
                    <RefreshCw size={14} color={Colors.text2} />
                  )}
                </Pressable>
              </View>

              <Text variant="caption" color={Colors.text2} style={{ fontStyle: 'italic' }}>
                {narrativeReason} ({Math.round(narrativeConfidence * 100)}% confidence)
              </Text>

              <Text variant="body" color={Colors.text} style={styles.narrativeBody}>
                {narrative}
              </Text>
            </View>

            {/* Daily Spending SVG Bar Chart */}
            <DailySpendBarChart
              daysInMonth={daysInMonth}
              dailySpend={dailySpendMap}
              monthLabel={monthLabel}
            />

            {/* Category Donut SVG Chart */}
            <CategoryDonutChart slices={donutSlices} totalPaise={totalSpent} />

            {/* Category Breakdown Table */}
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text variant="caption" color={Colors.muted} style={{ flex: 2 }}>
                  CATEGORY
                </Text>
                <Text variant="caption" color={Colors.muted} style={styles.colRight}>
                  SPENT
                </Text>
                <Text variant="caption" color={Colors.muted} style={styles.colRight}>
                  BUDGET
                </Text>
                <Text variant="caption" color={Colors.muted} style={styles.colRight}>
                  VARIANCE
                </Text>
              </View>
              <Divider />

              {catTotals.length > 0 ? (
                catTotals.map((ct, i) => {
                  const cat = categories.find((c) => c.id === ct.categoryId);
                  const delta = ct.allocatedPaise - ct.spentPaise;
                  return (
                    <View key={ct.categoryId}>
                      <View style={styles.tableRow}>
                        <View style={styles.catCell}>
                          <View
                            style={[
                              styles.catDot,
                              { backgroundColor: cat?.color ?? Colors.muted },
                            ]}
                          />
                          <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
                            {cat?.name ?? 'Other'}
                          </Text>
                        </View>

                        <Text
                          variant="label"
                          style={styles.colRight}
                          color={Colors.expense}
                        >
                          {formatMoney(ct.spentPaise)}
                        </Text>

                        <Text
                          variant="label"
                          style={styles.colRight}
                          color={Colors.text2}
                        >
                          {formatMoney(ct.allocatedPaise)}
                        </Text>

                        <Text
                          variant="label"
                          style={styles.colRight}
                          color={delta >= 0 ? Colors.income : Colors.overBudget}
                        >
                          {delta >= 0 ? '+' : ''}
                          {formatMoney(delta)}
                        </Text>
                      </View>
                      {i < catTotals.length - 1 && <Divider />}
                    </View>
                  );
                })
              ) : (
                <Text variant="caption" color={Colors.muted} center style={{ padding: Spacing.sm }}>
                  No category allocations recorded for this month.
                </Text>
              )}
            </View>

            {/* Biggest Changes vs Previous 3 Months */}
            {report.biggestChanges.length > 0 && (
              <View style={styles.sectionCard}>
                <Text variant="caption" color={Colors.muted} style={styles.capsLabel}>
                  BIGGEST CHANGES VS 3-MONTH AVERAGE
                </Text>
                <View style={styles.changesList}>
                  {report.biggestChanges.map((change) => {
                    const cat = categories.find((c) => c.id === change.categoryId);
                    const isIncrease = change.deltaPercent > 0;
                    return (
                      <View key={change.categoryId} style={styles.changeRow}>
                        <View style={styles.changeLeft}>
                          {isIncrease ? (
                            <TrendingUp size={16} color={Colors.overBudget} />
                          ) : (
                            <TrendingDown size={16} color={Colors.income} />
                          )}
                          <Text variant="bodyMedium">
                            {cat?.name ?? change.categoryId}
                          </Text>
                        </View>
                        <View style={styles.changeRight}>
                          <Text
                            variant="label"
                            color={isIncrease ? Colors.overBudget : Colors.income}
                          >
                            {isIncrease ? '+' : ''}
                            {change.deltaPercent.toFixed(0)}%
                          </Text>
                          <Text variant="caption" color={Colors.muted}>
                            vs {formatMoney(change.previousAvgPaise)} avg
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Group Bills Section */}
            {monthGroupBills.length > 0 && (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text variant="caption" color={Colors.muted} style={styles.capsLabel}>
                    GROUP BILLS THIS MONTH
                  </Text>
                  <Users size={14} color={Colors.muted} />
                </View>

                <View style={styles.billsList}>
                  {monthGroupBills.map((bill) => {
                    const totalBill = Object.values(bill.payments ?? {}).reduce(
                      (s, v) => s + v,
                      0
                    );
                    return (
                      <View key={bill.id} style={styles.billItem}>
                        <View>
                          <Text variant="bodyBold">{bill.title}</Text>
                          <Text variant="caption" color={Colors.text2}>
                            {bill.date} · {bill.personIds.length} people
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text variant="label" color={Colors.text}>
                            {formatMoney(totalBill)}
                          </Text>
                          <Text
                            variant="caption"
                            color={bill.isSettled ? Colors.income : Colors.accentLight}
                          >
                            {bill.isSettled ? 'Settled' : 'Open'}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Duplicate Suspects Warning */}
            {report.duplicateSuspects.length > 0 && (
              <View style={styles.duplicateCard}>
                <View style={styles.duplicateHeader}>
                  <AlertTriangle size={18} color={Colors.overBudget} />
                  <Text variant="bodySemiBold" color={Colors.overBudget}>
                    Flagged Duplicate Suspects ({report.duplicateSuspects.length})
                  </Text>
                </View>
                <Text variant="caption" color={Colors.text2}>
                  Transactions on the same date with the identical amount were detected:
                </Text>
                {report.duplicateSuspects.map((dup, i) => (
                  <View key={i} style={styles.dupRow}>
                    <Text variant="caption" color={Colors.text}>
                      • {dup.reason}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Close Month Button */}
            <View style={styles.closeMonthSection}>
              <Button
                variant="ghost"
                label={`Close Month: ${monthLabel}`}
                icon={<CalendarCheck size={18} color={Colors.text} />}
                onPress={() => setIsCloseMonthModalOpen(true)}
                fullWidth
              />
            </View>
          </>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Close Month Sheet / Modal */}
      <Modal
        visible={isCloseMonthModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsCloseMonthModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <CalendarCheck size={20} color={Colors.accentLight} />
                <Text variant="bodySemiBold">Close Month: {monthLabel}</Text>
              </View>
              <Pressable
                onPress={() => setIsCloseMonthModalOpen(false)}
                hitSlop={8}
                style={styles.modalCloseBtn}
              >
                <X size={20} color={Colors.text2} />
              </Pressable>
            </View>

            {/* Review Cards */}
            <View style={styles.modalBody}>
              <View style={styles.modalMetricRow}>
                <Text variant="body" color={Colors.text2}>
                  Total Spent
                </Text>
                <Text variant="bodyBold" color={Colors.expense}>
                  {formatMoney(totalSpent)}
                </Text>
              </View>

              <View style={styles.modalMetricRow}>
                <Text variant="body" color={Colors.text2}>
                  Total Budget
                </Text>
                <Text variant="bodyBold">{formatMoney(totalAllocated)}</Text>
              </View>

              <View style={styles.modalMetricRow}>
                <Text variant="body" color={Colors.text2}>
                  Net Savings
                </Text>
                <Text
                  variant="bodyBold"
                  color={unspentSavings > 0 ? Colors.income : Colors.text2}
                >
                  {formatMoney(unspentSavings)}
                </Text>
              </View>

              <Divider />

              {/* Rollover Toggle */}
              {unspentSavings > 0 && (
                <View style={styles.rolloverRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyMedium">Rollover unspent savings</Text>
                    <Text variant="caption" color={Colors.muted}>
                      Add {formatMoney(unspentSavings)} to next month's starting budget
                    </Text>
                  </View>
                  <Switch
                    value={rolloverUnspent}
                    onValueChange={setRolloverUnspent}
                    trackColor={{ false: Colors.surface2, true: Colors.accent }}
                    thumbColor={Colors.text}
                  />
                </View>
              )}

              {/* Next Month Budget Preview */}
              <View style={styles.nextMonthPreview}>
                <Text variant="caption" color={Colors.muted}>
                  DRAFT BUDGET FOR NEXT MONTH
                </Text>
                <Text variant="serifBold" style={{ fontSize: 24, marginTop: 4 }}>
                  {formatMoney(nextMonthBudgetTotal)}
                </Text>
                <Text variant="caption" color={Colors.text2}>
                  Will activate for {nextMonthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </Text>
              </View>

              {/* Confirm Button */}
              <Button
                variant="primary"
                label="Confirm & Close Month"
                onPress={handleConfirmCloseMonth}
                fullWidth
                style={{ marginTop: Spacing.sm }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: 80,
  },
  header: {
    paddingTop: Spacing.xs,
  },
  title: {
    fontSize: 28,
    color: Colors.text,
  },
  monthPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  monthPickerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  currentMonthBadge: {
    backgroundColor: Colors.surface2,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  navBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  gridItem: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.xs,
  },
  narrativeCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.xs,
  },
  narrativeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  aiBadgeText: {
    letterSpacing: 0.8,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  narrativeBody: {
    lineHeight: 22,
    marginTop: Spacing.xs,
  },
  table: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: Spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    minHeight: 36,
  },
  catCell: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  catDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  colRight: {
    flex: 1,
    textAlign: 'right',
  },
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  capsLabel: {
    letterSpacing: 0.8,
  },
  changesList: {
    gap: Spacing.sm,
  },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  changeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  changeRight: {
    alignItems: 'flex-end',
  },
  billsList: {
    gap: Spacing.sm,
  },
  billItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  duplicateCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.overBudget,
    padding: Spacing.base,
    gap: Spacing.xs,
  },
  duplicateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dupRow: {
    paddingLeft: Spacing.sm,
  },
  closeMonthSection: {
    marginTop: Spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.base,
    gap: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  modalCloseBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    gap: Spacing.base,
    paddingBottom: Spacing.base,
  },
  modalMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rolloverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.base,
  },
  nextMonthPreview: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    padding: Spacing.base,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
});
