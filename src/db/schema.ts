import {
  pgTable,
  bigserial,
  bigint,
  integer,
  numeric,
  date,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const loans = pgTable('loans', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  principalCents: bigint('principal_cents', { mode: 'number' }).notNull(),
  annualRatePct: numeric('annual_rate_pct').notNull(),
  termMonths: integer('term_months').notNull(),
  paymentCents: bigint('payment_cents', { mode: 'number' }).notNull(),
  firstPaymentDate: date('first_payment_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loanId: bigint('loan_id', { mode: 'number' })
    .notNull()
    .references(() => loans.id),
  periodIndex: integer('period_index').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  source: text('source', { enum: ['plaid', 'manual'] })
    .notNull()
    .default('manual'),
  postedDate: date('posted_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Dedup is enforced in code (plaid-repository pre-insert check), not a DB unique
  // constraint, to avoid a hazardous constraint-add migration against existing rows.
  plaidTxnId: text('plaid_txn_id'),
});

export const expenseCredits = pgTable('expense_credits', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loanId: bigint('loan_id', { mode: 'number' })
    .notNull()
    .references(() => loans.id),
  periodIndex: integer('period_index').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  description: text('description').notNull(),
  receiptUrl: text('receipt_url'),
  status: text('status', { enum: ['applied', 'reversed'] })
    .notNull()
    .default('applied'),
  createdBy: text('created_by').notNull(), // Clerk user id
  createdAt: timestamp('created_at').defaultNow().notNull(),
  reversedAt: timestamp('reversed_at'),
  reversedBy: text('reversed_by'),
});

export type LoanRow = typeof loans.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type ExpenseCreditRow = typeof expenseCredits.$inferSelect;

// One row per waived period per loan.
// Upserting on (loanId, periodIndex) allows a seller to re-waive without duplication.
export const lateFeeWaivers = pgTable('late_fee_waivers', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loanId: bigint('loan_id', { mode: 'number' }).notNull(),
  periodIndex: integer('period_index').notNull(),
  waivedBy: text('waived_by').notNull(), // Clerk user id (seller)
  waivedAt: timestamp('waived_at').defaultNow().notNull(),
});

export type LateFeeWaiverRow = typeof lateFeeWaivers.$inferSelect;

export const royaltyPeriods = pgTable('royalty_periods', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  year: integer('year').notNull(),
  dueDate: date('due_date').notNull(), // 'YYYY-07-01' or 'YYYY-10-01'
  grossIncomeCents: bigint('gross_income_cents', { mode: 'number' }), // null until reported
  royaltyCents: bigint('royalty_cents', { mode: 'number' }),          // null until reported
  status: text('status', { enum: ['open', 'reported', 'paid'] })
    .notNull()
    .default('open'),
  reportedBy: text('reported_by'),
  reportedAt: timestamp('reported_at'),
  paidConfirmedBy: text('paid_confirmed_by'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type RoyaltyPeriodRow = typeof royaltyPeriods.$inferSelect;

export const taxObligations = pgTable('tax_obligations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  parcelGroup: text('parcel_group').notNull(), // e.g. "Parcels A & B"
  dueDateISO: date('due_date_iso').notNull(),
  delinquencyDateISO: date('delinquency_date_iso').notNull(),
  status: text('status', { enum: ['open', 'paid'] })
    .notNull()
    .default('open'),
  proofUrl: text('proof_url'),
  paidBy: text('paid_by'), // Clerk user id, null until paid
  paidAt: timestamp('paid_at'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type TaxObligationRow = typeof taxObligations.$inferSelect;

export const insurancePolicies = pgTable('insurance_policies', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  carrier: text('carrier').notNull(),
  policyNumber: text('policy_number').notNull(),
  coverageCents: bigint('coverage_cents', { mode: 'number' }).notNull(),
  effectiveDateISO: date('effective_date_iso').notNull(),
  expirationDateISO: date('expiration_date_iso').notNull(),
  lossPayeeConfirmed: integer('loss_payee_confirmed').notNull().default(0), // 0=false, 1=true
  declarationsUrl: text('declarations_url'),
  status: text('status', { enum: ['active', 'lapsed'] })
    .notNull()
    .default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type InsurancePolicyRow = typeof insurancePolicies.$inferSelect;

// ---- Plaid integration ----
// NOTE: if schema is reorganized into src/db/schema/, this block moves to
//       src/db/schema/plaid.ts. Until then, append here.

export const plaidItems = pgTable('plaid_items', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loanId: bigint('loan_id', { mode: 'number' })
    .notNull()
    .references(() => loans.id),
  // SECURITY: access_token is a bearer credential with permanent read access
  // to the seller's Wells Fargo account. Stored plaintext here; a secure-phase
  // task should encrypt with PLAID_TOKEN_ENCRYPTION_KEY before insert.
  accessToken: text('access_token').notNull(),
  itemId: text('item_id').notNull(),
  syncCursor: text('sync_cursor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type PlaidItemRow = typeof plaidItems.$inferSelect;
