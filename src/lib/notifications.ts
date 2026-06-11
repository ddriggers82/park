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
