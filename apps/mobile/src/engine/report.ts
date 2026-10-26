import {
  BudgetAllocation,
  CategorySpendResult,
  MonthBudget,
  MonthReport,
  Paise,
  Transaction,
} from './types';
import { budgetTotals, categorySpend, parseBudgetPeriod } from './budget';
import { detectDuplicates } from './detect';

/**
 * Generates the month report for Insights.
 */
export function monthReport(
  month: string,
  opts: {
    monthBudget?: MonthBudget;
    allocations: BudgetAllocation[];
    transactions: Transaction[];
    previousMonthsTxns: Transaction[][];
    today?: Date;
  },
): MonthReport {
  const period = parseBudgetPeriod(month, opts.monthBudget?.startDay ?? 1);

  const currentPeriodTxns = opts.transactions.filter(
    txn =>
      !txn.isTransfer &&
      txn.amount > 0 &&
      txn.date >= period.start &&
      txn.date <= period.end,
  );

  const totalSpentPaise: Paise = currentPeriodTxns.reduce(
    (sum, txn) => sum + txn.amount,
    0,
  );

  const cashPaidOutPaise: Paise = currentPeriodTxns
    .filter(txn => txn.paymentMode === 'cash')
    .reduce((sum, txn) => sum + txn.amount, 0);

  const totalAllocatedPaise: Paise = opts.allocations.reduce(
    (sum, a) => sum + a.allocatedPaise,
    0,
  );

  const totalBudgetPaise: Paise = opts.monthBudget?.totalPaise ?? totalAllocatedPaise;

  const savedOrOverspentPaise: Paise = totalAllocatedPaise - totalSpentPaise;

  const categoryBreakdown: CategorySpendResult[] = budgetTotals(
    opts.allocations,
    opts.transactions,
    period,
  );

  // biggestChanges: for each category, compare current spend vs average of previous months.
  // Include top 3 by absolute deltaPercent.
  const allCategoryIds = new Set<string>();
  for (const a of opts.allocations) {
    allCategoryIds.add(a.categoryId);
  }
  for (const t of currentPeriodTxns) {
    allCategoryIds.add(t.categoryId);
  }
  for (const prevList of opts.previousMonthsTxns) {
    for (const t of prevList) {
      if (!t.isTransfer && t.amount > 0) {
        allCategoryIds.add(t.categoryId);
      }
    }
  }

  const numPrevMonths = opts.previousMonthsTxns.length;
  const changes: Array<{
    categoryId: string;
    currentPaise: Paise;
    previousAvgPaise: Paise;
    deltaPercent: number;
  }> = [];

  for (const categoryId of allCategoryIds) {
    const currentPaise = categorySpend(currentPeriodTxns, categoryId, period);

    let prevSum = 0;
    if (numPrevMonths > 0) {
      for (const prevMonth of opts.previousMonthsTxns) {
        const monthSpend = prevMonth
          .filter(
            t => !t.isTransfer && t.amount > 0 && t.categoryId === categoryId,
          )
          .reduce((sum, t) => sum + t.amount, 0);
        prevSum += monthSpend;
      }
    }

    const previousAvgPaise = numPrevMonths > 0 ? Math.round(prevSum / numPrevMonths) : 0;

    let deltaPercent = 0;
    if (previousAvgPaise > 0) {
      deltaPercent = Math.round(((currentPaise - previousAvgPaise) / previousAvgPaise) * 1000) / 10;
    } else if (currentPaise > 0) {
      deltaPercent = 100;
    }

    if (currentPaise > 0 || previousAvgPaise > 0) {
      changes.push({
        categoryId,
        currentPaise,
        previousAvgPaise,
        deltaPercent,
      });
    }
  }

  changes.sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent));
  const biggestChanges = changes.slice(0, 3);

  const duplicateSuspects = detectDuplicates(currentPeriodTxns);

  return {
    month,
    totalSpentPaise,
    totalAllocatedPaise,
    totalBudgetPaise,
    savedOrOverspentPaise,
    cashPaidOutPaise,
    categoryBreakdown,
    biggestChanges,
    duplicateSuspects,
  };
}
