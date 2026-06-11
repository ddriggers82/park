import { eq, desc } from 'drizzle-orm';
import { db } from './client';
import {
  taxObligations,
  insurancePolicies,
  type TaxObligationRow,
  type InsurancePolicyRow,
} from './schema';

// ---------------------------------------------------------------------------
// Tax obligations
// ---------------------------------------------------------------------------

export async function addTaxObligation(input: {
  parcelGroup: string;
  dueDateISO: string;
  delinquencyDateISO: string;
  createdBy: string;
}): Promise<TaxObligationRow> {
  const [row] = await db
    .insert(taxObligations)
    .values(input)
    .returning();
  return row;
}

export async function markTaxPaid(
  obligationId: number,
  input: { proofUrl: string | null; paidBy: string },
): Promise<void> {
  await db
    .update(taxObligations)
    .set({
      status: 'paid',
      proofUrl: input.proofUrl,
      paidBy: input.paidBy,
      paidAt: new Date(),
    })
    .where(eq(taxObligations.id, obligationId));
}

export async function listTaxObligations(): Promise<TaxObligationRow[]> {
  return db
    .select()
    .from(taxObligations)
    .orderBy(desc(taxObligations.delinquencyDateISO));
}

// ---------------------------------------------------------------------------
// Insurance policies
// ---------------------------------------------------------------------------

export async function addInsurancePolicy(input: {
  carrier: string;
  policyNumber: string;
  coverageCents: number;
  effectiveDateISO: string;
  expirationDateISO: string;
  lossPayeeConfirmed: number; // 1 = confirmed, 0 = not confirmed
  declarationsUrl: string | null;
  createdBy: string;
}): Promise<InsurancePolicyRow> {
  const [row] = await db
    .insert(insurancePolicies)
    .values(input)
    .returning();
  return row;
}

export async function listInsurancePolicies(): Promise<InsurancePolicyRow[]> {
  return db
    .select()
    .from(insurancePolicies)
    .orderBy(desc(insurancePolicies.expirationDateISO));
}
