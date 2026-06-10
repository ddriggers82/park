import { describe, it, expect } from 'vitest';
import { dollarsToCents, centsToDollars, formatCents } from './money';

describe('money', () => {
  it('converts dollars to integer cents without float drift', () => {
    expect(dollarsToCents(1872.18)).toBe(187218);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30); // would be 30.000000004 naively
  });

  it('converts cents back to dollars', () => {
    expect(centsToDollars(187218)).toBe(1872.18);
  });

  it('formats cents as USD', () => {
    expect(formatCents(187218)).toBe('$1,872.18');
    expect(formatCents(15100000)).toBe('$151,000.00');
    expect(formatCents(-5000)).toBe('-$50.00');
    expect(formatCents(0)).toBe('$0.00');
  });
});
