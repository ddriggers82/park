import { describe, it, expect } from 'vitest';
import { assessLateFee } from './late-fees';

const SCHEDULED = 187_218; // cents
const DUE = '2026-05-01';  // period 1 due date

describe('assessLateFee', () => {
  // --- Not late: paid on the due date ---
  it('is not late when satisfied on the due date (0 days)', () => {
    const result = assessLateFee(DUE, SCHEDULED, [
      { amountCents: 187_218, postedDate: '2026-05-01' },
    ], '2026-05-10');
    expect(result.isLate).toBe(false);
    expect(result.lateFeeOwedCents).toBe(0);
    expect(result.satisfiedDate).toBe('2026-05-01');
  });

  // --- Not late: paid exactly 5 days after due (within grace) ---
  it('is not late when satisfied exactly 5 days after due', () => {
    const result = assessLateFee(DUE, SCHEDULED, [
      { amountCents: 187_218, postedDate: '2026-05-06' },
    ], '2026-05-10');
    expect(result.isLate).toBe(false);
    expect(result.lateFeeOwedCents).toBe(0);
    expect(result.satisfiedDate).toBe('2026-05-06');
  });

  // --- Late: paid 6 days after due (one day past grace) ---
  it('is late when satisfied 6 days after due — single settlement', () => {
    const result = assessLateFee(DUE, SCHEDULED, [
      { amountCents: 187_218, postedDate: '2026-05-07' },
    ], '2026-05-10');
    expect(result.isLate).toBe(true);
    expect(result.lateFeeOwedCents).toBe(9_361); // round(187218 * 0.05)
    expect(result.satisfiedDate).toBe('2026-05-07');
  });

  // --- Late: two partial payments, second crosses threshold 6 days out ---
  it('uses the date of the settlement that pushed cumulative >= scheduled', () => {
    const result = assessLateFee(DUE, SCHEDULED, [
      { amountCents: 100_000, postedDate: '2026-05-05' },
      { amountCents:  87_218, postedDate: '2026-05-07' },
    ], '2026-06-10');
    expect(result.isLate).toBe(true);
    expect(result.lateFeeOwedCents).toBe(9_361);
    expect(result.satisfiedDate).toBe('2026-05-07');
  });

  // --- Late: first partial arrives on time, second is late ---
  it('is not late when first partial settlement already satisfies the period on time', () => {
    const result = assessLateFee(DUE, SCHEDULED, [
      { amountCents: 187_218, postedDate: '2026-05-04' },
      { amountCents:  50_000, postedDate: '2026-05-09' }, // second is late but irrelevant
    ], '2026-06-10');
    expect(result.isLate).toBe(false);
    expect(result.satisfiedDate).toBe('2026-05-04');
  });

  // --- Unsatisfied + today > 5 days past due ---
  it('is late when never satisfied and today is >5 days past due', () => {
    const result = assessLateFee(DUE, SCHEDULED, [], '2026-06-10');
    expect(result.isLate).toBe(true);
    expect(result.lateFeeOwedCents).toBe(9_361);
    expect(result.satisfiedDate).toBeNull();
  });

  // --- Unsatisfied + today <= 5 days past due (still in grace) ---
  it('is not late when never satisfied and today is within the 5-day grace', () => {
    const result = assessLateFee(DUE, SCHEDULED, [], '2026-05-04'); // 3 days after due
    expect(result.isLate).toBe(false);
    expect(result.lateFeeOwedCents).toBe(0);
    expect(result.satisfiedDate).toBeNull();
  });

  // --- Partial payment (never satisfies) + today is late ---
  it('is late when partially paid but never satisfied and today is >5 days past due', () => {
    const result = assessLateFee(DUE, SCHEDULED, [
      { amountCents: 50_000, postedDate: '2026-05-02' },
    ], '2026-06-10');
    expect(result.isLate).toBe(true);
    expect(result.lateFeeOwedCents).toBe(9_361);
    expect(result.satisfiedDate).toBeNull();
  });

  // --- Overpayment: extra above scheduled still satisfies on the posting date ---
  it('treats overpayment as satisfied on the posting date of the excess settlement', () => {
    const result = assessLateFee(DUE, SCHEDULED, [
      { amountCents: 200_000, postedDate: '2026-05-03' }, // > 187218, on time
    ], '2026-06-10');
    expect(result.isLate).toBe(false);
    expect(result.satisfiedDate).toBe('2026-05-03');
  });
});
