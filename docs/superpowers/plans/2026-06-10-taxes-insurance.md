# Taxes & Insurance Monitoring Implementation Plan (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitor property-tax obligations and hazard-insurance policies for the Anchor River RV Park deal. Store proof of payment / declarations pages, surface status in the UI, and compute the "10-day reminder trigger" date as a pure function. No live borough scraping, no reimbursement money flow, no cron reminders (those are Plan 7).

**Architecture:** Two new tables (`tax_obligations`, `insurance_policies`) live in a compliance schema file. Pure helper functions (`reminderTriggerDate`, `isLapsed`) are unit-tested with explicit golden dates. Server actions in `src/app/compliance-actions.ts` handle uploads via the existing `uploadReceipt` blob helper. A `ComplianceSection` server component renders both lists. `page.tsx` integration is an orchestrator step noted but not planned here.

**Tech Stack:** Next.js 15.5 App Router, Vitest, Drizzle/Neon, `@vercel/blob` (already installed), Clerk (existing).

**Depends on:** Plan 1 (loan, DB client), Plan 2 (roles: `requireSeller`, `getCurrentRole`), Plan 3 (blob helper `uploadReceipt`/`deleteReceipt` already in `src/lib/blob.ts`).

## RESOLVED FACTS

**From `src/lib/blob.ts` (already present — do not re-create):**
- `import { uploadReceipt, deleteReceipt } from '../lib/blob'`
- `uploadReceipt(file: File): Promise<string>` — uploads to `receipts/<name>` with `access: 'public', addRandomSuffix: true`; returns the public URL.
- `deleteReceipt(url: string): Promise<void>` — deletes by URL via `del`.

**From `src/lib/current-role.ts` (already present):**
- `requireSeller(): Promise<void>` — throws `'Forbidden: seller role required'` if current user is not seller.
- `getCurrentRole(): Promise<Role | null>` — returns `'seller'` | `'buyer'` | `null`.

**From `src/db/schema.ts` (current state):**
- Existing tables: `loans`, `payments`, `expenseCredits`. Money columns use `bigint('col', { mode: 'number' })`.
- The schema directory (`src/db/schema/`) does not yet exist; new compliance tables are appended to `src/db/schema.ts` and exported from there. If the orchestrator later splits the schema into a directory, the exports remain compatible.

**Blob env:** `BLOB_READ_WRITE_TOKEN` in `.env.local` (provisioned in Plan 3). `DATABASE_URL_TEST` for integration tests.

**Date math:** ISO 8601 strings only (`YYYY-MM-DD`). Never `new Date()` in pure lib functions; pass today as a parameter. `new Date()` is allowed in server actions and app runtime only.

## File Structure

```
src/
  lib/
    tax-reminder.ts          # pure: reminderTriggerDate(delinquencyISO), isLapsed(expirationISO, todayISO)
    tax-reminder.test.ts
  db/
    schema.ts                # + tax_obligations, insurance_policies tables (appended)
    compliance-repository.ts # addTaxObligation, markTaxPaid, listTaxObligations,
                             #   addInsurancePolicy, listInsurancePolicies
    compliance-repository.test.ts
  app/
    compliance-actions.ts    # addTaxObligation, markTaxPaid, addInsurancePolicy (server actions)
  components/
    ComplianceSection.tsx    # server component: tax list + insurance list + upload forms
```

---

### Task 1: Compliance schema (tax_obligations + insurance_policies)

**Files:** Modify `src/db/schema.ts`.

- [ ] **Step 1: Append the two tables and their inferred types to `src/db/schema.ts`**

```ts
export const taxObligations = pgTable('tax_obligations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  parcelGroup: text('parcel_group').notNull(), // e.g. "Parcels A & B"
  dueDateISO: date('due_date_iso').notNull(),
  delinquencyDateISO: date('delinquency_date_iso').notNull(),
  status: text('status', { enum: ['open', 'paid'] })
    .notNull()
    .default('open'),
  proofUrl: text('proof_url'),
  paidBy: text('paid_by'), // Clerk user id, null until paid
  paidAt: timestamp('paid_at'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type TaxObligationRow = typeof taxObligations.$inferSelect;

export const insurancePolicies = pgTable('insurance_policies', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  carrier: text('carrier').notNull(),
  policyNumber: text('policy_number').notNull(),
  coverageCents: bigint('coverage_cents', { mode: 'number' }).notNull(),
  effectiveDateISO: date('effective_date_iso').notNull(),
  expirationDateISO: date('expiration_date_iso').notNull(),
  lossPayeeConfirmed: integer('loss_payee_confirmed').notNull().default(0), // 0=false, 1=true
  declarationsUrl: text('declarations_url'),
  status: text('status', { enum: ['active', 'lapsed'] })
    .notNull()
    .default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type InsurancePolicyRow = typeof insurancePolicies.$inferSelect;
```

