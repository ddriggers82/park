'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { requireSeller } from '../lib/current-role';
import { ensureAnchorRiverLoan, getLoanTerms } from '../db/repository';
import {
  listWaivers,
  upsertWaiver,
  getSettlementsForPeriod,
} from '../db/late-fees-repository';
import { assessLateFee } from '../lib/late-fees';
import { addMonths } from '../lib/amortization';

export interface PeriodLateFeeStatus {
  periodIndex: number;
  dueDate: string;
  isLate: boolean;
  lateFeeOwedCents: number;   // 0 if not late or waived
  satisfiedDate: string | null;
  isWaived: boolean;
}

export interface LateFeeSummary {
  periods: PeriodLateFeeStatus[];
  totalOwedCents: number; // sum of lateFeeOwedCents across non-waived late periods
}

// Load late fee status for all periods up through the current period.
// Called by LateFeesSection -- runs on the server, no client exposure.
export async function loadLateFeeSummary(todayISO: string): Promise<LateFeeSummary> {
  const loanId = await ensureAnchorRiverLoan();
  const terms = await getLoanTerms(loanId);
  const waivers = await listWaivers(loanId);
  const waivedPeriods = new Set(waivers.map((w) => w.periodIndex));

  // Assess all periods whose due date is <= today.
  const [ty, tm] = todayISO.split('-').map(Number);
  const [fy, fm] = terms.firstPaymentDate.split('-').map(Number);
  const monthsElapsed = (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1));
  // Include the current month (period 1 = index 0 in addMonths).
  const periodCount = Math.max(1, monthsElapsed + 1);
  const maxPeriods = Math.min(periodCount, terms.termMonths);

  const periodStatuses: PeriodLateFeeStatus[] = [];
  let totalOwedCents = 0;

  for (let i = 1; i <= maxPeriods; i++) {
    const dueDate = addMonths(terms.firstPaymentDate, i - 1);
    // Skip periods whose due date is in the future (no point assessing yet).
    if (dueDate > todayISO) break;

    const settlements = await getSettlementsForPeriod(loanId, i);
    const result = assessLateFee(dueDate, terms.paymentCents, settlements, todayISO);
    const isWaived = waivedPeriods.has(i);

    const owedForPeriod = result.isLate && !isWaived ? result.lateFeeOwedCents : 0;
    totalOwedCents += owedForPeriod;

    periodStatuses.push({
      periodIndex: i,
      dueDate,
      isLate: result.isLate,
      lateFeeOwedCents: owedForPeriod,
      satisfiedDate: result.satisfiedDate,
      isWaived,
    });
  }

  return { periods: periodStatuses, totalOwedCents };
}

// Seller-only: waive the late fee for a given period.
export async function waiveLateFee(formData: FormData): Promise<void> {
  await requireSeller();
  const { userId } = await auth();
  const periodIndex = Number(formData.get('periodIndex'));
  if (!Number.isInteger(periodIndex) || periodIndex < 1) {
    throw new Error('periodIndex must be a positive integer');
  }
  const loanId = await ensureAnchorRiverLoan();
  await upsertWaiver(loanId, periodIndex, userId!);
  revalidatePath('/');
}
