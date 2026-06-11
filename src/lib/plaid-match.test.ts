import { describe, it, expect } from 'vitest';
import {
  normalizeToPositiveCents,
  isIncomingDeposit,
  matchTransactionToPeriod,
  type RawPlaidTransaction,
} from './plaid-match';
import { ANCHOR_RIVER_LOAN } from './loan-terms';

// Plaid sign convention: amount < 0 means money entering the account (deposit).
// amount > 0 means money leaving (debit/outgoing).

describe('normalizeToPositiveCents', () => {
  it('converts a Plaid deposit amount (-2000.00) to positive integer cents (200000)', () => {
    expect(normalizeToPositiveCents(-2000.00)).toBe(200_000);
  });
  it('converts a small deposit (-1872.18) to 187218 cents', () => {
    expect(normalizeToPositiveCents(-1872.18)).toBe(187_218);
  });
  it('handles an already-positive value (e.g. misrouted debit) by taking absolute value', () => {
    expect(normalizeToPositiveCents(1872.18)).toBe(187_218);
  });
  it('rounds half-cents correctly: -1872.185 -> 187219', () => {
    expect(normalizeToPositiveCents(-1872.185)).toBe(187_219);
  });
});

describe('isIncomingDeposit', () => {
  it('returns true for negative amount (money entering account)', () => {
    expect(isIncomingDeposit({ amount: -1872.18, name: "KYLLONENS RV PARK" })).toBe(true);
  });
  it('returns false for positive amount (money leaving account)', () => {
    expect(isIncomingDeposit({ amount: 1872.18, name: "KYLLONENS RV PARK" })).toBe(false);
  });
  it('returns false for zero amount', () => {
    expect(isIncomingDeposit({ amount: 0, name: "KYLLONENS RV PARK" })).toBe(false);
  });
});

describe('matchTransactionToPeriod', () => {
  // ANCHOR_RIVER_LOAN.firstPaymentDate = '2026-05-01'
  // period 1 = May 2026, period 2 = June 2026, period 3 = July 2026

  it('maps a deposit dated 2026-05-03 to period 1 (May 2026)', () => {
    const txn: RawPlaidTransaction = {
      transaction_id: 'txn_001',
      amount: -1872.18,
      date: '2026-05-03',
      name: 'KYLLONENS RV PARK ACH DEPOSIT',
    };
    const result = matchTransactionToPeriod(txn, ANCHOR_RIVER_LOAN);
    expect(result.periodIndex).toBe(1);
    expect(result.amountCents).toBe(187_218);
    expect(result.matched).toBe(true);
  });

  it('maps a deposit dated 2026-06-03 to period 2 (June 2026)', () => {
    const txn: RawPlaidTransaction = {
      transaction_id: 'txn_002',
      amount: -2000.00,
      date: '2026-06-03',
      name: 'KYLLONENS RV PARK PAYMENT',
    };
    const result = matchTransactionToPeriod(txn, ANCHOR_RIVER_LOAN);
    expect(result.periodIndex).toBe(2);
    expect(result.amountCents).toBe(200_000);
    expect(result.matched).toBe(true);
  });

  it('marks a deposit as unmatched when description does not contain a known keyword', () => {
    const txn: RawPlaidTransaction = {
      transaction_id: 'txn_003',
      amount: -1872.18,
      date: '2026-05-03',
      name: 'AMAZON MARKETPLACE REFUND',
    };
    const result = matchTransactionToPeriod(txn, ANCHOR_RIVER_LOAN);
    expect(result.matched).toBe(false);
    expect(result.periodIndex).toBeNull();
  });

  it('marks a deposit as unmatched when amount is positive (outgoing)', () => {
    const txn: RawPlaidTransaction = {
      transaction_id: 'txn_004',
      amount: 1872.18,
      date: '2026-05-03',
      name: 'KYLLONENS RV PARK ACH',
    };
    const result = matchTransactionToPeriod(txn, ANCHOR_RIVER_LOAN);
    expect(result.matched).toBe(false);
    expect(result.periodIndex).toBeNull();
  });

  it('handles a pre-loan date (before 2026-05-01) by matching to period 1', () => {
    const txn: RawPlaidTransaction = {
      transaction_id: 'txn_005',
      amount: -1872.18,
      date: '2026-04-15',
      name: 'KYLLONENS RV PARK',
    };
    const result = matchTransactionToPeriod(txn, ANCHOR_RIVER_LOAN);
    expect(result.matched).toBe(true);
    expect(result.periodIndex).toBe(1);
  });
});
