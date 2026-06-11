import type { Cents } from './money';

export interface LoanTerms {
  principalCents: Cents;
  annualRatePct: number;
  termMonths: number;
  paymentCents: Cents;
  firstPaymentDate: string; // 'YYYY-MM-01'
}

export interface AppliedPayment {
  amountCents: Cents; // total amount applied to the loan for this period
}

export interface ScheduleRow {
  index: number;          // 1-based period
  dueDate: string;        // 'YYYY-MM-DD'
  appliedCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  balanceCents: Cents;    // ending balance
  isExtra: boolean;       // applied more than the scheduled payment
}

export interface ScheduleResult {
  rows: ScheduleRow[];
  payoffDate: string;
  totalInterestCents: Cents;
  finalBalanceCents: Cents;
  periods: number;
  paidPeriods: number;             // rows backed by an actual applied payment
  paymentsRemaining: number;       // periods - paidPeriods
  currentBalanceCents: Cents;      // outstanding balance after last actual payment (payoff amount); principal if none paid
  lastPaymentDate: string | null;  // dueDate of last actual payment, null if none
  lastPaymentCents: Cents | null;  // amount applied for last actual payment, null if none
}

export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function generateSchedule(
  terms: LoanTerms,
  actual: AppliedPayment[] = [],
): ScheduleResult {
  const monthlyRate = terms.annualRatePct / 100 / 12;
  const scheduled = terms.paymentCents;
  const maxPeriods = terms.termMonths * 5 + 12; // safety bound against runaway loops

  let balance = terms.principalCents;
  let totalInterest = 0;
  const rows: ScheduleRow[] = [];
  let i = 0;

  while (balance > 0 && i < maxPeriods) {
    i += 1;
    const interest = Math.round(balance * monthlyRate);
    let applied = i <= actual.length ? actual[i - 1].amountCents : scheduled;
    // Final true-up: never apply more than what zeroes the balance.
    if (applied >= balance + interest) {
      applied = balance + interest;
    }
    const principal = applied - interest;
    balance -= principal;
    totalInterest += interest;
    rows.push({
      index: i,
      dueDate: addMonths(terms.firstPaymentDate, i - 1),
      appliedCents: applied,
      interestCents: interest,
      principalCents: principal,
      balanceCents: balance,
      isExtra: applied > scheduled,
    });
  }

  const paidPeriods = Math.min(actual.length, rows.length);
  const lastPaid = paidPeriods > 0 ? rows[paidPeriods - 1] : null;

  return {
    rows,
    payoffDate: rows[rows.length - 1].dueDate,
    totalInterestCents: totalInterest,
    finalBalanceCents: balance,
    periods: rows.length,
    paidPeriods,
    paymentsRemaining: rows.length - paidPeriods,
    currentBalanceCents: lastPaid ? lastPaid.balanceCents : terms.principalCents,
    lastPaymentDate: lastPaid ? lastPaid.dueDate : null,
    lastPaymentCents: lastPaid ? lastPaid.appliedCents : null,
  };
}
