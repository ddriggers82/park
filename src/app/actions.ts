'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import {
  ensureAnchorRiverLoan,
  getLoanTerms,
  getAppliedPayments,
  addManualPayment,
  addExpenseCredit,
  reverseExpenseCredit,
  listExpenseCredits,
} from '../db/repository';
import { generateSchedule, type ScheduleResult } from '../lib/amortization';
import { dollarsToCents } from '../lib/money';
import { requireSeller, getCurrentRole } from '../lib/current-role';
import { currentPeriodIndex } from '../lib/period';
import { uploadReceipt } from '../lib/blob';

export async function loadSchedule(): Promise<ScheduleResult> {
  const loanId = await ensureAnchorRiverLoan();
  const terms = await getLoanTerms(loanId);
  const applied = await getAppliedPayments(loanId);
  return generateSchedule(terms, applied);
}

export async function submitPayment(formData: FormData): Promise<void> {
  await requireSeller();
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

export async function submitCredit(formData: FormData): Promise<void> {
  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) throw new Error('Unauthorized');
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

export async function loadCredits() {
  const loanId = await ensureAnchorRiverLoan();
  return listExpenseCredits(loanId);
}
