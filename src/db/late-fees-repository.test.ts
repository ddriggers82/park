import { describe, it, expect, beforeAll } from 'vitest';

const hasDb = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);

describe.skipIf(!hasDb)('late-fees repository (integration)', () => {
  let repo: typeof import('./late-fees-repository');
  let mainRepo: typeof import('./repository');
  let loanId: number;

  beforeAll(async () => {
    repo = await import('./late-fees-repository');
    mainRepo = await import('./repository');
    loanId = await mainRepo.ensureAnchorRiverLoan();
  });

  it('getSettlementsForPeriod returns empty for a period with no payments', async () => {
    const settlements = await repo.getSettlementsForPeriod(loanId, 999);
    expect(settlements).toEqual([]);
  });

  it('getSettlementsForPeriod returns a cash payment as a DatedSettlement', async () => {
    await mainRepo.addManualPayment(loanId, {
      periodIndex: 50,
      amountCents: 187_218,
      postedDate: '2030-06-07',
    });
    const settlements = await repo.getSettlementsForPeriod(loanId, 50);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].amountCents).toBe(187_218);
    expect(settlements[0].postedDate).toBe('2030-06-07');
  });

  it('upsertWaiver creates a waiver row', async () => {
    await repo.upsertWaiver(loanId, 50, 'user_seller_test');
    const waivers = await repo.listWaivers(loanId);
    const waived = waivers.find((w) => w.periodIndex === 50);
    expect(waived).toBeDefined();
    expect(waived?.waivedBy).toBe('user_seller_test');
  });

  it('upsertWaiver is idempotent — second call replaces the row', async () => {
    await repo.upsertWaiver(loanId, 50, 'user_seller_test_2');
    const waivers = await repo.listWaivers(loanId);
    const waived = waivers.filter((w) => w.periodIndex === 50);
    expect(waived).toHaveLength(1); // only one row for this period
    expect(waived[0].waivedBy).toBe('user_seller_test_2');
  });
});
