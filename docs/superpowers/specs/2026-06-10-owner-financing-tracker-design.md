# Owner-Financing Tracker — Design Spec

**Date:** 2026-06-10
**Status:** Draft for review
**Source of truth:** `rvpark/Kyllonens Pruchase Contract.docx` (Alaska Real Estate Purchase Agreement, effective Aug 11, 2025). Where this spec and the contract disagree, the contract wins.

---

## 1. Purpose

A two-user web app for managing a seller-financed real estate sale. The seller (note-holder) and the buyer (payer) each log in. The app tracks the loan, reconciles payments against the seller's bank account, handles buyer expense credits, tracks the RV-site royalty stream, and monitors property-tax payment to the Kenai Peninsula Borough.

The app exists to protect the seller's position (catch missed payments, unpaid taxes that could prime the lien, under-reported royalties) and to give the buyer a clear, self-service view of what they owe.

## 2. The Deal (from the contract)

- **Parties:** Seller = Anchor River RV, LLC (David Driggers, Member). Buyer = Kyllonen's RV Park, LLC. Warranty deed and Deed of Trust recorded October 2025, Homer Recording District, Alaska.
- **Property:** RV park at 74165, Anchor Point, Alaska. Parcels A and B are sold to the buyer. A third lot ("Option Property") is *not* sold but is under a 3-year purchase option and use agreement.
- **Price / financing:** $276,000 price, $125,000 down, **$151,000 financed**.
- **Loan terms:** 8.5%/yr, 10-year term, level monthly principal & interest. Payment **$1,872.18/month** — confirmed verbatim by the promissory note ("One Thousand Eight Hundred Seventy Two Dollars and Eighteen Cents"). No escrow/impound: the payment is pure P&I; the buyer pays taxes and insurance directly.
- **First payment:** May 1, 2026, then the 1st of each month. Amortization starts clean on May 1, 2026 on the $151,000 balance — no interest is modeled for the closing-to-first-payment gap.
- **Maturity:** 2036 (10-year term). Deed of Trust §14 adds a **due-on-sale acceleration**: if the buyer sells or leases-with-option the secured property, the full balance is immediately due.
- **Payment application:** each payment applied first to accrued interest, then principal (purchase agreement §3).
- **Late fee:** 5% of the payment, assessed when a payment is more than 5 days late (purchase agreement §3).
- **Prepayment:** allowed without penalty, but does **not** relieve the borrower of regular scheduled payments until paid in full. This means extra principal **shortens the term** (the monthly obligation is unchanged; the loan ends sooner).
- **RV royalty (purchase agreement §27(d)):** during the option period, buyer pays seller **25% of gross income** from the Option Property, **due July 1 and October 1** each year. Self-reported by the buyer. Independent of the loan.
- **Property taxes (Deed of Trust covenant A.4):** buyer must pay all taxes/assessments on the secured property **at least 10 days before delinquency**. Kenai Peninsula Borough. App monitors and keeps proof on file (reminders + receipts).
- **Hazard insurance (Deed of Trust covenant A.2):** buyer must maintain fire/extended-coverage insurance with the **seller as loss payee**. App monitors the policy (renewal date, proof on file, reminders) — same mechanism as taxes.

## 3. Scope

