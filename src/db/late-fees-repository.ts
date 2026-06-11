import { eq, and } from 'drizzle-orm';
import { db } from './client';
import { payments, expenseCredits, lateFeeWaivers } from './schema';
import type { LateFeeWaiverRow } from './schema';
import type { DatedSettlement } from '../lib/late-fees';

// Return all waiver rows for a loan. Caller builds a Set<periodIndex> for O(1) lookup.
export async function listWaivers(loanId: number): Promise<LateFeeWaiverRow[]> {
  return db
    .select()
    .from(lateFeeWaivers)
    .where(eq(lateFeeWaivers.loanId, loanId));
}

// Upsert a waiver for a single period.
// Uses delete-then-insert to remain compatible with Neon's Postgres without requiring
// a unique constraint (idempotent: calling twice for the same period is safe).
export async function upsertWaiver(
  loanId: number,
  periodIndex: number,
  waivedBy: string,
): Promise<void> {
  await db
    .delete(lateFeeWaivers)
    .where(
      and(
        eq(lateFeeWaivers.loanId, loanId),
        eq(lateFeeWaivers.periodIndex, periodIndex),
      ),
    );
  await db.insert(lateFeeWaivers).values({ loanId, periodIndex, waivedBy });
}

// Return all dated settlements (cash payments + active credits) for a single period.
// The result feeds assessLateFee -- no aggregation, just the raw date-tagged amounts.
export async function getSettlementsForPeriod(
  loanId: number,
  periodIndex: number,
): Promise<DatedSettlement[]> {
  const [pays, creds] = await Promise.all([
    db
      .select({ amountCents: payments.amountCents, postedDate: payments.postedDate })
      .from(payments)
      .where(and(eq(payments.loanId, loanId), eq(payments.periodIndex, periodIndex))),
    db
      .select({ amountCents: expenseCredits.amountCents, postedDate: expenseCredits.createdAt })
      .from(expenseCredits)
      .where(
        and(
          eq(expenseCredits.loanId, loanId),
          eq(expenseCredits.periodIndex, periodIndex),
          eq(expenseCredits.status, 'applied'),
        ),
      ),
  ]);

  // payments.postedDate is a date string; expenseCredits.createdAt is a Date object.
  const cashSettlements: DatedSettlement[] = pays.map((p) => ({
    amountCents: p.amountCents,
    postedDate: typeof p.postedDate === 'string'
      ? p.postedDate.slice(0, 10)
      : (p.postedDate as Date).toISOString().slice(0, 10),
  }));
  const creditSettlements: DatedSettlement[] = creds.map((c) => ({
    amountCents: c.amountCents,
    postedDate: c.postedDate instanceof Date
      ? c.postedDate.toISOString().slice(0, 10)
      : String(c.postedDate).slice(0, 10),
  }));

  return [...cashSettlements, ...creditSettlements];
}
