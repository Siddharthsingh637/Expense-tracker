import {
  GroupBill,
  PersonBalance,
  Paise,
  SettlementTransfer,
} from './types';
import { allocate } from './allocate';

/**
 * Total paise paid for this bill (sum of all values in bill.payments).
 */
export function totalPaid(bill: GroupBill): Paise {
  return Object.values(bill.payments ?? {}).reduce((sum, p) => sum + (p ?? 0), 0);
}

/**
 * Computes paid, share, and net for each person in bill.personIds.
 */
export function computeBalances(bill: GroupBill): PersonBalance[] {
  const { personIds, method } = bill;
  if (!personIds || personIds.length === 0) {
    return [];
  }

  const total = totalPaid(bill);
  let shares: Paise[] = [];

  switch (method) {
    case 'equal': {
      shares = allocate(total, personIds.map(() => 1));
      break;
    }

    case 'custom': {
      const customShares = personIds.map(id => bill.customShares?.[id] ?? 0);
      const sumCustom = customShares.reduce((a, b) => a + b, 0);
      if (sumCustom === total) {
        shares = customShares;
      } else {
        shares = allocate(total, sumCustom > 0 ? customShares : personIds.map(() => 1));
      }
      break;
    }

    case 'percent': {
      const weights = personIds.map(id => bill.percentShares?.[id] ?? 0);
      shares = allocate(total, weights);
      break;
    }

    case 'shares': {
      const weights = personIds.map(id => bill.shareWeights?.[id] ?? 0);
      shares = allocate(total, weights);
      break;
    }

    case 'itemized': {
      const subtotals: Record<string, Paise> = {};
      for (const id of personIds) {
        subtotals[id] = 0;
      }

      for (const item of bill.items ?? []) {
        const assigned = item.assignedPersonIds.filter(id => personIds.includes(id));
        if (assigned.length > 0 && item.amountPaise > 0) {
          const itemShares = allocate(item.amountPaise, assigned.map(() => 1));
          assigned.forEach((pid, idx) => {
            subtotals[pid] = (subtotals[pid] ?? 0) + itemShares[idx];
          });
        }
      }

      const extraPaise = (bill.taxPaise ?? 0) + (bill.tipPaise ?? 0);
      const subtotalWeights = personIds.map(id => subtotals[id] ?? 0);
      const extraShares =
        extraPaise > 0 ? allocate(extraPaise, subtotalWeights) : personIds.map(() => 0);

      shares = personIds.map((id, idx) => (subtotals[id] ?? 0) + extraShares[idx]);

      const itemsSum = (bill.items ?? []).reduce((s, it) => s + it.amountPaise, 0);
      const targetTotal = total > 0 ? total : itemsSum + extraPaise;
      const currentSum = shares.reduce((a, b) => a + b, 0);

      if (currentSum !== targetTotal) {
        shares = allocate(targetTotal, currentSum > 0 ? shares : personIds.map(() => 1));
      }
      break;
    }

    default: {
      shares = allocate(total, personIds.map(() => 1));
      break;
    }
  }

  return personIds.map((personId, idx) => {
    const paid = bill.payments?.[personId] ?? 0;
    const share = shares[idx] ?? 0;
    const net = paid - share;
    return {
      personId,
      paid,
      share,
      net,
    };
  });
}

/**
 * Greedy matching: repeatedly match the largest debtor with the largest creditor.
 */
export function simplifyDebts(balances: PersonBalance[]): SettlementTransfer[] {
  const creditors: Array<{ personId: string; net: Paise }> = [];
  const debtors: Array<{ personId: string; net: Paise }> = [];

  for (const b of balances) {
    if (b.net > 0) {
      creditors.push({ personId: b.personId, net: b.net });
    } else if (b.net < 0) {
      debtors.push({ personId: b.personId, net: -b.net });
    }
  }

  const transfers: SettlementTransfer[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort((a, b) => b.net - a.net);
    debtors.sort((a, b) => b.net - a.net);

    const creditor = creditors[0];
    const debtor = debtors[0];

    const amount = Math.min(creditor.net, debtor.net);
    if (amount <= 0) {
      break;
    }

    transfers.push({
      fromPersonId: debtor.personId,
      toPersonId: creditor.personId,
      amountPaise: amount,
      isPaid: false,
      paidAmountPaise: 0,
    });

    creditor.net -= amount;
    debtor.net -= amount;

    if (creditor.net === 0) {
      creditors.shift();
    }
    if (debtor.net === 0) {
      debtors.shift();
    }
  }

  return transfers;
}

/**
 * Returns the share for the given personId from computeBalances.
 */
export function myShare(bill: GroupBill, mePersonId: string): Paise {
  const balances = computeBalances(bill);
  const found = balances.find(b => b.personId === mePersonId);
  return found ? found.share : 0;
}
