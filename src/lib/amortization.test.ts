import { describe, it, expect } from 'vitest';
import { generateSchedule, addMonths, type LoanTerms } from './amortization';

const TERMS: LoanTerms = {
  principalCents: 15_100_000,
  annualRatePct: 8.5,
  termMonths: 120,
  paymentCents: 187_218,
  firstPaymentDate: '2026-05-01',
};

describe('addMonths', () => {
  it('advances year/month and pins to the 1st', () => {
    expect(addMonths('2026-05-01', 0)).toBe('2026-05-01');
    expect(addMonths('2026-05-01', 119)).toBe('2036-04-01');
    expect(addMonths('2026-05-01', 8)).toBe('2027-01-01');
  });
});

describe('generateSchedule — golden master (no extra payments)', () => {
  const r = generateSchedule(TERMS);

  it('first period splits interest then principal', () => {
    expect(r.rows[0].interestCents).toBe(106958);   // $1,069.58
    expect(r.rows[0].principalCents).toBe(80260);   // $802.60
    expect(r.rows[0].balanceCents).toBe(15019740);  // $150,197.40
    expect(r.rows[0].dueDate).toBe('2026-05-01');
  });

  it('mid-loan balance matches at period 60', () => {
    expect(r.rows[59].balanceCents).toBe(9125278);  // $91,252.78
  });

  it('pays off in 121 payments with a small final true-up', () => {
    expect(r.periods).toBe(121);
    expect(r.rows[120].appliedCents).toBe(80);      // $0.80 final stub
    expect(r.payoffDate).toBe('2036-05-01');
  });

  it('ends at exactly zero balance', () => {
    expect(r.finalBalanceCents).toBe(0);
  });

  it('total interest matches', () => {
    expect(r.totalInterestCents).toBe(7366240);     // $73,662.40
  });

  it('reports no payments made when none are applied', () => {
    expect(r.paidPeriods).toBe(0);
    expect(r.paymentsRemaining).toBe(121);
    expect(r.lastPaymentDate).toBeNull();
    expect(r.lastPaymentCents).toBeNull();
    expect(r.currentBalanceCents).toBe(15_100_000); // full principal, nothing paid
  });
});

describe('generateSchedule — payment-progress fields with actual payments', () => {
  // Two real payments: month 1 on-schedule, month 2 a $2,000 overpay.
  const r = generateSchedule(TERMS, [{ amountCents: 187_218 }, { amountCents: 200_000 }]);

  it('counts paid vs remaining from the actual boundary', () => {
    expect(r.paidPeriods).toBe(2);
    expect(r.paymentsRemaining).toBe(r.periods - 2);
  });

  it('surfaces the last actual payment date and amount', () => {
    expect(r.lastPaymentDate).toBe('2026-06-01');
    expect(r.lastPaymentCents).toBe(200_000);       // $2,000.00
  });

  it('payoff amount is the balance after the last actual payment', () => {
    expect(r.currentBalanceCents).toBe(r.rows[1].balanceCents);
  });
});

describe('generateSchedule — extra principal shortens the term', () => {
  const r = generateSchedule(TERMS, [{ amountCents: 5_187_218 }]); // $50,000 extra in month 1

  it('flags the overpayment as extra', () => {
    expect(r.rows[0].isExtra).toBe(true);
    expect(r.rows[0].principalCents).toBe(5_080_260);
  });

  it('pays off far earlier, still landing on zero', () => {
    expect(r.periods).toBe(69);
    expect(r.payoffDate).toBe('2032-01-01');
    expect(r.finalBalanceCents).toBe(0);
    expect(r.totalInterestCents).toBe(2728187);     // $27,281.87
  });
});

describe('generateSchedule — partial payment', () => {
  const r = generateSchedule(TERMS, [{ amountCents: 150_000 }]); // $1,500 < scheduled

  it('applies interest first, leaving more principal outstanding', () => {
    expect(r.rows[0].interestCents).toBe(106958);
    expect(r.rows[0].principalCents).toBe(43042);   // 150000 - 106958
    expect(r.rows[0].balanceCents).toBe(15056958);  // higher than the on-schedule 15019740
    expect(r.rows[0].isExtra).toBe(false);
  });

  it('still amortizes to zero, carrying the shortfall to a larger final payment', () => {
    expect(r.finalBalanceCents).toBe(0);
    expect(r.totalInterestCents).toBe(7415821);             // $74,158.21 — more than the $73,662.40 baseline
    expect(r.rows[r.periods - 1].appliedCents).toBe(86879); // $868.79 final payment vs $0.80 on-schedule
  });
});
