# Settlement & Credits Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the buyer log an expense credit (with a receipt file) that auto-applies to the current month's payment, let the seller review and reverse credits, and fold credits into the loan's settlement so the schedule and balance reflect them.

**Architecture:** Preserves the two-ledger model. The loan ledger (engine) is unchanged. A new settlement layer aggregates cash payments plus active (non-reversed) expense credits per period into the `AppliedPayment[]` the engine already consumes. Credits auto-apply to the current period (derived from today's date); overpayment by any route still spills to principal via the existing engine. Receipts are uploaded to Vercel Blob. Role boundary: buyers create credits, sellers reverse them.

**Tech Stack:** Next.js 15.5 App Router, Vitest, Drizzle/Neon, `@vercel/blob`, Clerk (existing).

**Depends on:** Plan 1 (engine, payments) and Plan 2 (roles). Late fees are deferred to Plan 3b.

## RESOLVED FACTS (Vercel Blob, from current docs — embed in subagent dispatches)
- Install: `pnpm add @vercel/blob`.
- `import { put, del } from '@vercel/blob'`.
- Upload: `const blob = await put(pathname, file, { access: 'public', addRandomSuffix: true });` then use `blob.url`. `put` auto-reads `BLOB_READ_WRITE_TOKEN` from env.
- Delete: `await del(url)`.
- `access: 'public'` + `addRandomSuffix: true` yields an unguessable URL. (Receipts are financial PII; a future secure-phase should move these to `access: 'private'` with signed access. Tracked, not done here.)

## Required setup (operator)
- `BLOB_READ_WRITE_TOKEN` in `.env.local` (create a Blob store in the Vercel dashboard).
- `DATABASE_URL_TEST` in `.env.local` (a Neon test branch pooled connection string) so integration tests do not touch production.

## File Structure
```
src/
  lib/
    period.ts            # pure: currentPeriodIndex(terms, todayISO)
    period.test.ts
    settlement.ts        # pure: aggregateSettlements(payments, credits, scheduledCents, ...)
    settlement.test.ts
  db/
    schema.ts            # + expense_credits table
    repository.ts        # + credit CRUD; getAppliedPayments aggregates cash + credits
    repository.test.ts   # + credit integration tests (DATABASE_URL_TEST)
  lib/
    blob.ts              # uploadReceipt(file) -> { url }; deleteReceipt(url)
  app/
    actions.ts           # + submitCredit (buyer), reverseCredit (seller)
    page.tsx             # + credit form (buyer) + credits list with reverse (seller)
```

---

### Task 1: Settlement schema (expense_credits)

**Files:** Modify `src/db/schema.ts`.

- [ ] **Step 1: Add the table to `src/db/schema.ts`** (append after `payments`)

```ts
export const expenseCredits = pgTable('expense_credits', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loanId: bigint('loan_id', { mode: 'number' })
    .notNull()
    .references(() => loans.id),
  periodIndex: integer('period_index').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  description: text('description').notNull(),
  receiptUrl: text('receipt_url'),
  status: text('status', { enum: ['applied', 'reversed'] })
    .notNull()
    .default('applied'),
  createdBy: text('created_by').notNull(), // Clerk user id
  createdAt: timestamp('created_at').defaultNow().notNull(),
  reversedAt: timestamp('reversed_at'),
  reversedBy: text('reversed_by'),
});

export type ExpenseCreditRow = typeof expenseCredits.$inferSelect;
```

- [ ] **Step 2: Push schema to the test branch and production**

Run (test branch first): `DATABASE_URL="<DATABASE_URL_TEST unpooled or pooled>" pnpm db:push`
Then production: `DATABASE_URL="<prod unpooled>" pnpm db:push`
Expected: `expense_credits` table created in both. (Defer if Neon/test not yet provisioned; this is the live gate.)

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: expense_credits settlement table"
```

---

### Task 2: Pure currentPeriodIndex

**Files:** Create `src/lib/period.ts`, `src/lib/period.test.ts`.

- [ ] **Step 1: Write the failing test `src/lib/period.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { currentPeriodIndex } from './period';
import { ANCHOR_RIVER_LOAN } from './loan-terms';

describe('currentPeriodIndex', () => {
  it('is period 1 on the first payment date', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-05-01')).toBe(1);
  });
  it('is period 1 before the loan starts', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-01-15')).toBe(1);
  });
  it('advances one period per month', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-06-10')).toBe(2);
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2027-05-01')).toBe(13);
  });
  it('mid-month counts the current month, not the next', () => {
    expect(currentPeriodIndex(ANCHOR_RIVER_LOAN, '2026-05-31')).toBe(1);
  });
});
```

- [ ] **Step 2: Run, confirm it fails.** `pnpm test src/lib/period.test.ts` → cannot resolve `./period`.

- [ ] **Step 3: Implement `src/lib/period.ts`**

```ts
import type { LoanTerms } from './amortization';