Note on `lossPayeeConfirmed`: Drizzle's `pg-core` does not ship a first-class `boolean` column in the version currently used (verified by the existing schema which uses no booleans). Use `integer` with `0`/`1` and convert at the boundary. If the orchestrator confirms `boolean` is available in the installed `drizzle-orm` version, switch to `boolean('loss_payee_confirmed').notNull().default(false)` and remove this note.

- [ ] **Step 2: Push schema to the test branch**

```bash
DATABASE_URL="<DATABASE_URL_TEST unpooled>" pnpm db:push
```

Expected: `tax_obligations` and `insurance_policies` tables created.

- [ ] **Step 3: Push schema to production**

```bash
DATABASE_URL="<prod unpooled>" pnpm db:push
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: tax_obligations and insurance_policies compliance tables"
```

---

### Task 2: Pure date helpers (reminderTriggerDate, isLapsed)

**Files:** Create `src/lib/tax-reminder.ts`, `src/lib/tax-reminder.test.ts`.

`reminderTriggerDate` returns the ISO date that is 10 days before the delinquency date (Deed of Trust covenant A.4: pay at least 10 days before delinquency). `isLapsed` returns `true` when an expiration date is on or before today (insurance has expired). Both functions operate purely on ISO date strings; no `new Date()` of the system clock.

- [ ] **Step 1: Write the failing test `src/lib/tax-reminder.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { reminderTriggerDate, isLapsed } from './tax-reminder';

describe('reminderTriggerDate', () => {
  it('returns 10 days before the delinquency date — mid-month', () => {
    expect(reminderTriggerDate('2026-10-15')).toBe('2026-10-05');
  });

  it('crosses month boundary correctly', () => {
    // delinquency: Nov 5 → reminder: Oct 26
    expect(reminderTriggerDate('2026-11-05')).toBe('2026-10-26');
  });

  it('crosses year boundary correctly', () => {
    // delinquency: Jan 8 → reminder: Dec 29 of prior year
    expect(reminderTriggerDate('2027-01-08')).toBe('2026-12-29');
  });

  it('handles leap-year February correctly', () => {
    // delinquency: Mar 5 2028 (leap year) → reminder: Feb 24
    expect(reminderTriggerDate('2028-03-05')).toBe('2028-02-24');
  });
});

describe('isLapsed', () => {
  it('returns true when expiration equals today', () => {
    expect(isLapsed('2026-06-10', '2026-06-10')).toBe(true);
  });

  it('returns true when expiration is before today', () => {
    expect(isLapsed('2026-06-09', '2026-06-10')).toBe(true);
  });

  it('returns false when expiration is after today', () => {
    expect(isLapsed('2027-06-10', '2026-06-10')).toBe(false);
  });

  it('handles day-before boundary', () => {
    expect(isLapsed('2026-06-09', '2026-06-09')).toBe(true);
    expect(isLapsed('2026-06-10', '2026-06-09')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm it fails.**

```bash
pnpm test src/lib/tax-reminder.test.ts
```

Expected: `Cannot find module './tax-reminder'`.

- [ ] **Step 3: Implement `src/lib/tax-reminder.ts`**

```ts
/**
 * Returns the ISO date that is exactly 10 days before the given delinquency date.
 * Per Deed of Trust covenant A.4: the buyer must pay borough taxes at least 10 days
 * before delinquency. This is the date at which a reminder should fire (Plan 7).
 *
 * @param delinquencyISO - ISO 8601 date string (YYYY-MM-DD)
 * @returns ISO 8601 date string 10 days prior
 */
