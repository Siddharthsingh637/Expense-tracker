import { allocate, splitEqual } from '../allocate';

describe('allocate', () => {
  test('equal weights', () => {
    expect(splitEqual(1000, 3)).toEqual([334, 333, 333]); // or similar that sums to 1000
    expect(splitEqual(1000, 3).reduce((a, b) => a + b)).toBe(1000);
  });

  test('100 split 3 ways sums exactly', () => {
    const parts = splitEqual(10000, 3); // ₹100 in paise
    expect(parts.reduce((a, b) => a + b)).toBe(10000);
  });

  test('unequal weights', () => {
    // weights [3,1,1] total 500
    const result = allocate(500, [3, 1, 1]);
    expect(result.reduce((a, b) => a + b)).toBe(500);
    expect(result[0]).toBe(300);
  });

  test('all zero weights returns zeros', () => {
    expect(allocate(1000, [0, 0, 0])).toEqual([0, 0, 0]);
  });

  test('single item gets full amount', () => {
    expect(allocate(999, [1])).toEqual([999]);
  });
});
