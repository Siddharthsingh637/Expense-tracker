import { Paise } from './types';

/**
 * Distributes `total` paise across `n` items using the largest-remainder
 * (Hamilton/Hare) method so the integer parts always sum exactly to `total`.
 *
 * @param total    Total paise to distribute (must be non-negative integer)
 * @param weights  Non-negative numbers representing relative weights.
 *                 Need not sum to any particular value.
 * @returns        Integer paise array parallel to `weights`, summing to `total`.
 */
export function allocate(total: Paise, weights: number[]): Paise[] {
  if (weights.length === 0) {
    return [];
  }

  const sumWeights = weights.reduce((sum, w) => sum + w, 0);
  if (sumWeights <= 0 || total <= 0) {
    return weights.map(() => 0);
  }

  const bases: number[] = new Array(weights.length);
  const fractions: number[] = new Array(weights.length);
  let baseSum = 0;

  for (let i = 0; i < weights.length; i++) {
    const real = (total * weights[i]) / sumWeights;
    const base = Math.floor(real);
    bases[i] = base;
    fractions[i] = real - base;
    baseSum += base;
  }

  const remainder = total - baseSum;

  if (remainder > 0) {
    const indices = weights.map((_, i) => i);
    indices.sort((a, b) => {
      const diff = fractions[b] - fractions[a];
      if (Math.abs(diff) > 1e-9) {
        return diff;
      }
      return a - b;
    });

    for (let i = 0; i < remainder; i++) {
      bases[indices[i]] += 1;
    }
  }

  return bases;
}

/**
 * Convenience: split `total` equally among `count` people using
 * largest-remainder so shares always sum to `total`.
 */
export function splitEqual(total: Paise, count: number): Paise[] {
  if (count <= 0) {
    return [];
  }
  return allocate(total, Array(count).fill(1));
}