export function reminderTriggerDate(delinquencyISO: string): string {
  const [y, m, d] = delinquencyISO.split('-').map(Number);
  // Use UTC to avoid DST shifts
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 10);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns true when an insurance policy's expiration date is on or before today,
 * meaning the policy has lapsed (or expires today and is not yet renewed).
 *
 * @param expirationISO - policy expiration date (YYYY-MM-DD)
 * @param todayISO - the current date to compare against (YYYY-MM-DD); injected for testability
 */
export function isLapsed(expirationISO: string, todayISO: string): boolean {
  return expirationISO <= todayISO;
}
```

- [ ] **Step 4: Run, confirm pass (8 tests).**

```bash
pnpm test src/lib/tax-reminder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax-reminder.ts src/lib/tax-reminder.test.ts
git commit -m "feat: reminderTriggerDate and isLapsed pure date helpers"
```

---

### Task 3: Compliance repository

**Files:** Create `src/db/compliance-repository.ts`, `src/db/compliance-repository.test.ts`.

- [ ] **Step 1: Create `src/db/compliance-repository.ts`**

```ts
import { eq, desc } from 'drizzle-orm';
import { db } from './client';
import {
  taxObligations,
  insurancePolicies,
  type TaxObligationRow,
  type InsurancePolicyRow,
} from './schema';

// ---------------------------------------------------------------------------
// Tax obligations
// ---------------------------------------------------------------------------

export async function addTaxObligation(input: {
  parcelGroup: string;
  dueDateISO: string;
  delinquencyDateISO: string;
  createdBy: string;
}): Promise<TaxObligationRow> {
  const [row] = await db
    .insert(taxObligations)
    .values(input)
    .returning();
  return row;
}

export async function markTaxPaid(
  obligationId: number,
  input: { proofUrl: string | null; paidBy: string },
): Promise<void> {
  await db
    .update(taxObligations)
    .set({
      status: 'paid',
      proofUrl: input.proofUrl,
      paidBy: input.paidBy,
      paidAt: new Date(),
    })
    .where(eq(taxObligations.id, obligationId));
}

export async function listTaxObligations(): Promise<TaxObligationRow[]> {
  return db
    .select()
    .from(taxObligations)
    .orderBy(desc(taxObligations.delinquencyDateISO));
}

// ---------------------------------------------------------------------------
// Insurance policies
// ---------------------------------------------------------------------------

export async function addInsurancePolicy(input: {
  carrier: string;
  policyNumber: string;
  coverageCents: number;
  effectiveDateISO: string;
  expirationDateISO: string;
  lossPayeeConfirmed: number; // 1 = confirmed, 0 = not confirmed
  declarationsUrl: string | null;
  createdBy: string;
}): Promise<InsurancePolicyRow> {
  const [row] = await db
    .insert(insurancePolicies)
    .values(input)
    .returning();
  return row;
}

export async function listInsurancePolicies(): Promise<InsurancePolicyRow[]> {
  return db
    .select()
    .from(insurancePolicies)
    .orderBy(desc(insurancePolicies.expirationDateISO));
}
```

- [ ] **Step 2: Write the failing integration tests `src/db/compliance-repository.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as repo from './compliance-repository';

const hasDb = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);

