import 'server-only';
import ExcelJS from 'exceljs';
import { centsToDollars } from './money';
import { generateSchedule } from './amortization';
import {
  ensureAnchorRiverLoan,
  getLoanTerms,
  getAppliedPayments,
  listPayments,
  listExpenseCredits,
} from '../db/repository';
import { loadLateFeeSummary } from '../app/late-fees-actions';
import { listPeriods } from '../db/royalty-repository';
import { listTaxObligations, listInsurancePolicies } from '../db/compliance-repository';

const MONEY_FMT = '$#,##0.00';

// Render a timestamp value (Date | null) as a plain YYYY-MM-DD string or empty.
function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return '';
  const iso = typeof value === 'string' ? value : value.toISOString();
  return iso.slice(0, 10);
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * Build the full multi-sheet workbook for the Anchor River note and return it as
 * a Buffer. Authorization is enforced by the caller (the export route); this
 * function only gathers and formats data.
 */
export async function buildExportWorkbook(todayISO: string): Promise<Uint8Array<ArrayBuffer>> {
  const loanId = await ensureAnchorRiverLoan();
  const terms = await getLoanTerms(loanId);
  const [applied, paymentRows, credits, lateFees, royalties, taxes, policies] = await Promise.all([
    getAppliedPayments(loanId),
    listPayments(loanId),
    listExpenseCredits(loanId),
    loadLateFeeSummary(todayISO),
    listPeriods(),
    listTaxObligations(),
    listInsurancePolicies(),
  ]);
  const schedule = generateSchedule(terms, applied);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Park Payments';
  wb.created = new Date(todayISO);

  // --- Sheet 1: Summary ---
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 24 },
  ];
  const money = (cents: number | null) => (cents == null ? '' : centsToDollars(cents));
  const summaryRows: Array<[string, string | number]> = [
    ['Original principal', centsToDollars(terms.principalCents)],
    ['Annual rate (%)', terms.annualRatePct],
    ['Term (months)', terms.termMonths],
    ['Scheduled payment', centsToDollars(terms.paymentCents)],
    ['First payment date', terms.firstPaymentDate],
    ['Payoff date', schedule.payoffDate],
    ['Payoff amount (current balance)', centsToDollars(schedule.currentBalanceCents)],
    ['Payments remaining', schedule.paymentsRemaining],
    ['Last payment date', schedule.lastPaymentDate ?? ''],
    ['Last payment amount', money(schedule.lastPaymentCents)],
    ['Total interest (scheduled)', centsToDollars(schedule.totalInterestCents)],
    ['Late fees currently owed', centsToDollars(lateFees.totalOwedCents)],
    ['Report generated', todayISO],
  ];
  summaryRows.forEach(([metric, value]) => summary.addRow({ metric, value }));
  // Currency-format the value cells that are dollar amounts.
  [2, 5, 7, 11, 12, 13].forEach((r) => {
    summary.getCell(`B${r}`).numFmt = MONEY_FMT;
  });
  styleHeader(summary);

  // --- Sheet 2: Amortization schedule ---
  const amort = wb.addWorksheet('Amortization Schedule');
  amort.columns = [
    { header: 'Period', key: 'index', width: 10 },
    { header: 'Due date', key: 'dueDate', width: 14 },
    { header: 'Payment', key: 'payment', width: 14, style: { numFmt: MONEY_FMT } },
    { header: 'Interest', key: 'interest', width: 14, style: { numFmt: MONEY_FMT } },
    { header: 'Principal', key: 'principal', width: 14, style: { numFmt: MONEY_FMT } },
    { header: 'Balance', key: 'balance', width: 16, style: { numFmt: MONEY_FMT } },
    { header: 'Extra payment?', key: 'extra', width: 14 },
  ];
  schedule.rows.forEach((r) =>
    amort.addRow({
      index: r.index,
      dueDate: r.dueDate,
      payment: centsToDollars(r.appliedCents),
      interest: centsToDollars(r.interestCents),
      principal: centsToDollars(r.principalCents),
      balance: centsToDollars(r.balanceCents),
      extra: r.isExtra ? 'Yes' : '',
    }),
  );
  styleHeader(amort);

  // --- Sheet 3: Payments & credits ---
  const pay = wb.addWorksheet('Payments & Credits');
  pay.addRow(['Payments (bank deposits & manual entries)']).font = { bold: true };
  pay.addRow(['Period', 'Posted date', 'Amount', 'Source', 'Plaid transaction id']).font = {
    bold: true,
  };
  paymentRows.forEach((p) => {
    const row = pay.addRow([
      p.periodIndex,
      dateOnly(p.postedDate),
      centsToDollars(p.amountCents),
      p.source,
      p.plaidTxnId ?? '',
    ]);
    row.getCell(3).numFmt = MONEY_FMT;
  });
  pay.addRow([]);
  pay.addRow(['Expense credits']).font = { bold: true };
  pay.addRow(['Period', 'Amount', 'Description', 'Status', 'Logged', 'Has receipt']).font = {
    bold: true,
  };
  credits.forEach((c) => {
    const row = pay.addRow([
      c.periodIndex,
      centsToDollars(c.amountCents),
      c.description,
      c.status,
      dateOnly(c.createdAt),
      c.receiptUrl ? 'Yes' : '',
    ]);
    row.getCell(2).numFmt = MONEY_FMT;
  });
  pay.getColumn(1).width = 10;
  pay.getColumn(2).width = 16;
  pay.getColumn(3).width = 30;
  pay.getColumn(4).width = 12;
  pay.getColumn(5).width = 14;

  // --- Sheet 4: Compliance (late fees, royalties, taxes, insurance) ---
  const comp = wb.addWorksheet('Compliance');

  comp.addRow(['Late fees by period']).font = { bold: true };
  comp.addRow(['Period', 'Due date', 'Late?', 'Fee owed', 'Satisfied date', 'Waived?']).font = {
    bold: true,
  };
  lateFees.periods.forEach((p) => {
    const row = comp.addRow([
      p.periodIndex,
      p.dueDate,
      p.isLate ? 'Yes' : '',
      centsToDollars(p.lateFeeOwedCents),
      p.satisfiedDate ?? '',
      p.isWaived ? 'Yes' : '',
    ]);
    row.getCell(4).numFmt = MONEY_FMT;
  });

  comp.addRow([]);
  comp.addRow(['RV site royalties']).font = { bold: true };
  comp.addRow(['Year', 'Due date', 'Gross income', 'Royalty owed', 'Status', 'Reported', 'Paid']).font =
    { bold: true };
  royalties.forEach((r) => {
    const row = comp.addRow([
      r.year,
      dateOnly(r.dueDate),
      r.grossIncomeCents == null ? '' : centsToDollars(r.grossIncomeCents),
      r.royaltyCents == null ? '' : centsToDollars(r.royaltyCents),
      r.status,
      dateOnly(r.reportedAt),
      dateOnly(r.paidAt),
    ]);
    row.getCell(3).numFmt = MONEY_FMT;
    row.getCell(4).numFmt = MONEY_FMT;
  });

  comp.addRow([]);
  comp.addRow(['Property tax obligations']).font = { bold: true };
  comp.addRow(['Parcel group', 'Parcel PIN', 'Due date', 'Delinquency date', 'Amount', 'Status', 'Paid date']).font =
    { bold: true };
  taxes.forEach((t) => {
    const row = comp.addRow([
      t.parcelGroup,
      t.parcelPin ?? '',
      dateOnly(t.dueDateISO),
      dateOnly(t.delinquencyDateISO),
      t.amountCents == null ? '' : centsToDollars(t.amountCents),
      t.status,
      dateOnly(t.paidAt),
    ]);
    row.getCell(5).numFmt = MONEY_FMT;
  });

  comp.addRow([]);
  comp.addRow(['Hazard insurance policies']).font = { bold: true };
  comp.addRow(['Carrier', 'Policy number', 'Coverage', 'Effective', 'Expires', 'Loss payee', 'Status']).font =
    { bold: true };
  policies.forEach((p) => {
    const row = comp.addRow([
      p.carrier,
      p.policyNumber,
      centsToDollars(p.coverageCents),
      dateOnly(p.effectiveDateISO),
      dateOnly(p.expirationDateISO),
      p.lossPayeeConfirmed ? 'Confirmed' : 'No',
      p.status,
    ]);
    row.getCell(3).numFmt = MONEY_FMT;
  });

  comp.columns.forEach((c) => {
    c.width = Math.max(c.width ?? 10, 16);
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}
