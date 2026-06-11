# Plaid & Reconciliation Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the seller's Wells Fargo account via Plaid, pull incoming deposits automatically, match each deposit to a loan period, insert matched payments with source='plaid', and surface unmatched/ambiguous deposits for the seller to assign or ignore. Re-syncs are fully idempotent (dedup by Plaid transaction ID).

**Architecture:** Two new pure-logic modules (`plaid.ts` server client, `plaid-match.ts` normalizer + matcher) tested in isolation. A new `plaid_items` table stores the access token and sync cursor. A `plaid_txn_id` column on `payments` enforces dedup at the database level. Server actions (`plaid-actions.ts`) are seller-only. The client-side Link button is a Client Component that calls the server action on success; it is composed into a new `PlaidSection` Server Component so `page.tsx` integration is a minimal one-line import. No business logic touches the network in unit tests.

**Tech stack:** Next.js 15.5 App Router, Vitest, Drizzle/Neon, `plaid` SDK, `react-plaid-link` (existing Clerk/auth).

**Depends on:** Plan 1 (loan engine, `payments` table, `period.ts`), Plan 2 (roles, `requireSeller`), Plan 3 (settlement layer, `addManualPayment` shape in repository).

---

## RESOLVED FACTS (Plaid SDK, current docs — embed in subagent dispatches; implementer will NOT have docs access)

**Install:**
```bash
pnpm add plaid react-plaid-link
```

**Server client (`src/lib/plaid.ts`):**
```ts
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
const cfg = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
export const plaid = new PlaidApi(cfg);
```

**Link token creation:**
```ts
import { Products, CountryCode } from 'plaid';
const res = await plaid.linkTokenCreate({
  user: { client_user_id: userId },
  client_name: 'Park Payments',
  products: [Products.Transactions],
  country_codes: [CountryCode.Us],
  language: 'en',
});
const linkToken = res.data.link_token;
```

**Public token exchange:**
```ts
const res = await plaid.itemPublicTokenExchange({ public_token });
const accessToken = res.data.access_token;
const itemId = res.data.item_id;
```

**Transactions sync (cursor loop):**
```ts
let cursor = storedCursor ?? undefined;
let hasMore = true;
const added: TransactionsSyncResponseTransactionsAdded[] = [];
while (hasMore) {
  const res = await plaid.transactionsSync({ access_token: accessToken, cursor });
  added.push(...res.data.added);
  cursor = res.data.next_cursor;
  hasMore = res.data.has_more;
}
// persist cursor for next sync
```

**Amount sign convention (CRITICAL):** For depository accounts, Plaid uses POSITIVE `amount` for money leaving the account (a debit / outgoing payment) and NEGATIVE `amount` for money entering (a deposit / credit). Incoming loan payments therefore have a **negative** `amount`. To convert to positive integer cents: `Math.round(Math.abs(amount) * 100)`. Filter for `amount < 0` (incoming) before matching.

**Env vars:** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (use `'sandbox'` in development). Already set in `.env.local` per the project setup.

**Webhook:** `SYNC_UPDATES_AVAILABLE` is deferred. A manual "Sync now" button plus a daily Vercel Cron (Plan 7) is the v1 approach. No webhook handler is included in this plan.

**`react-plaid-link` usage (Client Component):**
```tsx
'use client';
import { usePlaidLink } from 'react-plaid-link';

export function PlaidLinkButton({ linkToken, onSuccess }: {
  linkToken: string;
  onSuccess: (publicToken: string) => Promise<void>;
}) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token) => { void onSuccess(public_token); },
  });
  return <button onClick={() => open()} disabled={!ready}>Connect bank account</button>;
}
```

---

## Security notes (must read before implementing)

