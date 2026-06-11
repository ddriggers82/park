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
  if (!secret) return false; // No secret configured — reject (safe default).
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
