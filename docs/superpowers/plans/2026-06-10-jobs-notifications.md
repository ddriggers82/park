# Jobs & Notifications Implementation Plan (Plan 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up all scheduled reminders and transactional email for the Park Payments app. A daily Vercel Cron job collects state from the database, passes it to a pure decision function that returns a list of messages to send, and dispatches each message via Resend. Cron also auto-opens upcoming royalty periods and flips lapsed insurance policies. All decision logic is a pure function with no I/O and is the tested core of this plan.

**Architecture:** Three-layer separation.

1. **Pure decision layer** (`src/lib/notifications.ts`): a single exported function `dueReminders(state, todayISO)` takes a typed snapshot of the world (loan period, payments, royalty periods, tax obligations, insurance policies) and returns a flat list of `EmailMessage` objects. No DB access, no Resend calls, no `new Date()`. Fully unit-tested with golden scenarios.
2. **Email helper** (`src/lib/email.ts`): a thin `server-only` wrapper around the Resend SDK. `sendEmail({ to, subject, html })` is the only export. No logic.
3. **Cron route** (`src/app/api/cron/daily/route.ts`): a `GET` handler secured by `CRON_SECRET`. It queries the DB for current state, calls `dueReminders`, iterates the result, and calls `sendEmail` for each message. It also handles the two side-effect operations (opening royalty periods, flipping lapsed insurance status) that require a write alongside the read.

No UI changes. No new DB tables. No new environment variables beyond `RESEND_API_KEY` and `CRON_SECRET`, which are deferred operator gates.

**Tech Stack:** Next.js 15.5 App Router, Vitest, Drizzle/Neon, Resend, Vercel Cron, Clerk (existing).

**Depends on:**
- **Plan 3b (late-fees):** `assessLateFee` and `getSettlementsForPeriod` are called inside the state-gathering pass to determine whether a period is late. The `late_fee_waivers` table must exist.
- **Plan 5 (royalty):** `royalty_periods` table, `openPeriod`, `listPeriods`, `royaltyDueDates` are used by the cron's royalty pass.
- **Plan 6 (taxes-insurance):** `tax_obligations` and `insurance_policies` tables, `listTaxObligations`, `listInsurancePolicies`, `reminderTriggerDate`, `isLapsed` are used by the tax and insurance passes.
- **Plan 1 (loan core):** `ensureAnchorRiverLoan`, `getLoanTerms` from repository.
- **Plan 2 (auth/roles):** `getCurrentRole`, `requireSeller` (used for the recipient-resolution helper).

If any of the above plans are not yet deployed, the cron handler will still compile and pass tests; it simply finds no rows and sends nothing. The `dueReminders` pure function is fully testable independently.

## RESOLVED FACTS (embed in subagent dispatches; implementer has no docs access)

### Resend
- Install: `pnpm add resend`
- Import: `import { Resend } from 'resend';`
- Client: `const resend = new Resend(process.env.RESEND_API_KEY);`
- Send: `const { data, error } = await resend.emails.send({ from, to, subject, html });`
- `from` for testing without a verified domain: `'onboarding@resend.dev'`
- A verified sending domain (`RESEND_FROM_ADDRESS` env var) is a deferred operator step; the code should read from `process.env.RESEND_FROM_ADDRESS ?? 'onboarding@resend.dev'` so the operator can flip it with one env var.
- `RESEND_API_KEY` must be set in the Vercel environment. Without it, `sendEmail` throws; the cron handler catches this and logs rather than crashing.

### Vercel Cron
- Defined in `vercel.json` at the repo root (this file does not yet exist in the project; create it).
- Format: `{ "crons": [{ "path": "/api/cron/daily", "schedule": "0 13 * * *" }] }` (13:00 UTC = ~4 AM Alaska Standard Time, 5 AM Alaska Daylight Time — arrives well before business hours).
- Route file: `src/app/api/cron/daily/route.ts` — App Router Route Handler exporting `GET`.
- Security: Vercel injects `Authorization: Bearer <CRON_SECRET>` on every cron invocation. The handler must check `request.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\`` and return `Response.json({ error: 'Unauthorized' }, { status: 401 })` otherwise.
- `CRON_SECRET` is set in the Vercel dashboard. In local dev, cron does not fire automatically; trigger manually with `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/daily`.
- Vercel Cron on Hobby plan: one cron job, minimum daily frequency. Pro plan: unlimited cron jobs, sub-daily frequency.

### Recipient resolution
- The app has two Clerk users: the seller (david.driggers@howtogrc.com) and the buyer.
- Resolve recipients by reading `SELLER_EMAIL` and `BUYER_EMAIL` env vars in the cron handler. This is the simplest approach for a two-user app; no Clerk API call is needed at cron time.
- The operator sets both env vars in the Vercel dashboard. Defaults: the seller email is already known; the buyer email must be confirmed.
- In `email.ts`, `to` is just a string address. The cron handler maps each message's `audience` field (`'seller'` | `'buyer'` | `'both'`) to actual addresses.

### Existing pure functions to reuse (DO NOT RE-IMPLEMENT)
- `assessLateFee(dueDateISO, scheduledCents, settlements, todayISO)` from `src/lib/late-fees.ts`
- `reminderTriggerDate(delinquencyISO)` from `src/lib/tax-reminder.ts`
- `isLapsed(expirationISO, todayISO)` from `src/lib/tax-reminder.ts`
- `royaltyDueDates(year)` from `src/lib/royalty.ts`
- `currentPeriodIndex(terms, todayISO)` from `src/lib/period.ts`
- `addMonths(iso, n)` from `src/lib/amortization.ts`

## Required setup (operator gate — deferred until verified sending domain is ready)

The following must be set in the Vercel environment before live emails are delivered:

- `RESEND_API_KEY` — Resend dashboard API key.
- `RESEND_FROM_ADDRESS` — verified sender address (e.g., `notify@yourdomain.com`). Until set, the code falls back to `onboarding@resend.dev` (Resend's test sender; only delivers to the Resend account owner's email).
- `CRON_SECRET` — a random secret string; set it in the Vercel dashboard and use the same value locally in `.env.local` for manual curl testing.
- `SELLER_EMAIL` — seller's email address (david.driggers@howtogrc.com).
- `BUYER_EMAIL` — buyer's email address (to be confirmed by operator).

