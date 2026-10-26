import { parseBudgetPeriod, categorySpend } from '../budget';
import { Transaction, BudgetPeriod } from '../types';

describe('parseBudgetPeriod', () => {
  test('startDay=1 standard month', () => {
    const p = parseBudgetPeriod('2025-10', 1);
    expect(p.start).toBe('2025-10-01');
    expect(p.end).toBe('2025-10-31');
  });

  test('startDay=15 spans two calendar months', () => {
    const p = parseBudgetPeriod('2025-10', 15);
    expect(p.start).toBe('2025-10-15');
    expect(p.end).toBe('2025-11-14');
  });

  test('startDay=1 February non-leap', () => {
    const p = parseBudgetPeriod('2025-02', 1);
    expect(p.start).toBe('2025-02-01');
    expect(p.end).toBe('2025-02-28');
  });

  test('December with startDay=25 rolls to next year', () => {
    const p = parseBudgetPeriod('2025-12', 25);
    expect(p.start).toBe('2025-12-25');
    expect(p.end).toBe('2026-01-24');
  });
});

describe('categorySpend', () => {
  const period: BudgetPeriod = { start: '2025-10-01', end: '2025-10-31' };
  const txns: Transaction[] = [
    { id: '1', amount: 5000, categoryId: 'food', place: '', note: '', paymentMode: 'cash', date: '2025-10-05', time: '10:00', createdAt: '', provenance: 'user' },
    { id: '2', amount: 3000, categoryId: 'food', place: '', note: '', paymentMode: 'upi', date: '2025-10-20', time: '12:00', createdAt: '', provenance: 'user' },
    { id: '3', amount: 2000, categoryId: 'transport', place: '', note: '', paymentMode: 'cash', date: '2025-10-10', time: '09:00', createdAt: '', provenance: 'user' },
    { id: '4', amount: 1000, categoryId: 'food', place: '', note: '', paymentMode: 'cash', date: '2025-11-01', time: '10:00', createdAt: '', provenance: 'user' }, // outside period
  ];

  test('sums in-period transactions', () => {
    expect(categorySpend(txns, 'food', period)).toBe(8000);
  });

  test('excludes other categories', () => {
    expect(categorySpend(txns, 'transport', period)).toBe(2000);
  });

  test('excludes transactions outside period', () => {
    // Nov 1 txn should not count
    expect(categorySpend(txns, 'food', period)).toBe(8000);
  });
});