describe.skipIf(!hasDb)('compliance-repository integration', () => {
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
```

- [ ] **Step 3: Run, confirm integration tests fail (module not found or missing table).**

```bash
DATABASE_URL="<DATABASE_URL_TEST>" pnpm test src/db/compliance-repository.test.ts
```

- [ ] **Step 4: Run after schema push (Task 1 completed) to confirm pass.**

```bash
DATABASE_URL="<DATABASE_URL_TEST>" pnpm test src/db/compliance-repository.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/compliance-repository.ts src/db/compliance-repository.test.ts
git commit -m "feat: compliance repository for tax obligations and insurance policies"
```

---

### Task 4: Server actions (compliance-actions.ts)

**Files:** Create `src/app/compliance-actions.ts`.

Role rules:
- Any signed-in user (buyer or seller) may upload proof / declarations for an existing obligation.
- Only the seller may create new tax obligations (set due dates) or add insurance policies.
- `markTaxPaid` is available to any signed-in user (the buyer pays the tax; proof upload is the act).

- [ ] **Step 1: Write the failing type-check baseline** (`pnpm exec tsc --noEmit` should currently pass; note the baseline so you can confirm no regressions after this task).

- [ ] **Step 2: Create `src/app/compliance-actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { requireSeller, getCurrentRole } from '../lib/current-role';
import { uploadReceipt } from '../lib/blob';
import { dollarsToCents } from '../lib/money';
import {
  addTaxObligation,
  markTaxPaid,
  listTaxObligations,
  addInsurancePolicy,
  listInsurancePolicies,
} from '../db/compliance-repository';

// ---------------------------------------------------------------------------
// Tax obligations
// ---------------------------------------------------------------------------

/**
 * Seller-only: create a new tax obligation record for a parcel group.
 * Due date and delinquency date are YYYY-MM-DD strings from the form.
 */
export async function createTaxObligation(formData: FormData): Promise<void> {
  await requireSeller();
  const { userId } = await auth();

  const parcelGroup = String(formData.get('parcelGroup') ?? '').trim();
  const dueDateISO = String(formData.get('dueDateISO') ?? '').trim();
  const delinquencyDateISO = String(formData.get('delinquencyDateISO') ?? '').trim();

  if (!parcelGroup) throw new Error('parcelGroup is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateISO)) throw new Error('dueDateISO must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(delinquencyDateISO))
    throw new Error('delinquencyDateISO must be YYYY-MM-DD');
  if (delinquencyDateISO <= dueDateISO)
    throw new Error('delinquencyDateISO must be after dueDateISO');

  await addTaxObligation({ parcelGroup, dueDateISO, delinquencyDateISO, createdBy: userId! });
  revalidatePath('/');
}

/**
 * Any signed-in user (buyer pays the taxes): mark an obligation paid and
 * optionally upload a proof file (receipt, confirmation screenshot).
 */
export async function submitTaxProof(formData: FormData): Promise<void> {
  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) throw new Error('Unauthorized');
  const role = await getCurrentRole();
  if (!role) throw new Error('Forbidden: no role assigned');

  const obligationId = Number(formData.get('obligationId'));
  if (!Number.isInteger(obligationId) || obligationId < 1)
    throw new Error('obligationId must be a positive integer');

  const file = formData.get('proof');
  let proofUrl: string | null = null;
  if (file instanceof File && file.size > 0) {
    proofUrl = await uploadReceipt(file);
  }

  await markTaxPaid(obligationId, { proofUrl, paidBy: userId });
  revalidatePath('/');
}

/**
 * Load all tax obligations (server-side, used by ComplianceSection).
 */
export async function loadTaxObligations() {
  return listTaxObligations();
}

// ---------------------------------------------------------------------------
// Insurance policies
// ---------------------------------------------------------------------------

/**
 * Seller-only: add a new insurance policy record and optionally upload
 * a declarations page (PDF or image).
 */
export async function createInsurancePolicy(formData: FormData): Promise<void> {
  await requireSeller();
  const { userId } = await auth();

  const carrier = String(formData.get('carrier') ?? '').trim();
  const policyNumber = String(formData.get('policyNumber') ?? '').trim();
  const coverageDollars = Number(formData.get('coverageDollars'));
  const effectiveDateISO = String(formData.get('effectiveDateISO') ?? '').trim();
  const expirationDateISO = String(formData.get('expirationDateISO') ?? '').trim();
  const lossPayeeConfirmedRaw = formData.get('lossPayeeConfirmed');
  const lossPayeeConfirmed = lossPayeeConfirmedRaw === 'true' || lossPayeeConfirmedRaw === '1' ? 1 : 0;
  const file = formData.get('declarations');

  if (!carrier) throw new Error('carrier is required');
  if (!policyNumber) throw new Error('policyNumber is required');
  if (!Number.isFinite(coverageDollars) || coverageDollars <= 0)
    throw new Error('coverageDollars must be a positive number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDateISO))
    throw new Error('effectiveDateISO must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expirationDateISO))
    throw new Error('expirationDateISO must be YYYY-MM-DD');
  if (expirationDateISO <= effectiveDateISO)
    throw new Error('expirationDateISO must be after effectiveDateISO');

  let declarationsUrl: string | null = null;
  if (file instanceof File && file.size > 0) {
    declarationsUrl = await uploadReceipt(file);
  }

  await addInsurancePolicy({
    carrier,
    policyNumber,
    coverageCents: dollarsToCents(coverageDollars),
    effectiveDateISO,
    expirationDateISO,
    lossPayeeConfirmed,
    declarationsUrl,
    createdBy: userId!,
  });
  revalidatePath('/');
}

/**
 * Load all insurance policies (server-side, used by ComplianceSection).
 */
export async function loadInsurancePolicies() {
  return listInsurancePolicies();
}
```

- [ ] **Step 3: Type-check.** `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/compliance-actions.ts
git commit -m "feat: compliance server actions for tax obligations and insurance policies"
```

---

### Task 5: ComplianceSection server component

**Files:** Create `src/components/ComplianceSection.tsx`.

This is a React Server Component. It receives pre-fetched rows (to avoid waterfall fetching at render time) and the current role. It renders:
1. Tax obligations table (parcel group, due date, delinquency date, computed reminder trigger date, status, proof link) and a form for buyers/sellers to upload proof and mark paid.
2. Insurance policies table (carrier, policy number, coverage in dollars, effective/expiration dates, loss-payee confirmed, lapsed status, declarations link) and a seller-only form to add a new policy.
3. A seller-only form to add a new tax obligation.

The `isLapsed` function is called with an explicit `todayISO` string (derived from `new Date().toISOString().slice(0, 10)` at the call site in the server component — allowed in app code).

- [ ] **Step 1: Write the failing type-check baseline.** Confirm `pnpm exec tsc --noEmit` passes before this task.

- [ ] **Step 2: Create `src/components/ComplianceSection.tsx`**

```tsx
import type { TaxObligationRow, InsurancePolicyRow } from '../db/schema';
import type { Role } from '../lib/roles';
import {
  createTaxObligation,
  submitTaxProof,
  createInsurancePolicy,
} from '../app/compliance-actions';
import { reminderTriggerDate, isLapsed } from '../lib/tax-reminder';
import { formatCents } from '../lib/money';

interface Props {
  taxObligations: TaxObligationRow[];
  insurancePolicies: InsurancePolicyRow[];
  role: Role | null;
  todayISO: string; // injected from the parent server component
}

export function ComplianceSection({
  taxObligations,
  insurancePolicies,
  role,
  todayISO,
}: Props) {
  return (
    <div style={{ marginTop: 40 }}>
      {/* ------------------------------------------------------------------ */}
      {/* Property Tax Obligations                                            */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2>Property Tax Obligations</h2>
        <p style={{ fontSize: '0.875rem', color: '#666' }}>
          Kenai Peninsula Borough — buyer must pay at least 10 days before delinquency (Deed of
          Trust §A.4).
        </p>

        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
              <th>Parcel group</th>
              <th>Due date</th>
              <th>Delinquency date</th>
              <th>Reminder trigger</th>
              <th>Status</th>
              <th>Proof</th>
              {(role === 'buyer' || role === 'seller') && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {taxObligations.map((t) => (
              <tr
                key={t.id}
                style={{
                  borderBottom: '1px solid #ddd',
                  background: t.status === 'paid' ? '#eef9ee' : undefined,
                }}
              >
                <td>{t.parcelGroup}</td>
                <td>{t.dueDateISO}</td>
                <td>{t.delinquencyDateISO}</td>
                <td>{reminderTriggerDate(t.delinquencyDateISO)}</td>
                <td>
                  <strong>{t.status === 'paid' ? 'Paid' : 'Open'}</strong>
                  {t.paidBy && (
                    <span style={{ fontSize: '0.75rem', marginLeft: 4, color: '#555' }}>
                      (by {t.paidBy})
                    </span>
                  )}
                </td>
                <td>
                  {t.proofUrl ? (
                    <a href={t.proofUrl} target="_blank" rel="noreferrer">
                      view
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                {(role === 'buyer' || role === 'seller') && (
                  <td>
                    {t.status === 'open' && (
                      <form action={submitTaxProof} encType="multipart/form-data">
                        <input type="hidden" name="obligationId" value={t.id} />
                        <label style={{ fontSize: '0.8rem' }}>
                          Proof&nbsp;
                          <input
                            name="proof"
                            type="file"
                            accept="image/*,application/pdf"
                            style={{ fontSize: '0.8rem' }}
                          />
                        </label>
                        &nbsp;
                        <button type="submit" style={{ fontSize: '0.8rem' }}>
                          Mark paid
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {taxObligations.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: '#888', padding: 12 }}>
                  No tax obligations recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {role === 'seller' && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              + Add tax obligation
            </summary>
            <form action={createTaxObligation} style={{ marginTop: 8 }}>
              <fieldset style={{ display: 'inline-flex', gap: 8, alignItems: 'end' }}>
                <legend>New tax obligation (seller only)</legend>
                <label>
                  Parcel group
                  <br />
                  <input name="parcelGroup" type="text" defaultValue="Parcels A & B" required />
                </label>
                <label>
                  Due date
                  <br />
                  <input name="dueDateISO" type="date" required />
                </label>
                <label>
                  Delinquency date
                  <br />
                  <input name="delinquencyDateISO" type="date" required />
                </label>
                <button type="submit">Add</button>
              </fieldset>
            </form>
          </details>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Hazard Insurance Policies                                           */}
      {/* ------------------------------------------------------------------ */}
      <section style={{ marginTop: 32 }}>
        <h2>Hazard Insurance</h2>
        <p style={{ fontSize: '0.875rem', color: '#666' }}>
          Fire / extended-coverage required; seller must be named loss payee (Deed of Trust §A.2).
        </p>

        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
              <th>Carrier</th>
              <th>Policy #</th>
              <th>Coverage</th>
              <th>Effective</th>
              <th>Expires</th>
              <th>Loss payee</th>
              <th>Status</th>
              <th>Declarations</th>
            </tr>
          </thead>
          <tbody>
            {insurancePolicies.map((p) => {
              const lapsed = isLapsed(p.expirationDateISO, todayISO);
              return (
                <tr
                  key={p.id}
                  style={{
                    borderBottom: '1px solid #ddd',
                    background: lapsed ? '#fef2f2' : undefined,
                  }}
                >
                  <td>{p.carrier}</td>
                  <td>{p.policyNumber}</td>
                  <td>{formatCents(p.coverageCents)}</td>
                  <td>{p.effectiveDateISO}</td>
                  <td>
                    {p.expirationDateISO}
                    {lapsed && (
                      <span style={{ color: '#a00', marginLeft: 4, fontWeight: 'bold' }}>
                        LAPSED
                      </span>
                    )}
                  </td>
                  <td>{p.lossPayeeConfirmed === 1 ? 'Confirmed' : 'Not confirmed'}</td>
                  <td>{lapsed ? 'Lapsed' : 'Active'}</td>
                  <td>
                    {p.declarationsUrl ? (
                      <a href={p.declarationsUrl} target="_blank" rel="noreferrer">
                        view
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
            {insurancePolicies.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: '#888', padding: 12 }}>
                  No insurance policies recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {role === 'seller' && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              + Add insurance policy
            </summary>
            <form
              action={createInsurancePolicy}
              encType="multipart/form-data"
              style={{ marginTop: 8 }}
            >
              <fieldset style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
                <legend>New insurance policy (seller only)</legend>
                <label>
                  Carrier
                  <br />
                  <input name="carrier" type="text" required />
                </label>
                <label>
                  Policy #
                  <br />
                  <input name="policyNumber" type="text" required />
                </label>
                <label>
                  Coverage ($)
                  <br />
                  <input name="coverageDollars" type="number" step="0.01" min="0" required />
                </label>
                <label>
                  Effective date
                  <br />
                  <input name="effectiveDateISO" type="date" required />
                </label>
                <label>
                  Expiration date
                  <br />
                  <input name="expirationDateISO" type="date" required />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input name="lossPayeeConfirmed" type="checkbox" value="true" />
                  Loss payee confirmed
                </label>
                <label>
                  Declarations page
                  <br />
                  <input name="declarations" type="file" accept="image/*,application/pdf" />
                </label>
                <button type="submit">Add policy</button>
              </fieldset>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Type-check.** `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 4: Run full unit suite.** `pnpm test` → all tests pass (no regressions; new tax-reminder tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/components/ComplianceSection.tsx
git commit -m "feat: ComplianceSection server component for tax and insurance monitoring"
```

---

### Task 6: page.tsx integration (orchestrator step — note only)

**This task is an orchestrator-level step; do not implement it here.** Document the integration pattern so the orchestrator can execute it without ambiguity.

The orchestrator adds to `src/app/page.tsx`:

1. Import `loadTaxObligations`, `loadInsurancePolicies` from `./compliance-actions` and `ComplianceSection` from `../components/ComplianceSection`.
2. In the `Home` component's parallel data-fetch, add:
   ```ts
   const [schedule, credits, taxObs, insurancePols] = await Promise.all([
     loadSchedule(),
     loadCredits(),
     loadTaxObligations(),
     loadInsurancePolicies(),
   ]);
   ```
3. At the bottom of `<main>`, before the closing tag, add:
   ```tsx
   <ComplianceSection
     taxObligations={taxObs}
     insurancePolicies={insurancePols}
     role={role}
     todayISO={new Date().toISOString().slice(0, 10)}
   />
   ```

No other changes to `page.tsx` are required. The existing expense-credits section and payment form are unchanged.

---

## Manual Verification Gate (needs test branch + dev server + Blob token)

1. Ensure `BLOB_READ_WRITE_TOKEN` and `DATABASE_URL_TEST` are set in `.env.local`.
2. `pnpm db:push` against the test branch (if not done in Task 1).
3. `pnpm run dev` — navigate to `http://localhost:3000`.
4. **As seller:** Add a tax obligation (Parcels A & B, due date 2026-09-30, delinquency 2026-10-15). Verify it appears with reminder trigger date `2026-10-05`.
5. **As buyer:** Upload a proof file on the open obligation and click Mark Paid. Verify status changes to Paid and proof link appears.
6. **As seller:** Add an insurance policy (any carrier, expiration in the future). Verify it shows `Active`. Add a second policy with a past expiration date — verify it shows `LAPSED` with red highlighting.
7. **As buyer:** Verify the Add insurance policy form is not visible (seller-only gate).
8. `pnpm test` — all unit tests pass.

---

## Self-Review

| Requirement | Covered by |
|---|---|
| Reminder trigger date = delinquency date minus 10 days (pure function, unit-tested with golden values) | Task 2: `reminderTriggerDate` tested at `2026-10-15 → 2026-10-05`, month-boundary, year-boundary, leap year |
| `isLapsed` pure function for insurance expiration | Task 2: tested with same-day, before, after, day-before boundary |
| `tax_obligations` table: parcel group, due date, delinquency date, status open/paid, proof URL, paid-by | Task 1 |
| `insurance_policies` table: carrier, policy number, coverage cents (bigint), effective/expiration dates, loss-payee flag, declarations URL, status active/lapsed | Task 1 |
| Coverage amount stored as integer cents | Task 1: `coverageCents bigint`; Task 4: `dollarsToCents(coverageDollars)` at action boundary |
| Repository: `addTaxObligation`, `markTaxPaid`, `listTaxObligations`, `addInsurancePolicy`, `listInsurancePolicies` | Task 3 |
| Integration tests against test-branch DB | Task 3 |
| Proof upload via existing `uploadReceipt` blob helper | Task 4: `submitTaxProof` and `createInsurancePolicy` call `uploadReceipt(file)` |
| Seller-only: create tax obligations, add insurance policies | Task 4: `requireSeller()` guard in `createTaxObligation`, `createInsurancePolicy` |
| Any signed-in user: upload proof / mark tax paid | Task 4: `submitTaxProof` checks `isAuthenticated` and `role !== null` |
| UI: tax obligations list with due date, delinquency, reminder trigger, status, proof link | Task 5: `ComplianceSection` tax table; `reminderTriggerDate` called inline |
| UI: insurance policies list with carrier, coverage, expiration, loss-payee confirmed, lapsed indicator | Task 5: `ComplianceSection` insurance table; `isLapsed(p.expirationDateISO, todayISO)` |
| UI: forms to add/upload | Task 5: collapsible seller-only forms for both tables; buyer proof-upload form per tax row |
| `page.tsx` integration deferred to orchestrator | Task 6: integration steps documented; no `page.tsx` edits in this plan |
| No live borough scraping | No HTTP calls to borough portals; proof receipt is source of truth |
| Reminders / cron deferred to Plan 7 | `reminderTriggerDate` is computed and displayed in the UI but no cron job is scheduled here |
| No reimbursement money flow | No credits, no loan-ledger entries; purely monitoring + document storage |
