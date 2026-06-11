import { describe, it, expect, beforeAll } from 'vitest';

const hasDb = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);

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

  it('aggregates an active credit into applied payments and excludes reversed ones', async () => {
    await repo.addExpenseCredit(loanId, {
      periodIndex: 2,
      amountCents: 50_000,
      description: 'Paid borough tax',
      receiptUrl: null,
      createdBy: 'user_test',
    });
    const applied = await repo.getAppliedPayments(loanId);
    expect(applied[1].amountCents).toBeGreaterThanOrEqual(50_000);

    const [credit] = await repo.listExpenseCredits(loanId);
    await repo.reverseExpenseCredit(credit.id, 'user_seller');
    const list = await repo.listExpenseCredits(loanId);
    expect(list.find((c) => c.id === credit.id)?.status).toBe('reversed');
  });
});
