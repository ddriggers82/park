import { describe, it, expect } from 'vitest';
import { ANCHOR_RIVER_LOAN } from './loan-terms';
import { generateSchedule } from './amortization';

describe('ANCHOR_RIVER_LOAN', () => {
  it('matches the signed promissory note', () => {
    expect(ANCHOR_RIVER_LOAN.principalCents).toBe(15_100_000);
    expect(ANCHOR_RIVER_LOAN.annualRatePct).toBe(8.5);
    expect(ANCHOR_RIVER_LOAN.termMonths).toBe(120);
    expect(ANCHOR_RIVER_LOAN.paymentCents).toBe(187_218);
    expect(ANCHOR_RIVER_LOAN.firstPaymentDate).toBe('2026-05-01');
  });

  it('the stated payment is internally consistent (level-payment formula rounds to it)', () => {
    const r = ANCHOR_RIVER_LOAN.annualRatePct / 100 / 12;
    const n = ANCHOR_RIVER_LOAN.termMonths;
    const computed = Math.round(
      (ANCHOR_RIVER_LOAN.principalCents * r) / (1 - Math.pow(1 + r, -n)),
    );
    expect(computed).toBe(ANCHOR_RIVER_LOAN.paymentCents);
  });

  it('produces a sane schedule', () => {
    const s = generateSchedule(ANCHOR_RIVER_LOAN);
    expect(s.finalBalanceCents).toBe(0);
    expect(s.payoffDate).toBe('2036-05-01');
  });
});