// Which payment period the given calendar month falls in (1-based).
// Before the first payment, clamps to period 1.
export function currentPeriodIndex(terms: LoanTerms, todayISO: string): number {
  const [fy, fm] = terms.firstPaymentDate.split('-').map(Number);
  const [ty, tm] = todayISO.split('-').map(Number);
  const months = (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1));
  return months < 0 ? 1 : months + 1;
}
```

- [ ] **Step 4: Run, confirm pass (4 tests).**

- [ ] **Step 5: Commit**

```bash
git add src/lib/period.ts src/lib/period.test.ts
git commit -m "feat: currentPeriodIndex (auto current-month mapping)"
```

---

### Task 3: Pure settlement aggregation

**Files:** Create `src/lib/settlement.ts`, `src/lib/settlement.test.ts`.

The engine consumes `AppliedPayment[]` positionally (period i uses `actual[i-1]`, else scheduled). This aggregator turns the two ledgers (cash payments + active credits, each tagged with a `periodIndex`) into that array: each period's entry is the sum of its cash and active credits, or the scheduled payment if nothing was recorded for that period (on-track assumption). Reversed credits are excluded by the caller before aggregation.

- [ ] **Step 1: Write the failing test `src/lib/settlement.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { aggregateSettlements } from './settlement';

const SCHEDULED = 187_218;

describe('aggregateSettlements', () => {
  it('returns empty when nothing recorded', () => {
    expect(aggregateSettlements([], [], SCHEDULED)).toEqual([]);
  });

  it('sums cash and credits within a period', () => {
    const out = aggregateSettlements(
      [{ periodIndex: 1, amountCents: 100_000 }],
      [{ periodIndex: 1, amountCents: 87_218 }],
      SCHEDULED,
    );
    expect(out).toEqual([{ amountCents: 187_218 }]);
  });

  it('fills unsettled gaps below the max period with the scheduled amount', () => {
    const out = aggregateSettlements(
      [{ periodIndex: 3, amountCents: 187_218 }],
      [],
      SCHEDULED,
    );
    // periods 1 and 2 had no record -> scheduled; period 3 -> recorded
    expect(out).toEqual([
      { amountCents: 187_218 },
      { amountCents: 187_218 },
      { amountCents: 187_218 },
    ]);
  });

  it('reflects an overpayment (cash + credit > scheduled) for spill-to-principal', () => {
    const out = aggregateSettlements(
      [{ periodIndex: 1, amountCents: 187_218 }],
      [{ periodIndex: 1, amountCents: 50_000 }],
      SCHEDULED,
    );
    expect(out[0].amountCents).toBe(237_218);
  });
});
```

- [ ] **Step 2: Run, confirm it fails.**

- [ ] **Step 3: Implement `src/lib/settlement.ts`**

```ts
import type { AppliedPayment } from './amortization';

