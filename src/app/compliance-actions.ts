'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { requireSeller, getCurrentRole } from '../lib/current-role';
import { uploadReceipt } from '../lib/blob';
import { dollarsToCents } from '../lib/money';
import {
  addTaxObligation,
  markTaxPaid,
  listTaxObligations,
  addInsurancePolicy,
  listInsurancePolicies,
} from '../db/compliance-repository';

// ---------------------------------------------------------------------------
// Tax obligations
// ---------------------------------------------------------------------------

/**
 * Seller-only: create a new tax obligation record for a parcel group.
 * Due date and delinquency date are YYYY-MM-DD strings from the form.
 */
export async function createTaxObligation(formData: FormData): Promise<void> {
  await requireSeller();
  const { userId } = await auth();

  const parcelGroup = String(formData.get('parcelGroup') ?? '').trim();
  const dueDateISO = String(formData.get('dueDateISO') ?? '').trim();
  const delinquencyDateISO = String(formData.get('delinquencyDateISO') ?? '').trim();
  const parcelPin = String(formData.get('parcelPin') ?? '').trim() || null;
  const parcelUrl = String(formData.get('parcelUrl') ?? '').trim() || null;
  const amountRaw = Number(formData.get('amountDollars'));
  const amountCents = Number.isFinite(amountRaw) && amountRaw > 0 ? Math.round(amountRaw * 100) : null;

  if (!parcelGroup) throw new Error('parcelGroup is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateISO)) throw new Error('dueDateISO must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(delinquencyDateISO))
    throw new Error('delinquencyDateISO must be YYYY-MM-DD');
  if (delinquencyDateISO <= dueDateISO)
    throw new Error('delinquencyDateISO must be after dueDateISO');

  await addTaxObligation({ parcelGroup, dueDateISO, delinquencyDateISO, parcelPin, parcelUrl, amountCents, createdBy: userId! });
  revalidatePath('/');
}

/**
 * Any signed-in user (buyer pays the taxes): mark an obligation paid and
 * optionally upload a proof file (receipt, confirmation screenshot).
 */
export async function submitTaxProof(formData: FormData): Promise<void> {
  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) throw new Error('Unauthorized');
  const role = await getCurrentRole();
  if (!role) throw new Error('Forbidden: no role assigned');

  const obligationId = Number(formData.get('obligationId'));
  if (!Number.isInteger(obligationId) || obligationId < 1)
    throw new Error('obligationId must be a positive integer');

  const file = formData.get('proof');
  let proofUrl: string | null = null;
  if (file instanceof File && file.size > 0) {
    proofUrl = await uploadReceipt(file);
  }

  await markTaxPaid(obligationId, { proofUrl, paidBy: userId });
  revalidatePath('/');
}

/**
 * Load all tax obligations (server-side, used by ComplianceSection).
 */
export async function loadTaxObligations() {
  return listTaxObligations();
}

// ---------------------------------------------------------------------------
// Insurance policies
// ---------------------------------------------------------------------------

/**
 * Seller-only: add a new insurance policy record and optionally upload
 * a declarations page (PDF or image).
 */
export async function createInsurancePolicy(formData: FormData): Promise<void> {
  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) throw new Error('Unauthorized');
  const role = await getCurrentRole();
  if (role !== 'buyer' && role !== 'seller') throw new Error('Forbidden');

  const carrier = String(formData.get('carrier') ?? '').trim();
  const policyNumber = String(formData.get('policyNumber') ?? '').trim();
  const coverageDollars = Number(formData.get('coverageDollars'));
  const effectiveDateISO = String(formData.get('effectiveDateISO') ?? '').trim();
  const expirationDateISO = String(formData.get('expirationDateISO') ?? '').trim();
  const lossPayeeConfirmedRaw = formData.get('lossPayeeConfirmed');
  const lossPayeeConfirmed =
    lossPayeeConfirmedRaw === 'true' || lossPayeeConfirmedRaw === '1' ? 1 : 0;
  const file = formData.get('declarations');

  if (!carrier) throw new Error('carrier is required');
  if (!policyNumber) throw new Error('policyNumber is required');
  if (!Number.isFinite(coverageDollars) || coverageDollars <= 0)
    throw new Error('coverageDollars must be a positive number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDateISO))
    throw new Error('effectiveDateISO must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expirationDateISO))
    throw new Error('expirationDateISO must be YYYY-MM-DD');
  if (expirationDateISO <= effectiveDateISO)
    throw new Error('expirationDateISO must be after effectiveDateISO');

  let declarationsUrl: string | null = null;
  if (file instanceof File && file.size > 0) {
    declarationsUrl = await uploadReceipt(file);
  }

  await addInsurancePolicy({
    carrier,
    policyNumber,
    coverageCents: dollarsToCents(coverageDollars),
    effectiveDateISO,
    expirationDateISO,
    lossPayeeConfirmed,
    declarationsUrl,
    createdBy: userId!,
  });
  revalidatePath('/');
}

/**
 * Load all insurance policies (server-side, used by ComplianceSection).
 */
export async function loadInsurancePolicies() {
  return listInsurancePolicies();
}