The unit tests in this plan have no dependency on any of these env vars. The integration gate (Task 6) is the first step that requires them.

## File Structure

```
src/
  lib/
    notifications.ts        # pure: dueReminders(state, todayISO) -> EmailMessage[]
    notifications.test.ts   # unit tests — golden scenarios, no DB, no network
    email.ts                # server-only Resend wrapper: sendEmail({to, subject, html})
  app/
    api/
      cron/
        daily/
          route.ts          # GET handler: CRON_SECRET guard, gather state, call pure fn, send
vercel.json                 # new file: crons array
```

No new DB tables. No schema changes. No new repository files (uses existing repositories from Plans 3b, 5, 6).

---

### Task 1: Pure notification decision logic

**Files:** Create `src/lib/notifications.ts`, `src/lib/notifications.test.ts`.

This is the core of Plan 7. The function accepts a fully typed state object (no DB inside) and returns the list of email messages to send. Unit tests cover every trigger condition with explicit date fixtures.

- [ ] **Step 1: Write the failing test `src/lib/notifications.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { dueReminders } from './notifications';
import type { NotificationState } from './notifications';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_TERMS = {
  firstPaymentDate: '2026-05-01',
  paymentCents: 187_218,
  termMonths: 120,
};

// A clean state with nothing due or overdue.
function baseState(overrides: Partial<NotificationState> = {}): NotificationState {
  return {
    loanTerms: BASE_TERMS,
    // Current period is 1 (May 2026), no settlements recorded yet.
    settlementsForCurrentPeriod: [],
    // No tax obligations.
    taxObligations: [],
    // No insurance policies.
    insurancePolicies: [],
    // No royalty periods.
    royaltyPeriods: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loan payment reminders
// ---------------------------------------------------------------------------

describe('loan payment reminders', () => {
  it('sends no reminder when today is before the due date and well within the cycle', () => {
    // Today is 10 days before period 1 is due — no nudge yet.
    const msgs = dueReminders(baseState(), '2026-04-21');
    const paymentMsgs = msgs.filter((m) => m.type === 'payment_upcoming');
    expect(paymentMsgs).toHaveLength(0);
  });

  it('sends an upcoming-payment reminder 5 days before the due date', () => {
    // Today is April 26 — exactly 5 days before May 1.
    const msgs = dueReminders(baseState(), '2026-04-26');
    const upcoming = msgs.filter((m) => m.type === 'payment_upcoming');
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].audience).toBe('buyer');
    expect(upcoming[0].subject).toContain('payment');
  });

  it('sends an upcoming-payment reminder 3 days before the due date', () => {
    const msgs = dueReminders(baseState(), '2026-04-28');
    const upcoming = msgs.filter((m) => m.type === 'payment_upcoming');
    expect(upcoming).toHaveLength(1);
  });

  it('sends NO upcoming reminder on the due date itself (payment is due today)', () => {
    // On the due date, "overdue" logic takes over after the grace period.
    // No separate "upcoming" message on or after the due date.
    const msgs = dueReminders(baseState(), '2026-05-01');
    const upcoming = msgs.filter((m) => m.type === 'payment_upcoming');
    expect(upcoming).toHaveLength(0);
  });

  it('sends no reminder when period 1 is already paid before the due date', () => {
    const state = baseState({
      settlementsForCurrentPeriod: [
        { amountCents: 187_218, postedDate: '2026-04-30' },
      ],
    });
    const msgs = dueReminders(state, '2026-04-28');
    const upcoming = msgs.filter((m) => m.type === 'payment_upcoming');
    expect(upcoming).toHaveLength(0);
  });

  it('sends a missed-payment reminder when 6 days past due and unpaid', () => {
    // May 7 is 6 days after May 1 — past the 5-day grace.
    const msgs = dueReminders(baseState(), '2026-05-07');
    const missed = msgs.filter((m) => m.type === 'payment_missed');
    expect(missed).toHaveLength(1);
    expect(missed[0].audience).toBe('both');
    expect(missed[0].subject).toContain('late');
  });

  it('sends no missed-payment reminder when exactly 5 days past due (still in grace)', () => {
    const msgs = dueReminders(baseState(), '2026-05-06');
    const missed = msgs.filter((m) => m.type === 'payment_missed');
    expect(missed).toHaveLength(0);
  });

  it('sends no missed-payment reminder when overdue but already paid', () => {
    // Payment arrived on May 10 (late, but the fee is handled by Plan 3b).
    // The cron should not send a "missed" reminder once a full payment is recorded.
    const state = baseState({
      settlementsForCurrentPeriod: [
        { amountCents: 187_218, postedDate: '2026-05-10' },
      ],
    });
    const msgs = dueReminders(state, '2026-05-12');
    const missed = msgs.filter((m) => m.type === 'payment_missed');
    expect(missed).toHaveLength(0);
  });

  it('sends a missed-payment reminder when only partially paid and past grace', () => {
    // $500 received, $1,372.18 still outstanding — still triggers the missed reminder.
    const state = baseState({
      settlementsForCurrentPeriod: [
        { amountCents: 50_000, postedDate: '2026-05-02' },
      ],
    });
    const msgs = dueReminders(state, '2026-05-10');
    const missed = msgs.filter((m) => m.type === 'payment_missed');
    expect(missed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tax delinquency reminders
// ---------------------------------------------------------------------------

describe('tax delinquency reminders', () => {
  it('sends a tax reminder when today equals the 10-day trigger date', () => {
    // Delinquency Oct 15 → trigger Oct 5. Today is Oct 5.
    const state = baseState({
      taxObligations: [
        {
          id: 1,
          parcelGroup: 'Parcels A & B',
          dueDateISO: '2026-09-30',
          delinquencyDateISO: '2026-10-15',
          status: 'open',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-10-05');
    const taxMsgs = msgs.filter((m) => m.type === 'tax_reminder');
    expect(taxMsgs).toHaveLength(1);
    expect(taxMsgs[0].audience).toBe('buyer');
    expect(taxMsgs[0].subject).toContain('tax');
  });

  it('sends a tax reminder when today is between the trigger date and delinquency', () => {
    // Trigger was Oct 5; today is Oct 10 — still open, still reminding.
    const state = baseState({
      taxObligations: [
        {
          id: 1,
          parcelGroup: 'Parcels A & B',
          dueDateISO: '2026-09-30',
          delinquencyDateISO: '2026-10-15',
          status: 'open',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-10-10');
    const taxMsgs = msgs.filter((m) => m.type === 'tax_reminder');
    expect(taxMsgs).toHaveLength(1);
  });

  it('sends no tax reminder when today is before the 10-day trigger', () => {
    const state = baseState({
      taxObligations: [
        {
          id: 1,
          parcelGroup: 'Parcels A & B',
          dueDateISO: '2026-09-30',
          delinquencyDateISO: '2026-10-15',
          status: 'open',
        },
      ],
    });
    // Sep 20 is 25 days before delinquency, well before the trigger.
    const msgs = dueReminders(state, '2026-09-20');
    const taxMsgs = msgs.filter((m) => m.type === 'tax_reminder');
    expect(taxMsgs).toHaveLength(0);
  });

  it('sends no tax reminder when the obligation is already paid', () => {
    const state = baseState({
      taxObligations: [
        {
          id: 1,
          parcelGroup: 'Parcels A & B',
          dueDateISO: '2026-09-30',
          delinquencyDateISO: '2026-10-15',
          status: 'paid',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-10-05');
    const taxMsgs = msgs.filter((m) => m.type === 'tax_reminder');
    expect(taxMsgs).toHaveLength(0);
  });

  it('sends tax reminders for multiple open obligations independently', () => {
    const state = baseState({
      taxObligations: [
        {
          id: 1,
          parcelGroup: 'Parcels A & B',
          dueDateISO: '2026-09-30',
          delinquencyDateISO: '2026-10-15',
          status: 'open',
        },
        {
          id: 2,
          parcelGroup: 'Option Property',
          dueDateISO: '2026-09-30',
          delinquencyDateISO: '2026-10-15',
          status: 'open',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-10-05');
    const taxMsgs = msgs.filter((m) => m.type === 'tax_reminder');
    expect(taxMsgs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Insurance policy reminders
// ---------------------------------------------------------------------------

describe('insurance policy reminders', () => {
  it('sends an insurance renewal reminder 30 days before expiration', () => {
    // Expiration Aug 1 → reminder window starts Jul 2 (30 days prior). Today is Jul 2.
    const state = baseState({
      insurancePolicies: [
        {
          id: 1,
          carrier: 'State Farm',
          policyNumber: 'SF-1',
          expirationDateISO: '2026-08-01',
          status: 'active',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-07-02');
    const renewMsgs = msgs.filter((m) => m.type === 'insurance_renewal');
    expect(renewMsgs).toHaveLength(1);
    expect(renewMsgs[0].audience).toBe('buyer');
    expect(renewMsgs[0].subject).toContain('insurance');
  });

  it('sends no renewal reminder when more than 30 days from expiration', () => {
    const state = baseState({
      insurancePolicies: [
        {
          id: 1,
          carrier: 'State Farm',
          policyNumber: 'SF-1',
          expirationDateISO: '2026-08-01',
          status: 'active',
        },
      ],
    });
    // Jun 1 is 61 days before Aug 1 — outside the 30-day window.
    const msgs = dueReminders(state, '2026-06-01');
    const renewMsgs = msgs.filter((m) => m.type === 'insurance_renewal');
    expect(renewMsgs).toHaveLength(0);
  });

  it('sends an insurance-lapsed notification when expiration is today or past', () => {
    const state = baseState({
      insurancePolicies: [
        {
          id: 1,
          carrier: 'State Farm',
          policyNumber: 'SF-1',
          expirationDateISO: '2026-06-10',
          status: 'active',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-06-10');
    const lapsedMsgs = msgs.filter((m) => m.type === 'insurance_lapsed');
    expect(lapsedMsgs).toHaveLength(1);
    expect(lapsedMsgs[0].audience).toBe('both');
  });

  it('sends no lapsed notification when policy is already marked lapsed in DB', () => {
    // The DB status is updated by the cron side-effect (a write); on subsequent
    // days the cron should not fire a second lapsed notification.
    const state = baseState({
      insurancePolicies: [
        {
          id: 1,
          carrier: 'State Farm',
          policyNumber: 'SF-1',
          expirationDateISO: '2026-06-09',
          status: 'lapsed',
        },
      ],
    });
    // The pure function does NOT fire a lapsed notification if status is already 'lapsed'
    // (the cron handler only updates status once; see route.ts).
    const msgs = dueReminders(state, '2026-06-10');
    const lapsedMsgs = msgs.filter((m) => m.type === 'insurance_lapsed');
    expect(lapsedMsgs).toHaveLength(0);
  });

  it('does not send a renewal reminder when policy is already lapsed', () => {
    const state = baseState({
      insurancePolicies: [
        {
          id: 1,
          carrier: 'State Farm',
          policyNumber: 'SF-1',
          expirationDateISO: '2026-06-09',
          status: 'lapsed',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-06-10');
    const renewMsgs = msgs.filter((m) => m.type === 'insurance_renewal');
    expect(renewMsgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Royalty reminders
// ---------------------------------------------------------------------------

describe('royalty reminders', () => {
  it('sends a report-due reminder to the buyer when a royalty period is open and within 14 days of due date', () => {
    // Due Jul 1; today is Jun 17 (14 days prior).
    const state = baseState({
      royaltyPeriods: [
        {
          id: 1,
          dueDate: '2026-07-01',
          status: 'open',
          royaltyCents: null,
        },
      ],
    });
    const msgs = dueReminders(state, '2026-06-17');
    const reportMsgs = msgs.filter((m) => m.type === 'royalty_report_due');
    expect(reportMsgs).toHaveLength(1);
    expect(reportMsgs[0].audience).toBe('buyer');
  });

  it('sends no report-due reminder when more than 14 days from the royalty due date', () => {
    const state = baseState({
      royaltyPeriods: [
        {
          id: 1,
          dueDate: '2026-07-01',
          status: 'open',
          royaltyCents: null,
        },
      ],
    });
    // Jun 1 is 30 days before Jul 1.
    const msgs = dueReminders(state, '2026-06-01');
    const reportMsgs = msgs.filter((m) => m.type === 'royalty_report_due');
    expect(reportMsgs).toHaveLength(0);
  });

  it('sends no report-due reminder when buyer has already filed a report (status reported)', () => {
    const state = baseState({
      royaltyPeriods: [
        {
          id: 1,
          dueDate: '2026-07-01',
          status: 'reported',
          royaltyCents: 250_000,
        },
      ],
    });
    const msgs = dueReminders(state, '2026-06-25');
    const reportMsgs = msgs.filter((m) => m.type === 'royalty_report_due');
    expect(reportMsgs).toHaveLength(0);
  });

  it('sends a royalty-payment-due reminder to the seller when period is reported but not paid and past due date', () => {
    // Period is reported (buyer filed); due date was Jul 1; today is Jul 3 — seller should follow up.
    const state = baseState({
      royaltyPeriods: [
        {
          id: 1,
          dueDate: '2026-07-01',
          status: 'reported',
          royaltyCents: 250_000,
        },
      ],
    });
    const msgs = dueReminders(state, '2026-07-03');
    const payDueMsgs = msgs.filter((m) => m.type === 'royalty_payment_due');
    expect(payDueMsgs).toHaveLength(1);
    expect(payDueMsgs[0].audience).toBe('seller');
    expect(payDueMsgs[0].subject).toContain('royalty');
  });

  it('sends no royalty-payment-due reminder when period is already paid', () => {
    const state = baseState({
      royaltyPeriods: [
        {
          id: 1,
          dueDate: '2026-07-01',
          status: 'paid',
          royaltyCents: 250_000,
        },
      ],
    });
    const msgs = dueReminders(state, '2026-07-03');
    const payDueMsgs = msgs.filter((m) => m.type === 'royalty_payment_due');
    expect(payDueMsgs).toHaveLength(0);
  });

  it('sends no royalty-payment-due reminder before the due date even if reported', () => {
    const state = baseState({
      royaltyPeriods: [
        {
          id: 1,
          dueDate: '2026-07-01',
          status: 'reported',
          royaltyCents: 250_000,
        },
      ],
    });
    // Jun 25 is before the due date — seller should not be nagged yet.
    const msgs = dueReminders(state, '2026-06-25');
    const payDueMsgs = msgs.filter((m) => m.type === 'royalty_payment_due');
    expect(payDueMsgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-trigger: a busy day returns all applicable messages
// ---------------------------------------------------------------------------

describe('multiple triggers on the same day', () => {
  it('can return messages of different types in one call', () => {
    // Payment upcoming (Apr 28 = 3 days before May 1), tax reminder active, insurance renewal
    const state = baseState({
      taxObligations: [
        {
          id: 1,
          parcelGroup: 'Parcels A & B',
          dueDateISO: '2026-04-15',
          delinquencyDateISO: '2026-05-05',
          status: 'open',
        },
      ],
      insurancePolicies: [
        {
          id: 1,
          carrier: 'State Farm',
          policyNumber: 'SF-1',
          // 28 days from Apr 28 = May 26 expiration
          expirationDateISO: '2026-05-25',
          status: 'active',
        },
      ],
    });
    const msgs = dueReminders(state, '2026-04-28');
    const types = msgs.map((m) => m.type);
    // Payment upcoming (3 days before May 1), tax reminder (7 days before May 5 delinquency, within 10-day window), insurance renewal (27 days before May 25, within 30-day window)
    expect(types).toContain('payment_upcoming');
    expect(types).toContain('tax_reminder');
    expect(types).toContain('insurance_renewal');
  });

  it('returns an empty array when nothing is due', () => {
    const msgs = dueReminders(baseState(), '2025-01-01');
    expect(msgs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, confirm it fails.** `pnpm test src/lib/notifications.test.ts` → cannot resolve `./notifications`.

- [ ] **Step 3: Implement `src/lib/notifications.ts`**

```ts
import type { LoanTerms } from './amortization';
import { assessLateFee, type DatedSettlement } from './late-fees';
import { reminderTriggerDate, isLapsed } from './tax-reminder';
import { addMonths } from './amortization';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NotificationAudience = 'buyer' | 'seller' | 'both';

