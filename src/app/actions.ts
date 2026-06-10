'use server';

import { revalidatePath } from 'next/cache';
import {
  ensureAnchorRiverLoan,
  getLoanTerms,
  getAppliedPayments,
  addManualPayment,
} from '../db/repository';
import { generateSchedule, type ScheduleResult } from '../lib/amortization';
import { dollarsToCents } from '../lib/money';

export async function loadSchedule(): Promise<ScheduleResult> {
  const loanId = await ensureAnchorRiverLoan();
  const terms = await getLoanTerms(loanId);
  const applied = await getAppliedPayments(loanId);
  return generateSchedule(terms, applied);
}

export async function submitPayment(formData: FormData): Promise<void> {
  const loanId = await ensureAnchorRiverLoan();
  const periodIndex = Number(formData.get('periodIndex'));
  const dollars = Number(formData.get('amountDollars'));
  const postedDate = String(formData.get('postedDate'));

  if (!Number.isInteger(periodIndex) || periodIndex < 1) {
    throw new Error('periodIndex must be a positive integer');
  }
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error('amount must be a positive number');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postedDate)) {
    throw new Error('postedDate must be YYYY-MM-DD');
  }

  await addManualPayment(loanId, {
    periodIndex,
    amountCents: dollarsToCents(dollars),
    postedDate,
  });
  revalidatePath('/');
}
