'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { getCurrentRole, requireSeller } from '../lib/current-role';
import { royaltyOwed } from '../lib/royalty';
import {
  openPeriod,
  reportIncome,
  confirmPaid,
  listPeriods,
} from '../db/royalty-repository';

/**
 * Load all royalty periods for display. Callable by both roles.
 */
export async function loadRoyaltyPeriods() {
  return listPeriods();
}

/**
 * Buyer or seller submits gross income for a royalty period.
 * Computes and stores the 25% owed. Opens the period if not yet open.
 *
 * FormData fields:
 *   dueDate       -- ISO date string, must be 'YYYY-07-01' or 'YYYY-10-01'
 *   grossDollars  -- positive decimal dollar amount (e.g., "12500.00")
 *
 * Note: year is extracted from dueDate directly to avoid hidden-field sync issues.
 */
export async function reportRoyalty(formData: FormData): Promise<void> {
  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) throw new Error('Unauthorized');

  const role = await getCurrentRole();
  if (role !== 'buyer' && role !== 'seller') throw new Error('Forbidden');

  const dueDate = String(formData.get('dueDate') ?? '').trim();
  const grossDollars = Number(formData.get('grossDollars'));

  if (!/^\d{4}-(07|10)-01$/.test(dueDate)) {
    throw new Error('dueDate must be YYYY-07-01 or YYYY-10-01');
  }

  // Extract year from dueDate string -- avoids hidden-field sync problem.
  const year = Number(dueDate.slice(0, 4));
  if (year < 2025 || year > 2040) {
    throw new Error('year must be between 2025 and 2040');
  }

  if (!Number.isFinite(grossDollars) || grossDollars < 0) {
    throw new Error('grossDollars must be a non-negative number');
  }

  const grossCents = Math.round(grossDollars * 100);
  const royaltyCents = royaltyOwed(grossCents);

  const periodId = await openPeriod(year, dueDate);
  await reportIncome(periodId, grossCents, royaltyCents, userId);

  revalidatePath('/');
}

/**
 * Seller confirms that the royalty payment has been received.
 * Seller-only via requireSeller().
 *
 * FormData fields:
 *   periodId -- integer id of the royalty_periods row
 */
export async function confirmRoyaltyPaid(formData: FormData): Promise<void> {
  await requireSeller();
  const { userId } = await auth();

  const periodId = Number(formData.get('periodId'));
  if (!Number.isInteger(periodId) || periodId < 1) {
    throw new Error('periodId must be a positive integer');
  }

  await confirmPaid(periodId, userId!);
  revalidatePath('/');
}