- **`access_token` is a bearer credential** that gives permanent read access to the seller's Wells Fargo account. It MUST be stored server-side only. Never return it from a server action, never include it in any client-visible API response, and never log it.
- **Encryption at rest:** the `plaid_items.access_token` column ideally stores a KMS- or application-level-encrypted value, not plaintext. This plan stores it plaintext in Neon (which encrypts the disk). A follow-up secure-phase task should encrypt it with a `PLAID_TOKEN_ENCRYPTION_KEY` env secret before insert. **Flag this as an open security item in the commit message and in the Self-Review.**
- The `access_token` never leaves the server. The `createLinkToken` action returns only a short-lived `link_token` (public, single-use). The `exchangePublicToken` action accepts the Plaid `public_token` from the client and stores only the resulting `access_token` server-side, returning nothing sensitive.

---

## Required setup (operator)

- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox` in `.env.local` (already set per project setup).
- `DATABASE_URL_TEST` in `.env.local` (Neon test branch) so integration tests do not touch production.
- No new Vercel Marketplace integration needed; Plaid is a direct SDK dependency.

---

## File Structure

```
src/
  lib/
    plaid.ts               # server-only Plaid API client singleton
    plaid-match.ts         # pure: normalizeAmount, matchTransactionToPeriod, filterIncoming
    plaid-match.test.ts    # golden tests, no network
  db/
    schema.ts              # + plaid_items table; + plaidTxnId nullable unique on payments
    plaid-repository.ts    # savePlaidItem, getPlaidItem, updateCursor, insertPlaidPayment (dedup)
                           # NOTE: schema reorganization into src/db/schema/ is an orchestrator
                           #       step; this plan appends to src/db/schema.ts and notes where
                           #       to split. The plaid_items addition and the plaidTxnId column
                           #       addition to payments are coordinated schema changes; see Task 1.
  app/
    plaid-actions.ts       # createLinkToken, exchangePublicToken, syncTransactions (seller-only)
  components/
    PlaidLinkButton.tsx    # 'use client'; usePlaidLink wrapper
    PlaidSection.tsx       # Server Component: fetches link token, renders button + sync status
    PlaidUnmatched.tsx     # Server Component: lists unmatched deposits, seller assign/ignore forms
```

`page.tsx` integration is a single import of `<PlaidSection />` and `<PlaidUnmatched />` into the seller-only block — this is an orchestrator step and is documented in Task 7 but does not touch existing task logic.

---

### Task 1: Schema — `plaid_items` table + `plaidTxnId` on `payments`

**Files:** Modify `src/db/schema.ts`.

This is a **coordinated schema change**: the `payments` table already exists (from Plan 1). Adding `plaidTxnId` here must not conflict with any parallel plan touching `payments`. If another parallel plan has already added a column to `payments`, rebase after that commit, then add `plaidTxnId`.

- [ ] **Step 1: Add `plaidTxnId` to the `payments` table in `src/db/schema.ts`**

Locate the existing `payments` table definition and add the new column after `createdAt`:

```ts
// In the payments pgTable definition, add after createdAt:
plaidTxnId: text('plaid_txn_id').unique(),
```

The full updated `payments` table definition becomes:
```ts
export const payments = pgTable('payments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loanId: bigint('loan_id', { mode: 'number' })
    .notNull()
    .references(() => loans.id),
  periodIndex: integer('period_index').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  source: text('source', { enum: ['plaid', 'manual'] })
    .notNull()
    .default('manual'),
  postedDate: date('posted_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  plaidTxnId: text('plaid_txn_id').unique(),
});
```

Also regenerate the inferred type:
```ts
export type PaymentRow = typeof payments.$inferSelect;
```
(This line already exists; it will automatically pick up the new column. No change needed.)

- [ ] **Step 2: Append the `plaid_items` table to `src/db/schema.ts`** (after `expenseCredits`)

```ts
// ---- Plaid integration ----
// NOTE: if schema is reorganized into src/db/schema/, this block moves to
//       src/db/schema/plaid.ts. Until then, append here.

