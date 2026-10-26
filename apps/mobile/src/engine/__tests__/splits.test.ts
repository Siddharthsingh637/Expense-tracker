import { computeBalances, simplifyDebts } from '../splits';
import { GroupBill, PersonBalance } from '../types';

// Demo: 5 friends A-E paid 5000, 700, 200, 100, 2500 (total 8500, equal share 1700)
// Expected nets: A +3300, B -1000, C -1500, D -1600, E +800
const PARTY_BILL: GroupBill = {
  id: 'party',
  title: 'Party',
  date: '2025-10-01',
  personIds: ['A', 'B', 'C', 'D', 'E'],
  payments: { A: 500000, B: 70000, C: 20000, D: 10000, E: 250000 },
  method: 'equal',
  isSettled: false,
  createdAt: '2025-10-01T00:00:00Z',
};

describe('computeBalances - party scenario', () => {
  let balances: PersonBalance[];

  beforeEach(() => {
    balances = computeBalances(PARTY_BILL);
  });

  test('shares sum to total', () => {
    const total = Object.values(PARTY_BILL.payments).reduce((a, b) => a + b);
    expect(balances.reduce((s, b) => s + b.share, 0)).toBe(total);
  });

  test('nets match expected values', () => {
    // Using paise: 3300 * 100 = 330000, etc.
    const byId = Object.fromEntries(balances.map(b => [b.personId, b.net]));
    expect(byId.A).toBe(330000);
    expect(byId.B).toBe(-100000);
    expect(byId.C).toBe(-150000);
    expect(byId.D).toBe(-160000);
    expect(byId.E).toBe(80000);
  });
});

describe('simplifyDebts', () => {
  test('party resolves in 4 or fewer transfers', () => {
    const balances = computeBalances(PARTY_BILL);
    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThanOrEqual(4);
  });

  test('everyone ends at 0', () => {
    const balances = computeBalances(PARTY_BILL);
    const transfers = simplifyDebts(balances);
    const net: Record<string, number> = {};
    for (const b of balances) net[b.personId] = b.net;
    for (const t of transfers) {
      net[t.fromPersonId] = (net[t.fromPersonId] ?? 0) + t.amountPaise;
      net[t.toPersonId] = (net[t.toPersonId] ?? 0) - t.amountPaise;
    }
    for (const v of Object.values(net)) {
      expect(v).toBe(0);
    }
  });

  test('100 split 3 ways', () => {
    const bill: GroupBill = {
      id: 'test',
      title: 'Test',
      date: '2025-01-01',
      personIds: ['X', 'Y', 'Z'],
      payments: { X: 10000, Y: 0, Z: 0 }, // X paid ₹100 for all
      method: 'equal',
      isSettled: false,
      createdAt: '2025-01-01T00:00:00Z',
    };
    const balances = computeBalances(bill);
    expect(balances.reduce((s, b) => s + b.share, 0)).toBe(10000);
    const transfers = simplifyDebts(balances);
    expect(transfers.every(t => t.amountPaise > 0)).toBe(true);
    // verify settlement
    const net: Record<string, number> = {};
    for (const b of balances) net[b.personId] = b.net;
    for (const t of transfers) {
      net[t.fromPersonId] += t.amountPaise;
      net[t.toPersonId] -= t.amountPaise;
    }
    for (const v of Object.values(net)) expect(v).toBe(0);
  });
});
