import { describe, it, expect, beforeAll } from 'vitest';

const hasDb = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);

describe.skipIf(!hasDb)('compliance-repository integration', () => {
  let repo: typeof import('./compliance-repository');

  beforeAll(async () => {
    repo = await import('./compliance-repository');
  });

  // Tax obligations

  it('addTaxObligation returns a row with status=open', async () => {
    const row = await repo.addTaxObligation({
      parcelGroup: 'Parcels A & B',
      dueDateISO: '2026-09-30',
      delinquencyDateISO: '2026-10-15',
      createdBy: 'user_seller_test',
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.status).toBe('open');
    expect(row.paidBy).toBeNull();
  });

  it('listTaxObligations includes the inserted row', async () => {
    const rows = await repo.listTaxObligations();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].parcelGroup).toBe('Parcels A & B');
  });

  it('markTaxPaid transitions status to paid and sets paidBy', async () => {
    const [first] = await repo.listTaxObligations();
    await repo.markTaxPaid(first.id, {
      proofUrl: 'https://example.com/receipt.pdf',
      paidBy: 'user_seller_test',
    });
    const [updated] = await repo.listTaxObligations();
    expect(updated.status).toBe('paid');
    expect(updated.paidBy).toBe('user_seller_test');
    expect(updated.proofUrl).toBe('https://example.com/receipt.pdf');
  });

  // Insurance policies

  it('addInsurancePolicy returns a row with status=active', async () => {
    const row = await repo.addInsurancePolicy({
      carrier: 'State Farm',
      policyNumber: 'SF-123456',
      coverageCents: 27_600_000, // $276,000 in cents
      effectiveDateISO: '2026-01-01',
      expirationDateISO: '2027-01-01',
      lossPayeeConfirmed: 1,
      declarationsUrl: null,
      createdBy: 'user_buyer_test',
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.status).toBe('active');
    expect(row.lossPayeeConfirmed).toBe(1);
  });

  it('listInsurancePolicies includes the inserted policy', async () => {
    const rows = await repo.listInsurancePolicies();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].carrier).toBe('State Farm');
  });
});
