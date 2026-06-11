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
    throw new Error(`Resend send failed: ${(error as { message?: string }).message ?? JSON.stringify(error)}`);
  }
}
