import type { LoanTerms } from './amortization';

// Anchor River RV, LLC -> Kyllonen's RV Park, LLC owner-financed note.
// Terms from the signed promissory note (see docs/superpowers/specs).
export const ANCHOR_RIVER_LOAN: LoanTerms = {
  principalCents: 15_100_000, // $151,000.00
  annualRatePct: 8.5,
  termMonths: 120, // 10 years
  paymentCents: 187_218, // $1,872.18
  firstPaymentDate: '2026-05-01',
};
