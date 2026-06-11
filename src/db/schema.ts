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