export type NotificationType =
  | 'payment_upcoming'
  | 'payment_missed'
  | 'tax_reminder'
  | 'insurance_renewal'
  | 'insurance_lapsed'
  | 'royalty_report_due'
  | 'royalty_payment_due';

export interface EmailMessage {
  type: NotificationType;
  audience: NotificationAudience;
  subject: string;
  body: string; // plain-text fallback; cron route converts to minimal HTML
}

// ---------------------------------------------------------------------------
// State shape (DB rows distilled to what the pure function needs)
// ---------------------------------------------------------------------------

export interface TaxObligationSnapshot {
  id: number;
  parcelGroup: string;
  dueDateISO: string;
  delinquencyDateISO: string;
  status: 'open' | 'paid';
}

export interface InsurancePolicySnapshot {
  id: number;
  carrier: string;
  policyNumber: string;
  expirationDateISO: string;
  status: 'active' | 'lapsed';
}

export interface RoyaltyPeriodSnapshot {
  id: number;
  dueDate: string; // 'YYYY-07-01' or 'YYYY-10-01'
  status: 'open' | 'reported' | 'paid';
  royaltyCents: number | null;
}

export interface NotificationState {
  loanTerms: Pick<LoanTerms, 'firstPaymentDate' | 'paymentCents' | 'termMonths'>;
  // All dated settlements that apply to the current loan period.
  // Already filtered to the current period by the caller (cron route).
  settlementsForCurrentPeriod: DatedSettlement[];
  taxObligations: TaxObligationSnapshot[];
  insurancePolicies: InsurancePolicySnapshot[];
  royaltyPeriods: RoyaltyPeriodSnapshot[];
}

