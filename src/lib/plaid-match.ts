import { currentPeriodIndex } from './period';
import type { LoanTerms } from './amortization';

// Known keywords indicating this is a buyer loan payment hitting the seller's account.
const BUYER_KEYWORDS = ['kyllonens', "kyllonen's", 'kyllonen'];

export interface RawPlaidTransaction {
  transaction_id: string;
  amount: number;   // Plaid convention: negative = incoming deposit, positive = outgoing debit
  date: string;     // YYYY-MM-DD
  name: string;
}

export interface MatchResult {
  transactionId: string;
  amountCents: number;
  date: string;
  matched: boolean;
  periodIndex: number | null;
  rawName: string;
}

/**
 * Convert a Plaid transaction amount to positive integer cents.
 * Takes the absolute value before rounding so callers do not have to pre-filter.
 */
export function normalizeToPositiveCents(plaidAmount: number): number {
  return Math.round(Math.abs(plaidAmount) * 100);
}

/**
 * Returns true when the transaction represents money entering the account
 * (Plaid amount < 0 for a depository account).
 */
export function isIncomingDeposit(txn: Pick<RawPlaidTransaction, 'amount'>): boolean {
  return txn.amount < 0;
}

/**
 * Attempt to match a raw Plaid transaction to a loan period.
 * - Filters out outgoing transactions (amount >= 0).
 * - Filters out transactions whose name does not contain a buyer keyword.
 * - Maps the transaction date to a period via currentPeriodIndex.
 * Returns a MatchResult with matched=false and periodIndex=null for any miss.
 */
export function matchTransactionToPeriod(
  txn: RawPlaidTransaction,
  terms: LoanTerms,
): MatchResult {
  const base: Omit<MatchResult, 'matched' | 'periodIndex'> = {
    transactionId: txn.transaction_id,
    amountCents: normalizeToPositiveCents(txn.amount),
    date: txn.date,
    rawName: txn.name,
  };

  if (!isIncomingDeposit(txn)) {
    return { ...base, matched: false, periodIndex: null };
  }

  const nameLower = txn.name.toLowerCase();
  const hasBuyerKeyword = BUYER_KEYWORDS.some((kw) => nameLower.includes(kw));
  if (!hasBuyerKeyword) {
    return { ...base, matched: false, periodIndex: null };
  }

  const periodIndex = currentPeriodIndex(terms, txn.date);
  return { ...base, matched: true, periodIndex };
}