### In scope
- Loan ledger and derived amortization schedule (term-shortening).
- Payment intake via **Plaid** (seller's Wells Fargo) plus **manual entry**, behind an import-adapter seam.
- Bank reconciliation: auto-match deposits to scheduled periods; surface unmatched/near-miss.
- Expense credits: buyer-entered, auto-applied to the current month, seller-reviewed after the fact, reversible.
- Late-fee assessment per §3.
- RV royalty stream: buyer reports gross income per period; app computes 25%; due July 1 / Oct 1; reconciled like any inflow.
- Property-tax monitoring: reminders (trigger at *delinquency date − 10 days* per covenant A.4) + uploaded proof, all parcels.
- Hazard-insurance monitoring: policy renewal/expiration tracking, proof on file (declarations page naming the seller as loss payee), renewal reminders. Same mechanism as taxes.
- Two roles (seller / buyer) with an authorization boundary.
- Email notifications (Resend) and scheduled jobs (Vercel Cron).

### Out of scope (explicit decisions)
- The Option Property **purchase option** and right of first refusal (not tracked yet).
- The Option Property **tax-reimbursement fee** (§27(a)) — app monitors taxes only; it does **not** model the buyer reimbursing the seller for Option Property taxes.
- **Live borough scraping** — the Kenai portal is a fragile ASP.NET/Aumentum postback site; receipts on file are the source of truth.
- Bank auto-sync beyond Plaid (no OFX/CSV in v1; the adapter seam keeps the door open).
- Seller punch-list items from §27 (PEX waterlines, gravel, propane-tank removal) — not financial, not tracked.
- Personal property / fixtures inventory — not financially tracked.

## 4. Architecture

A single **Next.js (App Router)** application on **Vercel**.

- **Database:** Neon Postgres (Vercel Marketplace). Relational; money is ledgers, not documents.
- **File storage:** Vercel Blob, for receipts and confirmations.
- **Auth:** Clerk (Vercel Marketplace), two roles: `seller`, `buyer`.
- **Bank feed:** Plaid (Transactions product), connected to the seller's Wells Fargo account only.
- **Scheduled jobs:** Vercel Cron.
- **Email:** Resend.

**Portability note:** the app is a standard Next.js monolith and avoids Vercel-proprietary primitives in the core, so it can move to a VPS or Cloudflare with no change to business logic if Vercel's commercial-use terms (Hobby is non-commercial; Pro is $20/mo) become a concern.

### The two-ledger principle (the spine)

How a payment is **settled** is independent of how it is **applied** to the loan.

- **Loan ledger** — immutable origination terms plus the dated list of actual payments (regular, extra, credit-sourced). The amortization schedule is **derived/recomputed on demand**, never stored as fixed rows. Extra principal, late payments, and corrections all fall out of the recompute.
- **Settlement ledger** — how each monthly obligation was satisfied: Plaid deposit, manual cash entry, and/or approved expense credit. It meets the loan ledger at exactly one number: *amount applied to the loan this period*. Overpayment by any route spills to principal.

These two ledgers are kept structurally separate so that expense credits, extra principal, and bank reconciliation are independent and independently testable.

## 5. Data Model

All monetary values stored as **integer cents (bigint)**. Never floating-point dollars. Format to dollars only at display.

- **Loan** — origination terms for parcels A+B: principal (15,100,000 cents), annual rate (8.5%), term (120 months), first-payment date (2026-05-01), payment-day (1), late-fee rule (5% after 5 days), level payment (≈187,218 cents). Single row for this deal; schema supports one loan but is not artificially hard-coded to one.
- **Payment** — an actual inflow: source (`plaid` | `manual`), posted date, amount, the period it satisfies, and match status (`matched` | `unmatched` | `partial`). Plaid transaction ID stored for idempotent dedup.
- **ExpenseCredit** — buyer-entered: amount, description, date, linked receipt `Document`, status (`applied` | `reversed`). Applies automatically to the current month; seller can reverse, which re-derives the schedule.
- **RoyaltyPeriod** — one per royalty due date (July 1, Oct 1): reporting window, buyer-reported gross income, computed 25% owed, linked report `Document`, payment/match status. Independent of the loan.
- **TaxObligation** — per parcel group: borough due date, delinquency date, status (`open` | `paid`), linked proof `Document`, who paid. Reminder fires at delinquency − 10 days.
- **InsurancePolicy** — carrier, policy number, coverage amount, effective and **expiration/renewal date**, loss-payee confirmation flag, linked declarations-page `Document`, status (`active` | `lapsed`). Reminder fires ahead of the renewal date.
- **Document** — Blob-backed file (receipt, confirmation, royalty report, insurance declarations), linked to a credit, tax obligation, royalty period, or insurance policy.
- **ScheduledPayment** — a **derived view**, not a table. Computed from `Loan` terms + ordered `Payment`/credit history.

## 6. Amortization Engine

A **pure function** with no I/O:

```
input:  loan terms + ordered list of applied amounts with dates
output: full schedule, current balance, projected payoff date
```

- Integer-cents math throughout.
- Per period: `interest = round(balance * monthly_rate)`, `principal = applied - interest`, `balance -= principal`.
- Overpayment (applied > scheduled payment) spills entirely to principal → term shortens.
- Final payment trues up to land the balance exactly on zero.
- No DB calls inside; trivially unit-testable against a known-good table.

This module is the highest-risk code and gets a **golden-master test**: a full 120-month schedule asserted to the cent against an independently-verified amortization table, plus cases for extra principal, partial payment, late payment, and payoff rounding.

## 7. User Flows & Authorization

**Authorization boundary:** the buyer can *write claims* (expense credits, royalty reports) but can never *read or alter* the loan math or the Plaid feed. Buyer submissions are provisional until the seller's silence ratifies or reversal rejects them. A bug in buyer-facing code cannot corrupt the loan ledger.

### Seller (Anchor River RV, LLC)
- Dashboard: current balance, next payment due, projected payoff date, royalty owed this period, tax status.
- Amortization schedule (derived) with actual payments overlaid on scheduled; discrepancies flagged.
- Review/reverse expense credits (already auto-applied).
- Review royalty reports; confirm the 25% payment landed.
- Set/adjust borough due dates; upload tax proof; see who paid.
- Plaid feed: auto-matched deposits, with unmatched/near-miss surfaced to assign or ignore.

### Buyer (Kyllonen's RV Park, LLC)
- Own balance, next payment, payoff progress (read-only on loan math).
- Enter an expense credit (amount, description, receipt) — applies to the current month immediately.
- File a royalty report (gross income for the period) — app computes 25% owed.
- Upload tax payment proof.
- See reminders directed at them.

## 8. Reconciliation, Late Fees, Edge Cases

- **Matching:** an incoming deposit matches a period when amount and timing align; near-misses are flagged, never force-applied.
- **Partial payment:** shortfall tracked; period stays partially satisfied; no silent rounding.
- **Overpayment / extra principal:** spills to principal; re-derives payoff date.
- **Late fee:** a period satisfied more than 5 days after the due date assesses a 5% late fee as a separate owed line item (not folded into principal).
- **Reversed credit:** schedule re-derives as if the credit never applied.
- **Duplicate Plaid import:** deduped by transaction ID; re-syncs idempotent.
- **Late payment date:** recorded with the actual posted date.
- **Final payment:** trues up to the exact penny.

## 9. Scheduled Jobs (Vercel Cron)

- **Daily:** check upcoming/overdue loan payments, tax delinquency dates (−10 days), and insurance renewal dates → fire reminders; assess late fees past the 5-day grace; flag a policy `lapsed` if past expiration with no renewal proof.
- **Seasonal/royalty:** open a `RoyaltyPeriod` ahead of July 1 and Oct 1; remind the buyer to report; remind the seller when payment is due/late.
- **Plaid:** webhook-driven sync (push) with a daily polling fallback.

## 10. Notifications (Resend, email)

Payment received / missed; expense credit filed; royalty report filed; royalty payment due (Jul 1 / Oct 1); tax delinquency approaching; tax marked paid; insurance renewal approaching; insurance lapsed.

## 11. Testing

- **Unit:** amortization engine vs hand-verified tables (golden master), incl. extra-principal, partial, late, payoff rounding. Highest coverage here.
- **Integration:** settlement flows (cash + credit satisfying a period, overpayment spill, credit reversal re-derivation, late-fee assessment).
- **E2E (smoke):** buyer files credit → applies → seller reverses → balance restored; royalty report → 25% computed → matched against deposit.
- Financial core tested hard; UI lighter.

## 12. Open Items / To Confirm Later

- **Royalty reporting detail:** whether the buyer must itemize nights vs. just report a gross figure (spec assumes a gross figure + optional nights).
- **Insurance coverage amount:** the Deed of Trust covenant A.2 amount line reads "N/A" over "full insurable value" in the scan. Confirm the required coverage figure (or treat "full insurable value" as the standard and just verify a policy naming the seller as loss payee exists).
- *(Resolved by OCR of the closing package: payment is exactly $1,872.18; principal $151,000 at 8.5%; no escrow/impound; maturity 2036 with due-on-sale acceleration.)*

## 13. Cost

- Free-tier path: ~$2/month (essentially Plaid only, ~$20-30/yr); Postgres/Clerk/Blob/Resend/Cron fit free tiers at two-user scale.
- Fully paid path: ~$40/month (Vercel Pro $20 + Neon Launch ~$19 + Plaid).
- Vercel Hobby is non-commercial; treat the commercial-use call as the seller's judgment. App is portable off Vercel if needed.
