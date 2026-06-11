import { describe, it, expect, beforeAll } from 'vitest';

const hasDb = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);

describe.skipIf(!hasDb)('royalty-repository integration', () => {
  let repo: typeof import('./royalty-repository');
  const testDueDate = '2025-07-01'; // Use a past date to avoid colliding with live data.
  let periodId: number;

  beforeAll(async () => {
    repo = await import('./royalty-repository');
    // Clean up any leftover test row from a prior run.
    const { db } = await import('./client');
    const { royaltyPeriods } = await import('./schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(royaltyPeriods).where(eq(royaltyPeriods.dueDate, testDueDate));
  });

  it('openPeriod creates a new row and returns its id', async () => {
    periodId = await repo.openPeriod(2025, testDueDate);
    expect(typeof periodId).toBe('number');
    expect(periodId).toBeGreaterThan(0);
  });

  it('openPeriod is idempotent -- same id on second call', async () => {
    const id2 = await repo.openPeriod(2025, testDueDate);
    expect(id2).toBe(periodId);
  });

  it('reportIncome updates the row and transitions to reported', async () => {
    const { royaltyOwed } = await import('../lib/royalty');
    const gross = 500_000; // $5,000.00 gross
    const owed = royaltyOwed(gross); // 125_000 = $1,250.00
    await repo.reportIncome(periodId, gross, owed, 'user_buyer_test');

    const periods = await repo.listPeriods();
    const row = periods.find((p) => p.id === periodId);
    expect(row?.status).toBe('reported');
    expect(row?.grossIncomeCents).toBe(500_000);
    expect(row?.royaltyCents).toBe(125_000);
    expect(row?.reportedBy).toBe('user_buyer_test');
  });

  it('confirmPaid transitions the row to paid', async () => {
    await repo.confirmPaid(periodId, 'user_seller_test');

    const periods = await repo.listPeriods();
    const row = periods.find((p) => p.id === periodId);
    expect(row?.status).toBe('paid');
    expect(row?.paidConfirmedBy).toBe('user_seller_test');
    expect(row?.paidAt).not.toBeNull();
  });

  it('confirmPaid throws when status is not reported', async () => {
    // The row is now 'paid'; confirming again should throw.
    await expect(
      repo.confirmPaid(periodId, 'user_seller_test'),
    ).rejects.toThrow("Cannot confirm payment for a period with status 'paid'");
  });

  it('listPeriods returns rows ordered by dueDate ascending', async () => {
    // Open a second period to verify ordering.
    await repo.openPeriod(2025, '2025-10-01');
    const periods = await repo.listPeriods();
    const dueDates = periods.map((p) => p.dueDate);
    const sorted = [...dueDates].sort();
    expect(dueDates).toEqual(sorted);
  });
});