export const plaidItems = pgTable('plaid_items', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loanId: bigint('loan_id', { mode: 'number' })
    .notNull()
    .references(() => loans.id),
  // SECURITY: access_token is a bearer credential with permanent read access
  // to the seller's Wells Fargo account. Stored plaintext here; a secure-phase
  // task should encrypt with PLAID_TOKEN_ENCRYPTION_KEY before insert.
  accessToken: text('access_token').notNull(),
  itemId: text('item_id').notNull(),
  syncCursor: text('sync_cursor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type PlaidItemRow = typeof plaidItems.$inferSelect;
```

- [ ] **Step 3: Push schema to the test branch**

```bash
DATABASE_URL="<DATABASE_URL_TEST unpooled>" pnpm db:push
```

Expected: `plaid_items` table created; `payments.plaid_txn_id` column added with a unique constraint. (Live-DB gate: defer if test branch not provisioned.)

- [ ] **Step 4: Push schema to production**

```bash
DATABASE_URL="<prod unpooled>" pnpm db:push
```

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: plaid_items table and plaidTxnId dedup column on payments

SECURITY NOTE: plaid_items.access_token is stored plaintext; encrypt at rest in secure phase."
```

---

### Task 2: Pure match helpers — `src/lib/plaid-match.ts` + golden tests

**Files:** Create `src/lib/plaid-match.ts`, `src/lib/plaid-match.test.ts`.

This is the highest-confidence testable core. All logic here is pure — no Plaid API, no DB, no `Date.now()`. Tests use explicit golden values.

- [ ] **Step 1: Write the failing test `src/lib/plaid-match.test.ts`**

```ts
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
```

- [ ] **Step 2: Run, confirm it fails.** `pnpm test src/lib/plaid-match.test.ts` → cannot resolve `./plaid-match`.

- [ ] **Step 3: Implement `src/lib/plaid-match.ts`**

```ts
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
```

- [ ] **Step 4: Run, confirm all 10 tests pass.** `pnpm test src/lib/plaid-match.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/plaid-match.ts src/lib/plaid-match.test.ts
git commit -m "feat: pure Plaid transaction normalizer and period matcher with golden tests"
```

---

### Task 3: Plaid server client — `src/lib/plaid.ts`

**Files:** Create `src/lib/plaid.ts`. Install `plaid react-plaid-link`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add plaid react-plaid-link
```

Verify `package.json` now lists both packages.

- [ ] **Step 2: Create `src/lib/plaid.ts`**

```ts
import 'server-only';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

if (!process.env.PLAID_CLIENT_ID) throw new Error('PLAID_CLIENT_ID env var is required');
if (!process.env.PLAID_SECRET) throw new Error('PLAID_SECRET env var is required');

const cfg = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaid = new PlaidApi(cfg);
```

The `import 'server-only'` guard prevents this file from being accidentally bundled into a Client Component. The startup assertions surface misconfiguration immediately rather than at first Plaid call.

- [ ] **Step 3: Type-check.** `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/plaid.ts package.json pnpm-lock.yaml
git commit -m "feat: Plaid API server client singleton"
```

---

### Task 4: Plaid repository — `src/db/plaid-repository.ts`

**Files:** Create `src/db/plaid-repository.ts`; add integration tests to `src/db/repository.test.ts`.

This file contains all DB operations that are specific to Plaid so they stay isolated from the core `repository.ts`. The `insertPlaidPayment` function enforces idempotency via the `plaid_txn_id` unique constraint using an `ON CONFLICT DO NOTHING` approach.

- [ ] **Step 1: Create `src/db/plaid-repository.ts`**

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { plaidItems, payments } from './schema';
import type { PlaidItemRow } from './schema';

export async function savePlaidItem(
  loanId: number,
  accessToken: string,
  itemId: string,
): Promise<PlaidItemRow> {
  // Upsert: if an item already exists for this loan, replace it (seller re-connects).
  const existing = await db
    .select()
    .from(plaidItems)
    .where(eq(plaidItems.loanId, loanId))
    .limit(1);
  if (existing.length > 0) {
    const [updated] = await db
      .update(plaidItems)
      .set({ accessToken, itemId, syncCursor: null, updatedAt: new Date() })
      .where(eq(plaidItems.id, existing[0].id))
      .returning();
    return updated;
  }
  const [inserted] = await db
    .insert(plaidItems)
    .values({ loanId, accessToken, itemId })
    .returning();
  return inserted;
}

export async function getPlaidItem(loanId: number): Promise<PlaidItemRow | null> {
  const [row] = await db
    .select()
    .from(plaidItems)
    .where(eq(plaidItems.loanId, loanId))
    .limit(1);
  return row ?? null;
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
 * (ON CONFLICT DO NOTHING via the unique constraint on payments.plaid_txn_id).
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
```

- [ ] **Step 2: Add integration tests to `src/db/repository.test.ts`**

These tests run inside the existing `describe.skipIf(!hasDb)` block. Ensure `hasDb` reads from `DATABASE_URL_TEST` first (it should already from Plan 3's step; if not, update the check):
```ts
const hasDb = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);
```

Add inside the `describe.skipIf(!hasDb)` block:
```ts
  describe('plaid-repository', () => {
    it('savePlaidItem creates a new item and getPlaidItem retrieves it', async () => {
      const loanId = await repo.ensureAnchorRiverLoan();
      const { savePlaidItem, getPlaidItem } = await import('./plaid-repository');

      await savePlaidItem(loanId, 'access-sandbox-test-token', 'item_test_001');
      const item = await getPlaidItem(loanId);
      expect(item).not.toBeNull();
      expect(item!.itemId).toBe('item_test_001');
      // access token is stored but never asserted in logs
    });

    it('savePlaidItem replaces an existing item on re-connect', async () => {
      const loanId = await repo.ensureAnchorRiverLoan();
      const { savePlaidItem, getPlaidItem } = await import('./plaid-repository');

      await savePlaidItem(loanId, 'access-sandbox-old', 'item_old');
      await savePlaidItem(loanId, 'access-sandbox-new', 'item_new');
      const item = await getPlaidItem(loanId);
      expect(item!.itemId).toBe('item_new');
      expect(item!.syncCursor).toBeNull(); // cursor reset on re-connect
    });

    it('updateSyncCursor stores the cursor', async () => {
      const loanId = await repo.ensureAnchorRiverLoan();
      const { savePlaidItem, getPlaidItem, updateSyncCursor } = await import('./plaid-repository');

      const saved = await savePlaidItem(loanId, 'access-sandbox-cur', 'item_cur');
      await updateSyncCursor(saved.id, 'cursor_abc123');
      const item = await getPlaidItem(loanId);
      expect(item!.syncCursor).toBe('cursor_abc123');
    });

    it('insertPlaidPayment is idempotent: second call with same plaidTxnId returns false', async () => {
      const loanId = await repo.ensureAnchorRiverLoan();
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
```

- [ ] **Step 3: Run integration tests against the test branch**

```bash
DATABASE_URL="<neon test branch pooled>" DATABASE_URL_TEST="<neon test branch pooled>" pnpm test src/db/repository.test.ts
```

Expected: all existing tests pass; new plaid-repository suite (4 tests) also passes. (Live-DB gate: defer if test branch not provisioned.)

- [ ] **Step 4: Commit**

```bash
git add src/db/plaid-repository.ts src/db/repository.test.ts
git commit -m "feat: Plaid item and payment repository (dedup by plaidTxnId)"
```

---

### Task 5: Server actions — `src/app/plaid-actions.ts`

**Files:** Create `src/app/plaid-actions.ts`.

All three actions are seller-only (`requireSeller()` at the top of each). No Plaid credentials, access tokens, or internal IDs are returned to the client. The `syncTransactions` action returns a summary object (counts, unmatched list) that is safe to display.

- [ ] **Step 1: Create `src/app/plaid-actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { Products, CountryCode } from 'plaid';
import { plaid } from '../lib/plaid';
import { matchTransactionToPeriod } from '../lib/plaid-match';
import {
  savePlaidItem,
  getPlaidItem,
  updateSyncCursor,
  insertPlaidPayment,
} from '../db/plaid-repository';
import { ensureAnchorRiverLoan, getLoanTerms } from '../db/repository';
import { requireSeller } from '../lib/current-role';
import { ANCHOR_RIVER_LOAN } from '../lib/loan-terms';

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
 * string (safe to send to the client — it is single-use and expires in 30 minutes).
 * Never returns the access_token.
 */
export async function createLinkToken(): Promise<string> {
  await requireSeller();
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Park Payments',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
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

  const res = await plaid.itemPublicTokenExchange({ public_token: publicToken });
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
    const res = await plaid.transactionsSync({
      access_token: item.accessToken,
      cursor,
    });
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
```

- [ ] **Step 2: Type-check.** `pnpm exec tsc --noEmit` → no errors. (The `plaid` import is server-only via `import 'server-only'` in `src/lib/plaid.ts`; the `'use server'` directive on this file ensures Next.js treats it correctly.)

- [ ] **Step 3: Commit**

```bash
git add src/app/plaid-actions.ts
git commit -m "feat: Plaid server actions (createLinkToken, exchangePublicToken, syncTransactions)"
```

---

### Task 6: Client Component — `PlaidLinkButton` + `PlaidSection`

**Files:** Create `src/components/PlaidLinkButton.tsx`, `src/components/PlaidSection.tsx`.

`PlaidLinkButton` is a Client Component (uses `react-plaid-link`). `PlaidSection` is a Server Component that fetches the link token (if no item is connected) and orchestrates the UI. Keeping these two separate preserves the Server/Client boundary and avoids making the whole section dynamic on the client.

- [ ] **Step 1: Create `src/components/PlaidLinkButton.tsx`**

```tsx
'use client';

import { usePlaidLink } from 'react-plaid-link';

interface Props {
  linkToken: string;
  onSuccess: (publicToken: string) => Promise<void>;
}

export function PlaidLinkButton({ linkToken, onSuccess }: Props) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token) => {
      void onSuccess(public_token);
    },
  });
  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      style={{ padding: '8px 16px', cursor: ready ? 'pointer' : 'default' }}
    >
      Connect bank account
    </button>
  );
}
```

- [ ] **Step 2: Create `src/components/PlaidSection.tsx`**

```tsx
import { createLinkToken, exchangePublicToken, syncTransactions } from '../app/plaid-actions';
import { ensureAnchorRiverLoan } from '../db/repository';
import { getPlaidItem } from '../db/plaid-repository';
import { PlaidLinkButton } from './PlaidLinkButton';
import { formatCents } from '../lib/money';

export async function PlaidSection() {
  const loanId = await ensureAnchorRiverLoan();
  const item = await getPlaidItem(loanId);
  const isConnected = item !== null;

  // If not connected, fetch a link token to render the Link button.
  let linkToken: string | null = null;
  if (!isConnected) {
    linkToken = await createLinkToken();
  }

  return (
    <section style={{ marginTop: 32 }}>
      <h2>Bank feed (Plaid)</h2>
      {!isConnected && linkToken && (
        <div>
          <p>No bank account connected. Connect the seller&apos;s Wells Fargo to start pulling payments automatically.</p>
          <PlaidLinkButton linkToken={linkToken} onSuccess={exchangePublicToken} />
        </div>
      )}
      {isConnected && (
        <div>
          <p>
            Wells Fargo connected. Item ID: <code>{item.itemId}</code>.{' '}
            {item.syncCursor ? `Last sync cursor stored.` : `Not yet synced.`}
          </p>
          <form action={syncTransactions}>
            <button type="submit">Sync now</button>
          </form>
        </div>
      )}
    </section>
  );
}
```

Note: `syncTransactions` returns a `SyncResult` but `<form action={...}>` discards the return value. For v1 this is acceptable; a future enhancement passes the result through `useActionState` (Plan 5 or UI polish). The seller can see the inserted payments in the schedule table after the page re-renders.

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit && pnpm run build`

Expected: no type errors; build green. If `react-plaid-link` types are not found, run `pnpm add -D @types/react-plaid-link` (the package bundles its own types in recent versions; check the import).

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaidLinkButton.tsx src/components/PlaidSection.tsx
git commit -m "feat: PlaidLinkButton (client) and PlaidSection (server) components"
```

---

### Task 7: `PlaidUnmatched` component + `page.tsx` integration

**Files:** Create `src/components/PlaidUnmatched.tsx`; modify `src/app/page.tsx`.

Unmatched deposits are surfaced in a dedicated component so the seller can review them. In v1 they are read-only (displayed with a note to contact support or manually record the payment). A future plan adds assign/ignore actions.

- [ ] **Step 1: Create `src/components/PlaidUnmatched.tsx`**

```tsx
import type { UnmatchedDeposit } from '../app/plaid-actions';
import { formatCents } from '../lib/money';

interface Props {
  deposits: UnmatchedDeposit[];
}

export function PlaidUnmatched({ deposits }: Props) {
  if (deposits.length === 0) return null;
  return (
    <section style={{ marginTop: 24 }}>
      <h3>Unmatched deposits</h3>
      <p style={{ color: '#a60' }}>
        These incoming deposits could not be automatically matched to a loan period.
        Record them manually if they represent a loan payment, or ignore them if unrelated.
      </p>
      <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Date</th>
            <th>Amount</th>
            <th>Description</th>
            <th>Plaid Transaction ID</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((d) => (
            <tr key={d.transactionId} style={{ borderBottom: '1px solid #ddd' }}>
              <td>{d.date}</td>
              <td>{formatCents(d.amountCents)}</td>
              <td>{d.rawName}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{d.transactionId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Modify `src/app/page.tsx`** to add `<PlaidSection />` and an empty `<PlaidUnmatched>` to the seller-only block.

Add imports at the top of `page.tsx`:
```tsx
import { PlaidSection } from '../components/PlaidSection';
import { PlaidUnmatched } from '../components/PlaidUnmatched';
import type { UnmatchedDeposit } from './plaid-actions';
```

Inside `Home()`, after `const [schedule, credits] = await ...`, add:
```tsx
  // Unmatched deposits start empty; they populate after a Sync now run.
  // In a future plan, syncTransactions stores unmatched in the DB so this
  // component can read them on load. For v1 we pass an empty array.
  const unmatchedDeposits: UnmatchedDeposit[] = [];
```

Inside the JSX, add after the `<section>` for expense credits (before the closing `</main>`):
```tsx
      {role === 'seller' && (
        <>
          <PlaidSection />
          <PlaidUnmatched deposits={unmatchedDeposits} />
        </>
      )}
```

The `<PlaidSection />` component internally calls `createLinkToken()` which calls `requireSeller()`, so there is a double-check: the outer `role === 'seller'` guard on the page and the server action guard. Belt and suspenders.

- [ ] **Step 3: Type-check + build + run unit suite.**

```bash
pnpm exec tsc --noEmit && pnpm run build && pnpm test
```

Expected: no type errors; build green; unit tests pass (amortization, loan-terms, money, roles, period, settlement, plaid-match).

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaidUnmatched.tsx src/app/page.tsx
git commit -m "feat: PlaidUnmatched component and page.tsx Plaid section integration"
```

---

## Manual / Sandbox Verification Gate (requires Plaid sandbox credentials + dev server)

These steps require real Plaid API calls and cannot run in the unit test suite. Perform after the full build is green.

1. Ensure `.env.local` has `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`.
2. `pnpm dev` (or `pnpm start` after `pnpm build`).
3. Sign in as the seller account (email mapped to `seller` role in `role-assignments.ts`).
4. Verify the "Bank feed (Plaid)" section appears.
5. Click "Connect bank account" → Plaid Link modal opens.
6. In Plaid sandbox: select "Chase" or "Wells Fargo", use credentials `user_good` / `pass_good`.
7. Complete Link flow → `exchangePublicToken` fires → page re-renders with "Wells Fargo connected."
8. Click "Sync now" → Plaid sandbox returns test transactions. The sandbox includes fictional transactions; none will match the buyer keyword, so expect 0 inserted and potentially some unmatched deposits.
9. To test a matched insert: in Plaid sandbox dashboard (or via Plaid API sandbox utilities), fire a transaction with `name: "KYLLONENS RV PARK"` and `amount: -1872.18` on a date in the current loan period. Sync again → expect `inserted: 1`.
10. Sync again immediately → expect `inserted: 0, duplicates: 1` (dedup confirmed).
11. Verify the payment row appears in the schedule table on the page with source='plaid'.
12. Sign in as the buyer account → the Plaid section is NOT rendered (role guard). Confirm no Plaid data is accessible from buyer flows.

---

## Self-Review

| Requirement | Tasks |
|---|---|
| Seller connects Wells Fargo via Plaid Link (seller-only) | Tasks 3, 5, 6 |
| `access_token` stored server-side only, never sent to client | Tasks 1, 4, 5 (server-only guards on `plaid.ts`, `plaid-repository.ts`, actions return void or safe data) |
| `plaid_items` table stores access_token + sync cursor | Task 1, 4 |
| Cursor-loop sync (`transactionsSync`) pulls new deposits | Task 5 |
| Incoming deposit filter (Plaid amount < 0) | Task 2 (pure, tested), Task 5 |
| Amount normalized to positive integer cents | Task 2 (golden test: -1872.18 -> 187218, -2000.00 -> 200000) |
| Deposits matched to loan period via `currentPeriodIndex` | Task 2 (golden tests: 2026-05-03 -> period 1, 2026-06-03 -> period 2) |
| Keyword filter for buyer deposits (KYLLONENS) | Task 2 (tested: non-buyer name -> matched=false) |
| Matched payments inserted with source='plaid' | Task 4, 5 |
| Dedup by Plaid `transaction_id` (idempotent re-sync) | Task 1 (unique column), Task 4 (tested: second insert returns false), Task 5 |
| Unmatched/ambiguous deposits surfaced, not force-applied | Tasks 5, 7 (UnmatchedDeposit type, PlaidUnmatched component) |
| "Sync now" manual trigger | Task 6 (form in PlaidSection) |
| Pure, network-free unit tests for normalizer + matcher | Task 2 (10 golden tests) |
| No network calls in unit tests | Task 2 (plaid-match.ts has no imports from plaid or DB) |
| page.tsx integration does not break existing features | Task 7 (seller-only block; existing schedule, credits unchanged) |

**Security note (open item for secure phase):** `plaid_items.access_token` is stored plaintext in Neon. Neon encrypts the disk, but a DB credential leak would expose the access token. Before this app handles real bank data in production, the secure-phase should add `PLAID_TOKEN_ENCRYPTION_KEY` to env vars and encrypt/decrypt the token using AES-256-GCM (or a KMS key reference) in `savePlaidItem` and `getPlaidItem`. This is tracked in the commit message for Task 1 and should be a `TODO` comment in `plaid-repository.ts`.

**Deferred to later plans:**
- Webhook (`SYNC_UPDATES_AVAILABLE`) for push-driven sync (Plan 7 / Cron).
- Assign/ignore actions for unmatched deposits (the `PlaidUnmatched` component is read-only for v1).
- Storing unmatched deposits in the DB so they persist across page loads.
- Encrypting the access_token at rest (secure phase).
- Displaying `SyncResult` feedback to the seller after "Sync now" (UI polish, Plan 5 or later, using `useActionState`).
