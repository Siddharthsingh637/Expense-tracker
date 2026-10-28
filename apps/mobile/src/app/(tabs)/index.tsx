import { ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  TrendingDown, TrendingUp, ArrowRight, Clock,
  CreditCard, AlertCircle,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, FontSize, TouchTarget } from '@/theme';
import { Text, AmountText, BudgetBar, Divider, EmptyState, Chip } from '@/components';
import { useFinancerStore } from '@/data/local/store';
import { budgetTotals, pace, parseBudgetPeriod } from '@/engine/budget';
import { computeBalances } from '@/engine/splits';
import { formatMoney, formatDate, formatTime, toISODate } from '@/lib/format';
import { PAYMENT_MODE_LABELS } from '@/lib/constants';

function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="bodySemiBold" color={Colors.text}>{title}</Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button">
          <Text variant="label" color={Colors.accentLight}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const transactions = useFinancerStore((s) => s.transactions);
  const monthBudgets = useFinancerStore((s) => s.monthBudgets);
  const allocations = useFinancerStore((s) => s.budgetAllocations);
  const currentMonth = useFinancerStore((s) => s.currentMonth);
  const budgetStartDay = useFinancerStore((s) => s.budgetStartDay);
  const categories = useFinancerStore((s) => s.categories);
  const groupBills = useFinancerStore((s) => s.groupBills);
  const people = useFinancerStore((s) => s.people);

  const today = new Date();
  const budget = monthBudgets.find((b) => b.month === currentMonth);
  const period = parseBudgetPeriod(currentMonth, budgetStartDay);

  const paceResult = budget
    ? pace(budget, transactions, today)
    : null;

  const catTotals = budget
    ? budgetTotals(allocations.filter((a) => a.month === currentMonth), transactions, period)
    : [];

  const totalSpent = transactions
    .filter((t) => t.date >= period.start && t.date <= period.end && t.amount > 0 && !t.isTransfer)
    .reduce((s, t) => s + t.amount, 0);

  const recentTxns = [...transactions]
    .filter((t) => t.amount > 0)
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .slice(0, 5);

  const todayStr = toISODate(today);
  const todaySpent = transactions
    .filter((t) => t.date === todayStr && t.amount > 0 && !t.isTransfer)
    .reduce((s, t) => s + t.amount, 0);

  // Splits net balance calculation
  const openBills = groupBills.filter((b) => !b.isSettled);
  let totalSplitsNet = 0;
  for (const b of openBills) {
    const balances = computeBalances(b);
    const myBal = balances.find((x) => x.personId === 'me');
    if (myBal) {
      totalSplitsNet += myBal.net;
    }
  }
  const hasOpenSplits = openBills.length > 0 && totalSplitsNet !== 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Month header row */}
        <View style={styles.monthRow}>
          <Text variant="label" color={Colors.text2}>
            {new Date(currentMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </Text>
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Text variant="label" color={Colors.muted}>Settings</Text>
          </Pressable>
        </View>

        {/* Hero: money left */}
        <View style={styles.hero}>
          {paceResult ? (
            <>
              <Text variant="label" color={Colors.text2}>Left this month</Text>
              <AmountText
                paise={paceResult.leftPaise}
                variant="hero"
                color={paceResult.leftPaise < 0 ? Colors.overBudget : Colors.text}
                animated
              />
              {/* Pace line */}
              <View style={styles.paceLine}>
                {paceResult.isOnTrack ? (
                  <TrendingDown size={14} color={Colors.income} />
                ) : (
                  <TrendingUp size={14} color={Colors.overBudget} />
                )}
                <Text variant="caption" color={paceResult.isOnTrack ? Colors.income : Colors.overBudget}>
                  {formatMoney(paceResult.safePerDayPaise)}/day safe · {paceResult.daysLeft} days left
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text variant="label" color={Colors.text2}>Total spent</Text>
              <AmountText paise={totalSpent} variant="hero" animated />
              <Pressable
                style={styles.setBudgetBtn}
                onPress={() => router.push('/(tabs)/budget')}
                accessibilityRole="button"
              >
                <Text variant="label" color={Colors.accentLight}>Set a budget →</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Budget progress strip */}
        {budget && catTotals.length > 0 && (
          <View style={styles.card}>
            <SectionHeader
              title="Budget"
              action={{ label: 'See all', onPress: () => router.push('/(tabs)/budget') }}
            />
            {catTotals.slice(0, 4).map((ct) => {
              const cat = categories.find((c) => c.id === ct.categoryId);
              return (
                <BudgetBar
                  key={ct.categoryId}
                  allocatedPaise={ct.allocatedPaise}
                  spentPaise={ct.spentPaise}
                  label={cat?.name}
                  showAmount
                  style={styles.budgetBarItem}
                />
              );
            })}
          </View>
        )}

        {/* Today's spend */}
        <View style={styles.todayRow}>
          <Clock size={14} color={Colors.muted} />
          <Text variant="label" color={Colors.text2}>
            Today: <Text variant="label" color={Colors.text}>{formatMoney(todaySpent)}</Text>
          </Text>
        </View>

        {/* Splits balance chip */}
        {hasOpenSplits && (
          <Pressable
            style={[
              styles.splitsChip,
              {
                borderColor:
                  totalSplitsNet > 0 ? Colors.income : Colors.expense,
              },
            ]}
            onPress={() => router.push('/(tabs)/splits')}
            accessibilityRole="button"
            accessibilityLabel={
              totalSplitsNet > 0
                ? `You are owed ${formatMoney(totalSplitsNet)}`
                : `You owe ${formatMoney(Math.abs(totalSplitsNet))}`
            }
          >
            <AlertCircle
              size={14}
              color={totalSplitsNet > 0 ? Colors.income : Colors.expense}
            />
            <Text
              variant="label"
              color={totalSplitsNet > 0 ? Colors.income : Colors.expense}
            >
              {totalSplitsNet > 0
                ? `You are owed ${formatMoney(totalSplitsNet)}`
                : `You owe ${formatMoney(Math.abs(totalSplitsNet))}`}
            </Text>
            <ArrowRight
              size={12}
              color={totalSplitsNet > 0 ? Colors.income : Colors.expense}
            />
          </Pressable>
        )}

        {/* Recent transactions */}
        <View style={styles.card}>
          <SectionHeader
            title="Recent"
            action={{ label: 'All transactions', onPress: () => router.push('/transaction/list') }}
          />
          {recentTxns.length === 0 ? (
            <EmptyState
              icon={<CreditCard size={32} color={Colors.muted} />}
              title="No expenses yet"
              subtitle="Tap + to add your first expense"
            />
          ) : (
            recentTxns.map((txn, i) => {
              const cat = categories.find((c) => c.id === txn.categoryId);
              return (
                <View key={txn.id}>
                  <Pressable
                    style={styles.txnRow}
                    onPress={() => router.push(`/transaction/${txn.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${txn.place}, ${formatMoney(txn.amount)}`}
                  >
                    <View style={[styles.catDot, { backgroundColor: cat?.color ?? Colors.muted }]} />
                    <View style={styles.txnInfo}>
                      <Text variant="bodyMedium" numberOfLines={1}>{txn.place || 'Expense'}</Text>
                      <Text variant="caption" color={Colors.muted}>
                        {cat?.name} · {formatDate(txn.date)} · {PAYMENT_MODE_LABELS[txn.paymentMode]}
                      </Text>
                    </View>
                    <Text variant="bodySemiBold" color={Colors.expense}>
                      {formatMoney(txn.amount, { abs: true })}
                    </Text>
                  </Pressable>
                  {i < recentTxns.length - 1 && <Divider inset={Spacing.xl} />}
                </View>
              );
            })
          )}
        </View>

        {/* Bottom spacer for FAB */}
        <View style={styles.fabSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: Spacing.xxxl + 80,
  },
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
  },
  hero: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  paceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  setBudgetBtn: {
    marginTop: Spacing.sm,
    minHeight: TouchTarget,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetBarItem: {
    marginTop: Spacing.xs,
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  splitsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.accentLight,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    minHeight: 34,
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget,
  },
  catDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  txnInfo: { flex: 1, gap: 2 },
  fabSpacer: { height: 80 },
});
