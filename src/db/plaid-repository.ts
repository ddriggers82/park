import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { plaidItems, payments } from './schema';
import type { PlaidItemRow } from './schema';
import { encryptSecret, decryptSecret } from '../lib/crypto';

// Plaid access tokens are encrypted at rest with AES-256-GCM (see src/lib/crypto.ts).
// They are encrypted on write (savePlaidItem) and decrypted on read (getPlaidItem),
// so callers always see plaintext. Neon also encrypts disk, but this guards against a
// DB-credential leak exposing the raw token.

export async function savePlaidItem(
  loanId: number,
  accessToken: string,
  itemId: string,
): Promise<PlaidItemRow> {
  const encrypted = encryptSecret(accessToken);
  // Upsert: if an item already exists for this loan, replace it (seller re-connects).
  const existing = await db
    .select()
    .from(plaidItems)
    .where(eq(plaidItems.loanId, loanId))
    .limit(1);
  if (existing.length > 0) {
    const [updated] = await db
      .update(plaidItems)
      .set({ accessToken: encrypted, itemId, syncCursor: null, updatedAt: new Date() })
      .where(eq(plaidItems.id, existing[0].id))
      .returning();
    return { ...updated, accessToken };
  }
  const [inserted] = await db
    .insert(plaidItems)
    .values({ loanId, accessToken: encrypted, itemId })
    .returning();
  return { ...inserted, accessToken };
}

export async function getPlaidItem(loanId: number): Promise<PlaidItemRow | null> {
  const [row] = await db
    .select()
    .from(plaidItems)
    .where(eq(plaidItems.loanId, loanId))
    .limit(1);
  if (!row) return null;
  return { ...row, accessToken: decryptSecret(row.accessToken) };
}

export async function updateSyncCursor(
  itemId: number,
  cursor: string,
): Promise<void> {
  await db
    .update(plaidItems)
    .set({ syncCursor: cursor, updatedAt: new Date() })
    .where(eq(plaidItems.id, itemId));
}

/**
 * Insert a Plaid-sourced payment. Idempotent: silently skips if plaidTxnId already exists
 * (enforced by the unique constraint on payments.plaid_txn_id).
 *
 * Returns true if the row was inserted, false if it was a duplicate.
 */
export async function insertPlaidPayment(
  loanId: number,
  input: {
    periodIndex: number;
    amountCents: number;
    postedDate: string;
    plaidTxnId: string;
  },
): Promise<boolean> {
  // Drizzle does not expose onConflictDoNothing in all versions; use a manual check.
  const existing = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.plaidTxnId, input.plaidTxnId))
    .limit(1);
  if (existing.length > 0) return false;

  await db.insert(payments).values({
    loanId,
    periodIndex: input.periodIndex,
    amountCents: input.amountCents,
    source: 'plaid',
    postedDate: input.postedDate,
    plaidTxnId: input.plaidTxnId,
  });
  return true;
}