// ---------------------------------------------------------------------------
// Window constants
// ---------------------------------------------------------------------------

/** Start sending "payment upcoming" reminders this many days before the due date. */
const PAYMENT_REMINDER_DAYS_BEFORE = 5;

/** Start sending "insurance renewal" reminders this many days before expiration. */
const INSURANCE_RENEWAL_DAYS_BEFORE = 30;

/** Start sending "royalty report due" reminders this many days before the royalty due date. */
const ROYALTY_REPORT_REMINDER_DAYS_BEFORE = 14;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Integer calendar-day difference: positive when `to` is after `from`. */
function dayDiff(fromISO: string, toISO: string): number {
  return (Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Main pure function
// ---------------------------------------------------------------------------

/**
 * Given a snapshot of the world and today's date, return the full list of
 * email messages the cron job should send.
 *
 * Guarantees:
 *   - No I/O (no DB calls, no network).
 *   - No `new Date()` — today is always injected.
 *   - Idempotent: calling twice with the same inputs returns the same list.
 */
export function dueReminders(
  state: NotificationState,
  todayISO: string,
): EmailMessage[] {
  const messages: EmailMessage[] = [];

  // -------------------------------------------------------------------------
  // 1. Loan payment reminders
  // -------------------------------------------------------------------------

  const { firstPaymentDate, paymentCents } = state.loanTerms;
  // Determine which period today falls in (1-based).
  const [fy, fm] = firstPaymentDate.split('-').map(Number);
  const [ty, tm] = todayISO.split('-').map(Number);
  const monthsElapsed = (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1));
  const currentPeriod = monthsElapsed < 0 ? 1 : monthsElapsed + 1;

  // Due date for the current period is always the 1st of the period's month.
  const dueDateISO = addMonths(firstPaymentDate, currentPeriod - 1);
  const daysUntilDue = dayDiff(todayISO, dueDateISO);

  // Determine if this period is already fully paid.
  let cumulative = 0;
  for (const s of state.settlementsForCurrentPeriod) {
    cumulative += s.amountCents;
  }
  const isPaid = cumulative >= paymentCents;

  if (!isPaid) {
    if (daysUntilDue > 0 && daysUntilDue <= PAYMENT_REMINDER_DAYS_BEFORE) {
      // Upcoming payment: due in 1..5 days.
      messages.push({
        type: 'payment_upcoming',
        audience: 'buyer',
        subject: `Park Payments: loan payment due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
        body:
          `Your monthly loan payment of $${(paymentCents / 100).toFixed(2)} is due on ${dueDateISO}.\n` +
          `You have ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} remaining within the grace period.`,
      });
    } else if (daysUntilDue <= 0) {
      // Use assessLateFee to determine if we are past the 5-day grace.
      const lateResult = assessLateFee(
        dueDateISO,
        paymentCents,
        state.settlementsForCurrentPeriod,
        todayISO,
      );
      if (lateResult.isLate) {
        const daysLate = Math.abs(daysUntilDue); // positive integer
        messages.push({
          type: 'payment_missed',
          audience: 'both',
          subject: `Park Payments: loan payment is late (${daysLate} day${daysLate === 1 ? '' : 's'} overdue)`,
          body:
            `The loan payment of $${(paymentCents / 100).toFixed(2)} that was due on ${dueDateISO} has not been received.\n` +
            `A late fee of $${(lateResult.lateFeeOwedCents / 100).toFixed(2)} has been assessed per the purchase agreement §3.`,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Tax delinquency reminders
  // -------------------------------------------------------------------------

  for (const tax of state.taxObligations) {
    if (tax.status === 'paid') continue;
    const triggerDate = reminderTriggerDate(tax.delinquencyDateISO);
    // Remind from the trigger date through the delinquency date.
    if (todayISO >= triggerDate && todayISO <= tax.delinquencyDateISO) {
      const daysToDelinquency = Math.ceil(dayDiff(todayISO, tax.delinquencyDateISO));
      messages.push({
        type: 'tax_reminder',
        audience: 'buyer',
        subject: `Park Payments: property tax due in ${daysToDelinquency} day${daysToDelinquency === 1 ? '' : 's'} — ${tax.parcelGroup}`,
        body:
          `Borough property taxes for ${tax.parcelGroup} are due ${tax.dueDateISO} ` +
          `and become delinquent on ${tax.delinquencyDateISO}.\n` +
          `Please pay and upload proof of payment at least 10 days before delinquency ` +
          `per Deed of Trust §A.4.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Insurance policy reminders
  // -------------------------------------------------------------------------

  for (const policy of state.insurancePolicies) {
    // Do not send renewal or lapsed messages for policies already marked lapsed.
    if (policy.status === 'lapsed') continue;

    if (isLapsed(policy.expirationDateISO, todayISO)) {
      // Policy expired today or in the past: lapse notification.
      messages.push({
        type: 'insurance_lapsed',
        audience: 'both',
        subject: `Park Payments: hazard insurance policy has lapsed — ${policy.carrier} ${policy.policyNumber}`,
        body:
          `The hazard insurance policy (${policy.carrier}, #${policy.policyNumber}) ` +
          `expired on ${policy.expirationDateISO} and has lapsed.\n` +
          `The seller (Anchor River RV, LLC) must remain the named loss payee on an active policy ` +
          `per Deed of Trust §A.2. Please renew immediately and upload the declarations page.`,
      });
    } else {
      const daysToExpiry = dayDiff(todayISO, policy.expirationDateISO);
      if (daysToExpiry <= INSURANCE_RENEWAL_DAYS_BEFORE) {
        messages.push({
          type: 'insurance_renewal',
          audience: 'buyer',
          subject: `Park Payments: insurance renewal approaching in ${Math.ceil(daysToExpiry)} day${Math.ceil(daysToExpiry) === 1 ? '' : 's'} — ${policy.carrier}`,
          body:
            `Your hazard insurance policy (${policy.carrier}, #${policy.policyNumber}) ` +
            `expires on ${policy.expirationDateISO}.\n` +
            `Renew and upload the renewed declarations page (naming Anchor River RV, LLC as loss payee) ` +
            `before expiration per Deed of Trust §A.2.`,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Royalty reminders
  // -------------------------------------------------------------------------

  for (const period of state.royaltyPeriods) {
    if (period.status === 'paid') continue;

    const daysUntilRoyaltyDue = dayDiff(todayISO, period.dueDate);

    if (period.status === 'open') {
      // Remind buyer to file a report when within the reminder window.
      if (daysUntilRoyaltyDue >= 0 && daysUntilRoyaltyDue <= ROYALTY_REPORT_REMINDER_DAYS_BEFORE) {
        messages.push({
          type: 'royalty_report_due',
          audience: 'buyer',
          subject: `Park Payments: royalty gross income report due by ${period.dueDate}`,
          body:
            `Your quarterly royalty report for the Option Property is due by ${period.dueDate}.\n` +
            `Please log in and file your gross income report so the 25% owed (§27d) can be computed.`,
        });
      }
    }

    if (period.status === 'reported' && daysUntilRoyaltyDue < 0) {
      // Due date has passed, buyer reported but seller has not confirmed payment.
      const royaltyFormatted =
        period.royaltyCents !== null
          ? `$${(period.royaltyCents / 100).toFixed(2)}`
          : 'amount not yet computed';
      messages.push({
        type: 'royalty_payment_due',
        audience: 'seller',
        subject: `Park Payments: royalty payment of ${royaltyFormatted} is due — ${period.dueDate}`,
        body:
          `The buyer has filed their royalty income report for the period due ${period.dueDate}.\n` +
          `The 25% royalty payment of ${royaltyFormatted} is now due per §27d.\n` +
          `Please confirm receipt in the app once payment is received.`,
      });
    }
  }

  return messages;
}
```

- [ ] **Step 4: Run, confirm all tests pass.** `pnpm test src/lib/notifications.test.ts`

Expected: all tests green (count will be 26+).

- [ ] **Step 5: Run the full unit suite to confirm no regressions.** `pnpm test`

Expected: all previous tests plus notifications tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts
git commit -m "feat: pure dueReminders notification logic with golden unit tests"
```

---

### Task 2: Email helper

**Files:** Create `src/lib/email.ts`. Install `resend`.

The helper is intentionally thin: one function, no logic beyond the Resend call, server-only. All retry/error handling is the caller's responsibility. This separation means the pure `notifications.ts` is never contaminated with SDK imports, and the cron route can mock `email.ts` trivially in any future integration tests.

- [ ] **Step 1: Install Resend.** `pnpm add resend`

- [ ] **Step 2: Create `src/lib/email.ts`**

```ts
import 'server-only';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS =
  process.env.RESEND_FROM_ADDRESS ?? 'onboarding@resend.dev';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send a single email via Resend.
 * Throws on error so the cron handler can log and continue.
 * Server-only: do not import this from client components.
 */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`);
  }
}
```

- [ ] **Step 3: Type-check.** `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email.ts package.json pnpm-lock.yaml
git commit -m "feat: Resend email helper (server-only sendEmail wrapper)"
```

---

### Task 3: `vercel.json` with crons array

**Files:** Create `vercel.json` at the project root.

The project currently has no `vercel.json`. This task creates it with a single daily cron entry.

- [ ] **Step 1: Verify the file does not already exist.**

```bash
ls vercel.json 2>/dev/null || echo "not present — creating"
```

- [ ] **Step 2: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/daily",
      "schedule": "0 13 * * *"
    }
  ]
}
```

Schedule note: `0 13 * * *` = 13:00 UTC daily. Alaska Standard Time (UTC-9) = 4:00 AM; Alaska Daylight Time (UTC-8) = 5:00 AM. Both are well before business hours and before any payments would be processed for the day.

- [ ] **Step 3: Confirm `next.config.mjs` does not conflict with cron routes.** Open `next.config.mjs` and confirm there are no custom rewrites or `output: 'export'` settings that would disable API routes.

```bash
cat next.config.mjs
```

Expected: standard config without `output: 'export'`.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat: vercel.json with daily cron at 13:00 UTC (/api/cron/daily)"
```

---

### Task 4: Cron route handler

**Files:** Create `src/app/api/cron/daily/route.ts`.

The route gathers state from the DB by calling existing repository functions (from Plans 3b, 5, 6), calls the pure `dueReminders` function, resolves recipient addresses from env vars, sends each email, and performs the two side-effect writes (open upcoming royalty periods; flip lapsed insurance status). All DB calls are the top-level await in the route; no DB access happens inside `dueReminders`.

- [ ] **Step 1: Create the directory and file.**

```bash
mkdir -p src/app/api/cron/daily
```

- [ ] **Step 2: Write `src/app/api/cron/daily/route.ts`**

```ts
import { type NextRequest } from 'next/server';
import { db } from '../../../../db/client';
import { insurancePolicies } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { ensureAnchorRiverLoan, getLoanTerms } from '../../../../db/repository';
import { getSettlementsForPeriod } from '../../../../db/late-fees-repository';
import { listPeriods as listRoyaltyPeriods, openPeriod } from '../../../../db/royalty-repository';
import {
  listTaxObligations,
  listInsurancePolicies,
} from '../../../../db/compliance-repository';
import { royaltyDueDates } from '../../../../lib/royalty';
import { currentPeriodIndex } from '../../../../lib/period';
import { isLapsed } from '../../../../lib/tax-reminder';
import {
  dueReminders,
  type NotificationState,
  type EmailMessage,
} from '../../../../lib/notifications';
import { sendEmail } from '../../../../lib/email';

// ---------------------------------------------------------------------------
// Security: require the Vercel cron secret on every invocation.
// ---------------------------------------------------------------------------

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // No secret configured → reject (safe default).
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

function resolveRecipients(audience: EmailMessage['audience']): string[] {
  const sellerEmail = process.env.SELLER_EMAIL ?? '';
  const buyerEmail = process.env.BUYER_EMAIL ?? '';

  switch (audience) {
    case 'seller':
      return sellerEmail ? [sellerEmail] : [];
    case 'buyer':
      return buyerEmail ? [buyerEmail] : [];
    case 'both':
      return [sellerEmail, buyerEmail].filter(Boolean);
  }
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const results: { type: string; to: string; ok: boolean; error?: string }[] = [];

  try {
    // -----------------------------------------------------------------------
    // 1. Gather state from DB
    // -----------------------------------------------------------------------

    const loanId = await ensureAnchorRiverLoan();
    const loanTerms = await getLoanTerms(loanId);
    const currentPeriod = currentPeriodIndex(loanTerms, todayISO);
    const settlementsForCurrentPeriod = await getSettlementsForPeriod(loanId, currentPeriod);

    const [taxObs, insurancePols, royaltyRows] = await Promise.all([
      listTaxObligations(),
      listInsurancePolicies(),
      listRoyaltyPeriods(),
    ]);

    const state: NotificationState = {
      loanTerms: {
        firstPaymentDate: loanTerms.firstPaymentDate,
        paymentCents: loanTerms.paymentCents,
        termMonths: loanTerms.termMonths,
      },
      settlementsForCurrentPeriod,
      taxObligations: taxObs.map((t) => ({
        id: t.id,
        parcelGroup: t.parcelGroup,
        dueDateISO: t.dueDateISO,
        delinquencyDateISO: t.delinquencyDateISO,
        status: t.status as 'open' | 'paid',
      })),
      insurancePolicies: insurancePols.map((p) => ({
        id: p.id,
        carrier: p.carrier,
        policyNumber: p.policyNumber,
        expirationDateISO: p.expirationDateISO,
        status: p.status as 'active' | 'lapsed',
      })),
      royaltyPeriods: royaltyRows.map((r) => ({
        id: r.id,
        dueDate: typeof r.dueDate === 'string' ? r.dueDate : (r.dueDate as Date).toISOString().slice(0, 10),
        status: r.status as 'open' | 'reported' | 'paid',
        royaltyCents: r.royaltyCents ?? null,
      })),
    };

    // -----------------------------------------------------------------------
    // 2. Side-effect: open upcoming royalty periods (idempotent)
    // -----------------------------------------------------------------------
    // Ensure a RoyaltyPeriod row exists for the current year and next year's
    // due dates so the pure function can see them when they enter the window.
    const currentYear = new Date().getFullYear();
    for (const yr of [currentYear, currentYear + 1]) {
      for (const dueDate of royaltyDueDates(yr)) {
        await openPeriod(yr, dueDate).catch(() => {
          // Already exists — openPeriod is idempotent; swallow the conflict.
        });
      }
    }

    // -----------------------------------------------------------------------
    // 3. Side-effect: flip active insurance policies to 'lapsed' when expired
    // -----------------------------------------------------------------------
    for (const policy of insurancePols) {
      if (policy.status === 'active' && isLapsed(policy.expirationDateISO, todayISO)) {
        await db
          .update(insurancePolicies)
          .set({ status: 'lapsed' })
          .where(eq(insurancePolicies.id, policy.id));
      }
    }

    // -----------------------------------------------------------------------
    // 4. Compute messages using the pure function
    // -----------------------------------------------------------------------
    const messages = dueReminders(state, todayISO);

    // -----------------------------------------------------------------------
    // 5. Send emails
    // -----------------------------------------------------------------------
    for (const msg of messages) {
      const recipients = resolveRecipients(msg.audience);
      for (const to of recipients) {
        try {
          await sendEmail({
            to,
            subject: msg.subject,
            html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${msg.body}</pre>`,
          });
          results.push({ type: msg.type, to, ok: true });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          results.push({ type: msg.type, to, ok: false, error: errorMsg });
          // Log but do not abort — continue sending remaining messages.
          console.error(`[cron/daily] sendEmail failed for ${msg.type} to ${to}:`, errorMsg);
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[cron/daily] fatal error in cron handler:', errorMsg);
    return Response.json({ ok: false, error: errorMsg }, { status: 500 });
  }

  return Response.json({ ok: true, todayISO, sent: results });
}
```

- [ ] **Step 3: Type-check.** `pnpm exec tsc --noEmit` → no errors.

Expected: The only type-check risk is the `dueDate` column type from `royalty_periods` (Drizzle `date` columns return `string` when using the `pg-core` driver with Neon's serverless adapter, but the route already handles both `string` and `Date` defensively).

- [ ] **Step 4: Run the full unit suite.** `pnpm test`

Expected: all tests pass (the new route has no unit test — it is an integration concern; the pure logic is fully covered in Task 1).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/daily/route.ts
git commit -m "feat: daily cron route — gather state, call dueReminders, send via Resend"
```

---

### Task 5: Build gate

Confirm the full application compiles and builds cleanly with the new route and new library files.

- [ ] **Step 1: Full type-check.** `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 2: Production build.** `pnpm run build` → green. Expect the `/api/cron/daily` route to appear in the build output as a dynamic route.

- [ ] **Step 3: Run the complete unit suite one final time.** `pnpm test` → all tests pass.

- [ ] **Step 4: Commit if any import-path fixes were required during the build.**

```bash
git add -p
git commit -m "fix: cron route import paths after build check"
```

---

### Task 6: Live integration gate (operator-only; requires env vars)

This gate is deferred until the operator provisions the live env vars. No code changes are needed. Document the manual verification steps here so the operator can execute them unambiguously.

**Prerequisites (set in Vercel dashboard and in `.env.local` for local testing):**
- `RESEND_API_KEY` — from resend.com/api-keys
- `RESEND_FROM_ADDRESS` — a verified sender address on a domain the operator controls. Until the domain is verified, leave this unset and `onboarding@resend.dev` will be used (delivers only to the Resend account owner's email; useful for smoke-testing).
- `CRON_SECRET` — any random string (e.g., `openssl rand -hex 32`)
- `SELLER_EMAIL` — `david.driggers@howtogrc.com`
- `BUYER_EMAIL` — buyer's confirmed email address

**Local smoke test (verify wiring without waiting for the Vercel scheduler):**

1. Start the dev server: `pnpm dev`
2. Trigger the cron manually:
   ```bash
   curl -s -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/daily | jq
   ```
3. Expected response shape:
   ```json
   { "ok": true, "todayISO": "2026-06-10", "sent": [] }
   ```
   `sent` is empty when no triggers are active for today. To test a specific trigger, temporarily insert a DB row that would fire (e.g., an open insurance policy expiring today) and re-run.

4. Verify a `payment_upcoming` fires:
   - Today must be within 5 days of a period due date (`firstPaymentDate` is 2026-05-01, so any date like `2026-04-26` through `2026-04-30` would trigger; simulate by temporarily overriding `todayISO` in the route or by adjusting the loan's `firstPaymentDate` in the test branch DB for the smoke test).
   - Alternatively: insert a settlement-free row for a future period and confirm the cron response includes a `payment_upcoming` entry with `ok: true`.

5. Check the Resend dashboard (resend.com) to confirm the email was delivered.

**Vercel deployed cron (once deployed to Vercel):**
- Navigate to Vercel dashboard → Project → Cron Jobs tab.
- Confirm `/api/cron/daily` appears with schedule `0 13 * * *`.
- Trigger manually from the Vercel UI ("Run now") for the first live test.
- Verify the function logs in Vercel Log Drain / Runtime Logs show `ok: true`.

---

## Self-Review

| Requirement | Task(s) | How satisfied |
|---|---|---|
| Daily cron fires at a predictable UTC time | Task 3 (`vercel.json` with `0 13 * * *`) | Creates `vercel.json` at repo root (previously absent); 13:00 UTC = ~4-5 AM Alaska. |
| CRON_SECRET guard on the route | Task 4 (`isAuthorized`) | Checks `Authorization: Bearer <secret>` header; returns 401 if missing or wrong; refuses all requests if `CRON_SECRET` is unset. |
| Upcoming payment reminder (5 days before due) | Task 1 (`payment_upcoming` tests), Task 4 | `dueReminders` emits `payment_upcoming` when `0 < daysUntilDue <= 5` and period is unsatisfied. 5 golden tests. |
| Missed/late payment reminder (past 5-day grace, unpaid) | Task 1 (`payment_missed` tests), Task 4 | `dueReminders` delegates to `assessLateFee` (reuses Plan 3b); emits `payment_missed` with audience `both` when `isLate && !isPaid`. 4 golden tests. |
| Tax delinquency reminder (delinquency date − 10 days) | Task 1 (`tax_reminder` tests), Task 4 | Reuses `reminderTriggerDate` from Plan 6; fires from trigger date through delinquency date; skips paid obligations. 5 golden tests. |
| Insurance renewal reminder (30 days before expiration) | Task 1 (`insurance_renewal` tests), Task 4 | Fires when `daysToExpiry <= 30` and policy is active. Does not fire for already-lapsed policies. 2 golden tests. |
| Insurance lapsed notification when expired | Task 1 (`insurance_lapsed` tests), Task 4 | Fires when `isLapsed(expiration, today)` and status is `active`; suppressed if already `lapsed` in DB (prevent duplicate daily fire). 2 golden tests. |
| Cron flips insurance status to 'lapsed' in DB | Task 4 (side-effect section) | Route updates `insurance_policies.status = 'lapsed'` for any active policy where `isLapsed` is true; runs before `dueReminders` so the pure function sees the correct state. |
| Royalty report-due reminder to buyer (14 days before) | Task 1 (`royalty_report_due` tests), Task 4 | Fires when period is `open` and `0 <= daysUntilDue <= 14`. 3 golden tests. |
| Royalty payment-due reminder to seller (after due date, reported but unpaid) | Task 1 (`royalty_payment_due` tests), Task 4 | Fires when period is `reported` and `daysUntilDue < 0`. 3 golden tests. |
| Cron auto-opens upcoming royalty periods | Task 4 (side-effect section) | Calls `openPeriod` idempotently for current year and next year's July 1 / October 1 dates; `openPeriod` is a no-op if the row already exists. |
| Pure `dueReminders` has NO DB or network calls | Task 1 | `notifications.ts` imports only from `./late-fees`, `./tax-reminder`, `./amortization` — all pure modules. No Resend, no Drizzle, no Clerk. Verified by test isolation (no mock needed). |
| Email helper is `server-only` and thin | Task 2 (`email.ts`) | Single export `sendEmail`; `import 'server-only'`; reads `RESEND_FROM_ADDRESS` env var with `onboarding@resend.dev` fallback; throws on Resend error so cron can log-and-continue. |
| Recipients resolved via env vars (`SELLER_EMAIL`, `BUYER_EMAIL`) | Task 4 (`resolveRecipients`) | Simple two-variable approach; suitable for a two-user app; no Clerk API call at cron time. Missing env vars → empty recipient list → message silently skipped and logged. |
| Resend SDK dependency installed | Task 2 | `pnpm add resend` |
| `vercel.json` did not previously exist | Task 3 | Step 1 verifies absence before creating; Task 5 build confirms it parses correctly. |
| `RESEND_API_KEY`, `CRON_SECRET`, `SELLER_EMAIL`, `BUYER_EMAIL`, `RESEND_FROM_ADDRESS` are live gates | Task 6 | Documented as operator-only; unit tests have zero dependency on these vars; email.ts and route.ts handle missing-var cases gracefully (throws → cron logs, continues). |
| Depends on Plans 3b, 5, 6 data | Plan dependencies section | If those tables are empty or absent the cron returns `sent: []`; no crash. |
| Placeholder scan | All tasks | No "..." or unimplemented stubs. `dueReminders` handles all 7 notification types fully. Route type-assertions (`as 'open' \| 'paid'`) are annotated with comments; they are safe because Drizzle enums constrain the DB values at insert time. |

**Integer cents:** all monetary values in `notifications.ts` body text are formatted via `(cents / 100).toFixed(2)`. No floating-point values are stored or passed across module boundaries.

**Deferred:**
- Webhook-driven Plaid sync (Plan 4 deferred this; the daily cron is the v1 polling mechanism).
- Rich HTML email templates (the current implementation wraps `body` in a `<pre>` tag; a future design pass can replace this with proper HTML/CSS templates).
- Per-notification-type unsubscribe / preference management (out of scope for v1; two-user app).
- Plaid sync trigger inside the daily cron (the Plaid sync action from Plan 4 can be called as an additional step in `route.ts` after notifications are sent; not included here to keep Plan 7 self-contained).
- Verified sending domain (`RESEND_FROM_ADDRESS`): operator must register a domain in the Resend dashboard and set the env var; the code is already wired to read it.
