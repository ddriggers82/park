import { loadSchedule, submitPayment, submitCredit, reverseCredit, loadCredits } from './actions';
import { formatCents } from '../lib/money';
import { getCurrentRole } from '../lib/current-role';
import LateFeesSection from '../components/LateFeesSection';
import { RoyaltySection } from '../components/RoyaltySection';
import { ComplianceSection } from '../components/ComplianceSection';
import { PlaidSection } from '../components/PlaidSection';
import { loadLateFeeSummary } from './late-fees-actions';
import { loadRoyaltyPeriods } from './royalty-actions';
import { loadTaxObligations, loadInsurancePolicies } from './compliance-actions';
import { SubmitButton } from '../components/SubmitButton';
import { ConfirmSubmit } from '../components/ConfirmSubmit';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard | Park Payments' };

export default async function Home() {
  const role = await getCurrentRole();
  const todayISO = new Date().toISOString().slice(0, 10);
  const [schedule, credits, lateFeeSummary, royaltyPeriods, taxObligations, insurancePolicies] =
    await Promise.all([
      loadSchedule(),
      loadCredits(),
      loadLateFeeSummary(todayISO),
      loadRoyaltyPeriods(),
      loadTaxObligations(),
      loadInsurancePolicies(),
    ]);

  return (
    <main>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 700, margin: '0 0 20px', letterSpacing: '-0.01em' }}>
        Anchor River Note
      </h1>

      {!role && (
        <p className="alert-warning">
          Your account has no role assigned yet. Ask the seller to set it.
        </p>
      )}

      {/* Summary stat row */}
      <div className="card">
        <h2>Summary</h2>
        <dl className="stat-row">
          <div className="stat-item">
            <dt className="stat-label">Payoff date</dt>
            <dd className="stat-value" style={{ margin: 0 }}>{schedule.payoffDate}</dd>
          </div>
          <div className="stat-item">
            <dt className="stat-label">Payments</dt>
            <dd className="stat-value" style={{ margin: 0 }}>{schedule.periods}</dd>
          </div>
          <div className="stat-item">
            <dt className="stat-label">Total interest</dt>
            <dd className="stat-value" style={{ margin: 0 }}>{formatCents(schedule.totalInterestCents)}</dd>
          </div>
          <div className="stat-item">
            <dt className="stat-label">Final balance</dt>
            <dd className="stat-value stat-value--prominent" style={{ margin: 0 }}>{formatCents(schedule.finalBalanceCents)}</dd>
          </div>
        </dl>
      </div>

      {/* Record a payment (seller only) */}
      {role === 'seller' && (
        <div className="card">
          <h2>Record a payment</h2>
          <form action={submitPayment}>
            <fieldset>
              <legend>Payment details</legend>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="periodIndex">Period</label>
                  <input id="periodIndex" name="periodIndex" type="number" min="1" required style={{ width: 80 }} />
                </div>
                <div className="form-field">
                  <label htmlFor="amountDollars">Amount ($)</label>
                  <input id="amountDollars" name="amountDollars" type="number" step="0.01" min="0" required style={{ width: 120 }} />
                </div>
                <div className="form-field">
                  <label htmlFor="postedDate">Posted date</label>
                  <input id="postedDate" name="postedDate" type="date" required max={todayISO} style={{ width: 150 }} />
                </div>
                <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                  <SubmitButton variant="primary">Add</SubmitButton>
                </div>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      {/* Expense credits */}
      <section className="card">
        <h2>Expense credits</h2>
        <form action={submitCredit} encType="multipart/form-data" style={{ marginBottom: 16 }}>
          <fieldset>
            <legend>Log a credit (applies to the current month)</legend>
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="creditAmount">Amount ($)</label>
                <input id="creditAmount" name="amountDollars" type="number" step="0.01" min="0" required style={{ width: 120 }} />
              </div>
              <div className="form-field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="creditDesc">Description</label>
                <input id="creditDesc" name="description" type="text" required />
              </div>
              <div className="form-field">
                <label htmlFor="creditReceipt">Receipt</label>
                <input id="creditReceipt" name="receipt" type="file" accept="image/*,application/pdf" />
              </div>
              <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                <SubmitButton variant="primary">Add credit</SubmitButton>
              </div>
            </div>
          </fieldset>
        </form>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Description</th>
                <th scope="col">Status</th>
                <th scope="col">Receipt</th>
                {role === 'seller' && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {credits.length === 0 && (
                <tr>
                  <td colSpan={role === 'seller' ? 6 : 5} style={{ color: 'var(--sub)', fontStyle: 'italic' }}>
                    No expense credits recorded yet.
                  </td>
                </tr>
              )}
              {credits.map((c) => (
                <tr key={c.id}>
                  <td>{c.periodIndex}</td>
                  <td className="num">{formatCents(c.amountCents)}</td>
                  <td>
                    {c.status === 'reversed' ? (
                      <span className="status-reversed">{c.description}</span>
                    ) : (
                      c.description
                    )}
                  </td>
                  <td>{c.status}</td>
                  <td>
                    {c.receiptUrl ? (
                      <a
                        href={c.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View receipt for credit: ${c.description} (opens in new tab)`}
                      >
                        view
                      </a>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                  {role === 'seller' && (
                    <td>
                      {c.status === 'applied' && (
                        <form action={reverseCredit}>
                          <input type="hidden" name="creditId" value={c.id} />
                          <ConfirmSubmit message="Reverse this credit?" variant="destructive">
                            Reverse
                          </ConfirmSubmit>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <LateFeesSection summary={lateFeeSummary} isSeller={role === 'seller'} />
      <RoyaltySection role={role} periods={royaltyPeriods} />
      <ComplianceSection
        taxObligations={taxObligations}
        insurancePolicies={insurancePolicies}
        role={role}
        todayISO={todayISO}
      />
      {role === 'seller' && <PlaidSection />}

      {/* Amortization schedule - collapsed by default, placed below actionable content */}
      <section className="card">
        <h2>Amortization schedule</h2>
        <details className="schedule-details">
          <summary>
            Amortization schedule ({schedule.rows.length} periods)
          </summary>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="num">Payment</th>
                  <th scope="col" className="num">Interest</th>
                  <th scope="col" className="num">Principal</th>
                  <th scope="col" className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((row) => (
                  <tr key={row.index} className={row.isExtra ? 'row-extra' : undefined}>
                    <td>{row.index}</td>
                    <td>{row.dueDate}</td>
                    <td className="num">
                      {formatCents(row.appliedCents)}
                      {row.isExtra && <span className="badge badge-extra">Extra</span>}
                    </td>
                    <td className="num">{formatCents(row.interestCents)}</td>
                    <td className="num">{formatCents(row.principalCents)}</td>
                    <td className="num">{formatCents(row.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </main>
  );
}