export interface PeriodAmount {
  periodIndex: number;
  amountCents: number;
}

// Aggregate cash payments + (already-filtered active) credits into the engine's
// positional AppliedPayment[]. Periods with no record default to `scheduledCents`.
export function aggregateSettlements(
  payments: PeriodAmount[],
  credits: PeriodAmount[],
  scheduledCents: number,
): AppliedPayment[] {
  const all = [...payments, ...credits];
  if (all.length === 0) return [];
  const byPeriod = new Map<number, number>();
  for (const { periodIndex, amountCents } of all) {
    byPeriod.set(periodIndex, (byPeriod.get(periodIndex) ?? 0) + amountCents);
  }
  const maxPeriod = Math.max(...byPeriod.keys());
  const out: AppliedPayment[] = [];
  for (let i = 1; i <= maxPeriod; i += 1) {
    out.push({ amountCents: byPeriod.get(i) ?? scheduledCents });
  }
  return out;
}
```

- [ ] **Step 4: Run, confirm pass (4 tests).**

- [ ] **Step 5: Commit**

```bash
git add src/lib/settlement.ts src/lib/settlement.test.ts
git commit -m "feat: pure settlement aggregation of cash + credits"
```

---

### Task 4: Blob receipt helper

**Files:** Create `src/lib/blob.ts`. Install `@vercel/blob`.

- [ ] **Step 1: Install.** `pnpm add @vercel/blob`

- [ ] **Step 2: Create `src/lib/blob.ts`**

```ts
import 'server-only';
import { put, del } from '@vercel/blob';

export async function uploadReceipt(file: File): Promise<string> {
  const blob = await put(`receipts/${file.name}`, file, {
    access: 'public',
    addRandomSuffix: true,
  });
  return blob.url;
}

export async function deleteReceipt(url: string): Promise<void> {
  await del(url);
}
```

- [ ] **Step 3: Type-check.** `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/blob.ts package.json
git commit -m "feat: vercel blob receipt upload helper"
```

---

### Task 5: Repository — credit CRUD + aggregated applied payments

**Files:** Modify `src/db/repository.ts`; add tests to `src/db/repository.test.ts`.

- [ ] **Step 1: Add to `src/db/repository.ts`**

Add imports: `expenseCredits` from `./schema`; `aggregateSettlements` from `../lib/settlement`; keep existing imports.

Replace `getAppliedPayments` and add credit functions:

```ts
import { aggregateSettlements } from '../lib/settlement';
import { expenseCredits } from './schema';

export async function getAppliedPayments(
  loanId: number,
): Promise<AppliedPayment[]> {
  const [terms, pays, creds] = await Promise.all([
    getLoanTerms(loanId),
    db.select().from(payments).where(eq(payments.loanId, loanId)),
    db
      .select()
      .from(expenseCredits)
      .where(eq(expenseCredits.loanId, loanId)),
  ]);
  const cash = pays.map((p) => ({
    periodIndex: p.periodIndex,
    amountCents: p.amountCents,
  }));
  const activeCredits = creds
    .filter((c) => c.status === 'applied')
    .map((c) => ({ periodIndex: c.periodIndex, amountCents: c.amountCents }));
  return aggregateSettlements(cash, activeCredits, terms.paymentCents);
}

export async function addExpenseCredit(
  loanId: number,
  input: {
    periodIndex: number;
    amountCents: number;
    description: string;
    receiptUrl: string | null;
    createdBy: string;
  },
): Promise<void> {
  await db.insert(expenseCredits).values({ loanId, ...input });
}

export async function listExpenseCredits(loanId: number) {
  return db
    .select()
    .from(expenseCredits)
    .where(eq(expenseCredits.loanId, loanId))
    .orderBy(asc(expenseCredits.periodIndex));
}

