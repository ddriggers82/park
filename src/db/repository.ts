import { eq, asc } from 'drizzle-orm';
import { db } from './client';
import { loans, payments } from './schema';
import type { LoanTerms, AppliedPayment } from '../lib/amortization';
import { ANCHOR_RIVER_LOAN } from '../lib/loan-terms';

export async function ensureAnchorRiverLoan(): Promise<number> {
  const existing = await db.select().from(loans).limit(1);
  if (existing.length > 0) return existing[0].id;
  const inserted = await db
    .insert(loans)
    .values({
      principalCents: ANCHOR_RIVER_LOAN.principalCents,
      annualRatePct: String(ANCHOR_RIVER_LOAN.annualRatePct),
      termMonths: ANCHOR_RIVER_LOAN.termMonths,
      paymentCents: ANCHOR_RIVER_LOAN.paymentCents,
      firstPaymentDate: ANCHOR_RIVER_LOAN.firstPaymentDate,
    })
    .returning({ id: loans.id });
  return inserted[0].id;
}

export async function getLoanTerms(loanId: number): Promise<LoanTerms> {
  const [row] = await db.select().from(loans).where(eq(loans.id, loanId));
  if (!row) throw new Error(`Loan ${loanId} not found`);
  return {
    principalCents: row.principalCents,
    annualRatePct: Number(row.annualRatePct),
    termMonths: row.termMonths,
    paymentCents: row.paymentCents,
    firstPaymentDate: row.firstPaymentDate,
  };
}

export async function getAppliedPayments(
  loanId: number,
): Promise<AppliedPayment[]> {
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.loanId, loanId))
    .orderBy(asc(payments.periodIndex));
  return rows.map((r) => ({ amountCents: r.amountCents }));
}

export async function addManualPayment(
  loanId: number,
  input: { periodIndex: number; amountCents: number; postedDate: string },
): Promise<void> {
  await db.insert(payments).values({
    loanId,
    periodIndex: input.periodIndex,
    amountCents: input.amountCents,
    source: 'manual',
    postedDate: input.postedDate,
  });
}
