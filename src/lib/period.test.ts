import { describe, it, expect } from 'vitest';
import { currentPeriodIndex } from './period';
import { ANCHOR_RIVER_LOAN } from './loan-terms';

describe('currentPeriodIndex', () => {
  it('is period 1 on the first payment date', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-05-01')).toBe(1);
  });
  it('is period 1 before the loan starts', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-01-15')).toBe(1);
  });
  it('advances one period per month', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-06-10')).toBe(2);
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2027-05-01')).toBe(13);
  });
  it('mid-month counts the current month, not the next', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-05-31')).toBe(1);
  });
});