export async function reverseExpenseCredit(
  creditId: number,
  reversedBy: string,
): Promise<void> {
  await db
    .update(expenseCredits)
    .set({ status: 'reversed', reversedBy, reversedAt: new Date() })
    .where(eq(expenseCredits.id, creditId));
}
```

- [ ] **Step 2: Add integration tests to `src/db/repository.test.ts`** (inside the existing `describe.skipIf(!hasDb)` block; note `hasDb` should prefer `DATABASE_URL_TEST`)

At the top of the test file change the DB detection to prefer the test branch:
```ts
const hasDb = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);
```
And add:
```ts
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
```

- [ ] **Step 3: Run integration tests against the test branch**

Run: `DATABASE_URL_TEST="<neon test branch url>" pnpm test src/db/repository.test.ts`
Expected: PASS. (The connection used by the Drizzle client is `DATABASE_URL`; for the test run, set `DATABASE_URL` to the test branch too: `DATABASE_URL="<test>" DATABASE_URL_TEST="<test>" pnpm test ...`.)

- [ ] **Step 4: Commit**

```bash
git add src/db/repository.ts src/db/repository.test.ts
git commit -m "feat: credit CRUD and credit-aware applied payments"
```

---

### Task 6: Server actions — submit credit (buyer), reverse credit (seller)

**Files:** Modify `src/app/actions.ts`.

- [ ] **Step 1: Add to `src/app/actions.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { getCurrentRole, requireSeller } from '../lib/current-role';
import { currentPeriodIndex } from '../lib/period';
import { getLoanTerms, addExpenseCredit, reverseExpenseCredit } from '../db/repository';
import { uploadReceipt } from '../lib/blob';
import { dollarsToCents } from '../lib/money';

export async function submitCredit(formData: FormData): Promise<void> {
  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated) throw new Error('Unauthorized');
  const role = await getCurrentRole();
  if (role !== 'buyer' && role !== 'seller') throw new Error('Forbidden');

  const dollars = Number(formData.get('amountDollars'));
  const description = String(formData.get('description') ?? '').trim();
  const file = formData.get('receipt');
  if (!Number.isFinite(dollars) || dollars <= 0) throw new Error('amount must be positive');
  if (!description) throw new Error('description required');

  const loanId = await ensureAnchorRiverLoan();
  const terms = await getLoanTerms(loanId);
  const today = new Date().toISOString().slice(0, 10);
  const periodIndex = currentPeriodIndex(terms, today);

  let receiptUrl: string | null = null;
  if (file instanceof File && file.size > 0) {
    receiptUrl = await uploadReceipt(file);
  }

  await addExpenseCredit(loanId, {
    periodIndex,
    amountCents: dollarsToCents(dollars),
    description,
    receiptUrl,
    createdBy: userId,
  });
  revalidatePath('/');
}

