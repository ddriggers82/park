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

export type LoanRow = typeof loans.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
