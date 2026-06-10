import { describe, it, expect, beforeAll } from 'vitest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('repository (integration)', () => {
  let repo: typeof import('./repository');
  let loanId: number;

  beforeAll(async () => {
    repo = await import('./repository');
    loanId = await repo.ensureAnchorRiverLoan();
  });

  it('loads loan terms in engine shape', async () => {
    const terms = await repo.getLoanTerms(loanId);
    expect(terms.principalCents).toBe(15_100_000);
    expect(terms.paymentCents).toBe(187_218);
    expect(terms.firstPaymentDate).toBe('2026-05-01');
  });

  it('adds a manual payment and returns it in order', async () => {
    await repo.addManualPayment(loanId, {
      periodIndex: 1,
      amountCents: 187_218,
      postedDate: '2026-05-01',
    });
    const applied = await repo.getAppliedPayments(loanId);
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied[0].amountCents).toBe(187_218);
  });
});