export async function reverseCredit(formData: FormData): Promise<void> {
  await requireSeller();
  const { userId } = await auth();
  const creditId = Number(formData.get('creditId'));
  if (!Number.isInteger(creditId)) throw new Error('invalid creditId');
  await reverseExpenseCredit(creditId, userId!);
  revalidatePath('/');
}
```

Note: `new Date().toISOString()` is allowed in app runtime code (only the workflow sandbox forbids it). Add a `listExpenseCredits`-backed `loadCredits()` helper too:
```ts
import { listExpenseCredits } from '../db/repository';
export async function loadCredits() {
  const loanId = await ensureAnchorRiverLoan();
  return listExpenseCredits(loanId);
}
```

- [ ] **Step 2: Type-check.** `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions.ts
git commit -m "feat: submit-credit (buyer) and reverse-credit (seller) actions"
```

---

### Task 7: UI — credit form + credits list

**Files:** Modify `src/app/page.tsx`.

- [ ] **Step 1: Extend `src/app/page.tsx`** to (a) load credits, (b) show a credit-entry form to any signed-in user, (c) render the credits list with a reverse button for sellers. Add below the existing schedule table, keeping everything already there.

```tsx
import { loadSchedule, submitPayment, submitCredit, reverseCredit, loadCredits } from './actions';
import { getCurrentRole } from '../lib/current-role';
import { formatCents } from '../lib/money';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const role = await getCurrentRole();
  const [schedule, credits] = await Promise.all([loadSchedule(), loadCredits()]);
  // ...existing role notice, summary line, seller-only payment form, schedule table unchanged...

  // After the schedule table, add:
  // <section>
  //   <h2>Expense credits</h2>
  //   <form action={submitCredit} encType="multipart/form-data"> amount, description, receipt(file), submit </form>
  //   <table> period | amount | description | status | receipt link | (seller: reverse button via <form action={reverseCredit}> hidden creditId) </table>
  // </section>
}
```

Full section markup to insert directly before the closing `</main>`:
```tsx
      <section style={{ marginTop: 32 }}>
        <h2>Expense credits</h2>
        <form action={submitCredit} encType="multipart/form-data" style={{ margin: '12px 0' }}>
          <fieldset style={{ display: 'inline-flex', gap: 8, alignItems: 'end' }}>
            <legend>Log a credit (applies to the current month)</legend>
            <label>Amount ($)<br /><input name="amountDollars" type="number" step="0.01" min="0" required /></label>
            <label>Description<br /><input name="description" type="text" required /></label>
            <label>Receipt<br /><input name="receipt" type="file" accept="image/*,application/pdf" /></label>
            <button type="submit">Add credit</button>
          </fieldset>
        </form>
        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
              <th>Period</th><th>Amount</th><th>Description</th><th>Status</th><th>Receipt</th>
              {role === 'seller' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {credits.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #ddd', opacity: c.status === 'reversed' ? 0.5 : 1 }}>
                <td>{c.periodIndex}</td>
                <td>{formatCents(c.amountCents)}</td>
                <td>{c.description}</td>
                <td>{c.status}</td>
                <td>{c.receiptUrl ? <a href={c.receiptUrl} target="_blank" rel="noreferrer">view</a> : '—'}</td>
                {role === 'seller' && (
                  <td>
                    {c.status === 'applied' && (
                      <form action={reverseCredit}>
                        <input type="hidden" name="creditId" value={c.id} />
                        <button type="submit">Reverse</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
```

- [ ] **Step 2: Type-check, build, run unit suite.** `pnpm exec tsc --noEmit && pnpm run build && pnpm test`
Expected: no type errors; build green (`/` dynamic); unit tests pass (money, amortization, loan-terms, roles, period, settlement).

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: expense-credit entry and credits list with seller reversal"
```

---

## Manual Verification Gate (needs Blob token + test branch + dev server)
1. Provision the Blob store; set `BLOB_READ_WRITE_TOKEN` and `DATABASE_URL_TEST`.
2. `pnpm db:push` against test branch and production (creates `expense_credits`).
3. As a buyer: log a credit with a receipt → it appears, applied to the current period, receipt link works.
4. The schedule's current-period payment reflects the credit; an overpayment pulls the payoff in.
5. As a seller: reverse the credit → it greys out and the schedule reverts.

## Self-Review
**Spec coverage:** buyer-entered credit auto-applied to current month (Tasks 2, 6); receipt upload (Tasks 4, 6, 7); seller review + reversal (Tasks 5, 6, 7); credits fold into settlement and overpayment spills to principal via the unchanged engine (Task 3, 5). ✓
**Placeholder scan:** the page.tsx Task 7 step shows the inserted section in full; the "...unchanged..." comment refers to code already present from Plan 2, not a gap.
**Type consistency:** `PeriodAmount`/`aggregateSettlements` (settlement.ts) consumed by repository; `currentPeriodIndex` by actions; `AppliedPayment` reused from the engine.
**Deferred:** late fees (Plan 3b); moving receipts to private/signed Blob access (secure-phase); Plaid-sourced cash with date-based period mapping (Plan 4).
