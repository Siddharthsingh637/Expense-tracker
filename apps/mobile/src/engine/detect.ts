import { Transaction } from './types';

export interface DuplicateSuspect {
  txnIds: string[];
  reason: string;
}

/**
 * Flags transactions with the same amount on the same date as suspects.
 * Groups by (date, amount, categoryId).
 */
export function detectDuplicates(txns: Transaction[]): DuplicateSuspect[] {
  const groups = new Map<string, Transaction[]>();

  for (const txn of txns) {
    if (txn.isTransfer) {
      continue;
    }
    const key = `${txn.date}__${txn.amount}__${txn.categoryId}`;
    const group = groups.get(key);
    if (group) {
      group.push(txn);
    } else {
      groups.set(key, [txn]);
    }
  }

  const suspects: DuplicateSuspect[] = [];

  for (const group of groups.values()) {
    if (group.length >= 2) {
      const first = group[0];
      const rupees = (Math.abs(first.amount) / 100).toFixed(0);
      suspects.push({
        txnIds: group.map(t => t.id),
        reason: `${group.length} transactions of ₹${rupees} on ${first.date}`,
      });
    }
  }

  return suspects;
}
