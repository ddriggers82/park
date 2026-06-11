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
