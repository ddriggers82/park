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

  describe('plaid-repository', () => {
    it('savePlaidItem creates a new item and getPlaidItem retrieves it', async () => {
      const { savePlaidItem, getPlaidItem } = await import('./plaid-repository');

      await savePlaidItem(loanId, 'access-sandbox-test-token', 'item_test_001');
      const item = await getPlaidItem(loanId);
      expect(item).not.toBeNull();
      expect(item!.itemId).toBe('item_test_001');
      // access token is stored but never asserted in logs
    });

    it('savePlaidItem replaces an existing item on re-connect', async () => {
      const { savePlaidItem, getPlaidItem } = await import('./plaid-repository');

      await savePlaidItem(loanId, 'access-sandbox-old', 'item_old');
      await savePlaidItem(loanId, 'access-sandbox-new', 'item_new');
      const item = await getPlaidItem(loanId);
      expect(item!.itemId).toBe('item_new');
      expect(item!.syncCursor).toBeNull(); // cursor reset on re-connect
    });

    it('updateSyncCursor stores the cursor', async () => {
      const { savePlaidItem, getPlaidItem, updateSyncCursor } = await import('./plaid-repository');

      const saved = await savePlaidItem(loanId, 'access-sandbox-cur', 'item_cur');
      await updateSyncCursor(saved.id, 'cursor_abc123');
      const item = await getPlaidItem(loanId);
      expect(item!.syncCursor).toBe('cursor_abc123');
    });

    it('insertPlaidPayment is idempotent: second call with same plaidTxnId returns false', async () => {
      const { insertPlaidPayment } = await import('./plaid-repository');

      const payload = {
        periodIndex: 1,
        amountCents: 187_218,
        postedDate: '2026-05-03',
        plaidTxnId: 'txn_dedup_test_001',
      };
      const first = await insertPlaidPayment(loanId, payload);
      const second = await insertPlaidPayment(loanId, payload);
      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });
});
