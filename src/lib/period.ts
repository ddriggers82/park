import type { LoanTerms } from './amortization';

// Which payment period the given calendar month falls in (1-based).
// Before the first payment, clamps to period 1.
export function currentPeriodIndex(terms: LoanTerms, todayISO: string): number {
  const [fy, fm] = terms.firstPaymentDate.split('-').map(Number);
  const [ty, tm] = todayISO.split('-').map(Number);
  const months = (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1));
  return months < 0 ? 1 : months + 1;
}
