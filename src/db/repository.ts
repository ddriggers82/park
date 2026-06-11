import { eq, asc } from 'drizzle-orm';
import { db } from './client';
import { loans, payments, expenseCredits } from './schema';
import type { LoanTerms, AppliedPayment } from '../lib/amortization';
import { ANCHOR_RIVER_LOAN } from '../lib/loan-terms';
import { aggregateSettlements } from '../lib/settlement';

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
  const [terms, pays, creds] = await Promise.all([
    getLoanTerms(loanId),
    db.select().from(payments).where(eq(payments.loanId, loanId)),
    db.select().from(expenseCredits).where(eq(expenseCredits.loanId, loanId)),
  ]);
  const cash = pays.map((p) => ({
    periodIndex: p.periodIndex,
    amountCents: p.amountCents,
  }));
  const activeCredits = creds
    .filter((c) => c.status === 'applied')
    .map((c) => ({ periodIndex: c.periodIndex, amountCents: c.amountCents }));
  return aggregateSettlements(cash, activeCredits, terms.paymentCents);
}

export async function addExpenseCredit(
  loanId: number,
  input: {
    periodIndex: number;
    amountCents: number;
    description: string;
    receiptUrl: string | null;
    createdBy: string;
  },
): Promise<void> {
  await db.insert(expenseCredits).values({ loanId, ...input });
}

export async function listExpenseCredits(loanId: number) {
  return db
    .select()
    .from(expenseCredits)
    .where(eq(expenseCredits.loanId, loanId))
    .orderBy(asc(expenseCredits.periodIndex));
}

export async function reverseExpenseCredit(
  creditId: number,
  reversedBy: string,
): Promise<void> {
  await db
    .update(expenseCredits)
    .set({ status: 'reversed', reversedBy, reversedAt: new Date() })
    .where(eq(expenseCredits.id, creditId));
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
