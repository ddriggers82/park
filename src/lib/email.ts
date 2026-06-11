import 'server-only';
import { Resend } from 'resend';

// Lazily create the Resend client so that the module can be imported during
// Next.js build even when RESEND_API_KEY is not set. The client is created
// on first call to sendEmail (which only happens at request time, not build time).
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

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
  const { error } = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });
  if (error) {
    throw new Error(`Resend send failed: ${(error as { message?: string }).message ?? JSON.stringify(error)}`);
  }
}
