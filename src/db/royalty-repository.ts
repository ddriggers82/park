import { eq, asc } from 'drizzle-orm';
import { db } from './client';
import { royaltyPeriods, type RoyaltyPeriodRow } from './schema';

/**
 * Ensure a royalty period row exists for the given year+dueDate.
 * Idempotent: if it already exists, returns the existing id.
 * Returns the row id.
 */
export async function openPeriod(year: number, dueDate: string): Promise<number> {
  const existing = await db
    .select({ id: royaltyPeriods.id })
    .from(royaltyPeriods)
    .where(eq(royaltyPeriods.dueDate, dueDate))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const inserted = await db
    .insert(royaltyPeriods)
    .values({ year, dueDate })
    .returning({ id: royaltyPeriods.id });
  return inserted[0].id;
}

/**
 * Record the buyer-reported gross income and compute the 25% owed.
 * Transitions status from 'open' to 'reported'.
 * Throws if the period is not found or is already 'paid'.
 */
export async function reportIncome(
  periodId: number,
  grossIncomeCents: number,
  royaltyCents: number,
  reportedBy: string,
): Promise<void> {
  const [row] = await db
    .select({ status: royaltyPeriods.status })
    .from(royaltyPeriods)
    .where(eq(royaltyPeriods.id, periodId));
  if (!row) throw new Error(`RoyaltyPeriod ${periodId} not found`);
  if (row.status === 'paid') throw new Error('Cannot re-report a paid royalty period');

  await db
    .update(royaltyPeriods)
    .set({
      grossIncomeCents,
      royaltyCents,
      status: 'reported',
      reportedBy,
      reportedAt: new Date(),
    })
    .where(eq(royaltyPeriods.id, periodId));
}

/**
 * Mark a royalty period as paid (seller confirms receipt).
 * Transitions status from 'reported' to 'paid'.
 * Throws if the period is not in 'reported' status.
 */
export async function confirmPaid(
  periodId: number,
  confirmedBy: string,
): Promise<void> {
  const [row] = await db
    .select({ status: royaltyPeriods.status })
    .from(royaltyPeriods)
    .where(eq(royaltyPeriods.id, periodId));
  if (!row) throw new Error(`RoyaltyPeriod ${periodId} not found`);
  if (row.status !== 'reported') {
    throw new Error(`Cannot confirm payment for a period with status '${row.status}'`);
  }

  await db
    .update(royaltyPeriods)
    .set({ status: 'paid', paidConfirmedBy: confirmedBy, paidAt: new Date() })
    .where(eq(royaltyPeriods.id, periodId));
}

/**
 * List all royalty periods, oldest due date first.
 */
export async function listPeriods(): Promise<RoyaltyPeriodRow[]> {
  return db
    .select()
    .from(royaltyPeriods)
    .orderBy(asc(royaltyPeriods.dueDate));
}
