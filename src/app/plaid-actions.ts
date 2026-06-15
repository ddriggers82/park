'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { Products, CountryCode } from 'plaid';
import { plaid, plaidCall } from '../lib/plaid';
import { matchTransactionToPeriod } from '../lib/plaid-match';
import {
  savePlaidItem,
  getPlaidItem,
  updateSyncCursor,
  insertPlaidPayment,
} from '../db/plaid-repository';
import { ensureAnchorRiverLoan, getLoanTerms } from '../db/repository';
import { requireSeller } from '../lib/current-role';

export interface UnmatchedDeposit {
  transactionId: string;
  amountCents: number;
  date: string;
  rawName: string;
}

export interface SyncResult {
  inserted: number;
  duplicates: number;
  unmatched: UnmatchedDeposit[];
}

/**
 * Generate a Plaid Link token for the seller. Returns the short-lived link_token
 * string (safe to send to the client -- it is single-use and expires in 30 minutes).
 * Never returns the access_token.
 */
export async function createLinkToken(): Promise<string> {
  await requireSeller();
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  const res = await plaidCall(() =>
    plaid.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'Park Payments',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    }),
  );
  return res.data.link_token;
}

/**
 * Exchange the public_token from Plaid Link for a persistent access_token,
 * then store it server-side in plaid_items. Returns void.
 * The access_token is NEVER sent to the client.
 */
export async function exchangePublicToken(publicToken: string): Promise<void> {
  await requireSeller();
  const loanId = await ensureAnchorRiverLoan();

  const res = await plaidCall(() =>
    plaid.itemPublicTokenExchange({ public_token: publicToken }),
  );
  const accessToken = res.data.access_token;
  const itemId = res.data.item_id;

  await savePlaidItem(loanId, accessToken, itemId);
  revalidatePath('/');
}

/**
 * Pull new transactions from Plaid using the cursor-based sync loop.
 * Matched deposits are inserted into payments (idempotent).
 * Unmatched deposits are returned for the seller to review.
 */
export async function syncTransactions(): Promise<SyncResult> {
  await requireSeller();
  const loanId = await ensureAnchorRiverLoan();
  const terms = await getLoanTerms(loanId);
  const item = await getPlaidItem(loanId);
  if (!item) throw new Error('No Plaid account connected. Connect your bank account first.');

  let cursor: string | undefined = item.syncCursor ?? undefined;
  let hasMore = true;
  const allAdded: Array<{ transaction_id: string; amount: number; date: string; name: string }> = [];

  while (hasMore) {
    const res = await plaidCall(() =>
      plaid.transactionsSync({
        access_token: item.accessToken,
        cursor,
      }),
    );
    allAdded.push(
      ...res.data.added.map((t) => ({
        transaction_id: t.transaction_id,
        amount: t.amount,
        date: t.date,
        name: t.name ?? '',
      })),
    );
    cursor = res.data.next_cursor;
    hasMore = res.data.has_more;
  }

  // Persist the new cursor immediately so a crash mid-insert does not re-fetch.
  if (cursor) {
    await updateSyncCursor(item.id, cursor);
  }

  let inserted = 0;
  let duplicates = 0;
  const unmatched: UnmatchedDeposit[] = [];

  for (const txn of allAdded) {
    const match = matchTransactionToPeriod(txn, terms);
    if (!match.matched || match.periodIndex === null) {
      // Only surface incoming deposits as unmatched; skip outgoing entirely.
      if (txn.amount < 0) {
        unmatched.push({
          transactionId: txn.transaction_id,
          amountCents: match.amountCents,
          date: txn.date,
          rawName: txn.name,
        });
      }
      continue;
    }

    const didInsert = await insertPlaidPayment(loanId, {
      periodIndex: match.periodIndex,
      amountCents: match.amountCents,
      postedDate: txn.date,
      plaidTxnId: txn.transaction_id,
    });
    if (didInsert) {
      inserted += 1;
    } else {
      duplicates += 1;
    }
  }

  revalidatePath('/');
  return { inserted, duplicates, unmatched };
}
