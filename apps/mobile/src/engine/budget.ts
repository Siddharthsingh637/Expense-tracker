import {
  Transaction,
  BudgetAllocation,
  MonthBudget,
  CategorySpendResult,
  PaceResult,
  BudgetPeriod,
  Paise,
} from './types';
import { toISODate, parseISODate } from '../lib/format';

/**
 * Given `month` = "YYYY-MM" and `startDay` (1–28), return the inclusive start and end dates.
 * - If startDay = 1: start = first of month, end = last day of month.
 * - If startDay > 1: start = YYYY-MM-startDay, end = (YYYY-MM+1)-(startDay-1).
 * - Handle month/year rollovers correctly.
 * - Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }.
 */
export function parseBudgetPeriod(month: string, startDay: number): BudgetPeriod {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  const safeStartDay = Math.max(1, Math.min(28, startDay));

  if (safeStartDay === 1) {
    const start = `${yearStr}-${monthStr.padStart(2, '0')}-01`;
    const lastDay = new Date(year, monthNum, 0).getDate();
    const end = `${yearStr}-${monthStr.padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }

  const start = `${yearStr}-${monthStr.padStart(2, '0')}-${String(safeStartDay).padStart(2, '0')}`;
  let endYear = year;
  let endMonth = monthNum + 1;
  if (endMonth > 12) {
    endYear += 1;
    endMonth = 1;
  }
  const endDay = safeStartDay - 1;
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  return { start, end };
}

/**
 * Sum paise of all non-transfer, non-refund (amount > 0) transactions in the period matching the categoryId.
 * A transaction is in-period if transaction.date >= period.start && transaction.date <= period.end.
 */
export function categorySpend(
  txns: Transaction[],
  categoryId: string,
  period: BudgetPeriod,
): Paise {
  return txns
    .filter(
      txn =>
        !txn.isTransfer &&
        txn.amount > 0 &&
        txn.categoryId === categoryId &&
        txn.date >= period.start &&
        txn.date <= period.end,
    )
    .reduce((sum, txn) => sum + txn.amount, 0);
}

/**
 * For each allocation, compute spent and remaining. isOverBudget = spentPaise > allocatedPaise.
 */
export function budgetTotals(
  allocations: BudgetAllocation[],
  txns: Transaction[],
  period: BudgetPeriod,
): CategorySpendResult[] {
  return allocations.map(allocation => {
    const spentPaise = categorySpend(txns, allocation.categoryId, period);
    const allocatedPaise = allocation.allocatedPaise;
    const remainingPaise = allocatedPaise - spentPaise;
    const isOverBudget = spentPaise > allocatedPaise;
    return {
      categoryId: allocation.categoryId,
      allocatedPaise,
      spentPaise,
      remainingPaise,
      isOverBudget,
    };
  });
}

/**
 * Compute budget pacing:
 * - Determine period via parseBudgetPeriod.
 * - totalSpent = sum of all positive, non-transfer transactions in period.
 * - leftPaise = monthBudget.totalPaise - totalSpent.
 * - Parse end date, compute daysLeft (inclusive of today if today <= end, else 0).
 * - safePerDayPaise = daysLeft > 0 ? Math.floor(leftPaise / daysLeft) : 0.
 * - projectedSpendPaise: linear projection based on days elapsed.
 * - isOnTrack = projectedSpendPaise <= monthBudget.totalPaise.
 */
export function pace(
  monthBudget: MonthBudget,
  txns: Transaction[],
  today: Date = new Date(),
): PaceResult {
  const period = parseBudgetPeriod(monthBudget.month, monthBudget.startDay);

  const totalSpent = txns
    .filter(
      txn =>
        !txn.isTransfer &&
        txn.amount > 0 &&
        txn.date >= period.start &&
        txn.date <= period.end,
    )
    .reduce((sum, txn) => sum + txn.amount, 0);

  const leftPaise = monthBudget.totalPaise - totalSpent;

  const todayStr = toISODate(today);
  const startDate = parseISODate(period.start);
  const endDate = parseISODate(period.end);
  const todayMidnight = parseISODate(todayStr);

  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;

  let daysLeft = 0;
  if (todayMidnight <= endDate) {
    if (todayMidnight < startDate) {
      daysLeft = totalDays;
    } else {
      daysLeft = Math.round((endDate.getTime() - todayMidnight.getTime()) / 86_400_000) + 1;
    }
  }

  const safePerDayPaise = daysLeft > 0 && leftPaise > 0 ? Math.floor(leftPaise / daysLeft) : 0;

  let daysElapsed = 0;
  if (todayMidnight >= endDate) {
    daysElapsed = totalDays;
  } else if (todayMidnight >= startDate) {
    daysElapsed = Math.round((todayMidnight.getTime() - startDate.getTime()) / 86_400_000) + 1;
  }

  let projectedSpendPaise: Paise;
  if (daysElapsed <= 0) {
    projectedSpendPaise = totalSpent;
  } else {
    projectedSpendPaise = Math.round((totalSpent / daysElapsed) * totalDays);
  }

  const isOnTrack = projectedSpendPaise <= monthBudget.totalPaise;

  return {
    leftPaise,
    daysLeft,
    safePerDayPaise,
    projectedSpendPaise,
    isOnTrack,
  };
}
