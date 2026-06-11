import type { TaxObligationRow, InsurancePolicyRow } from '../db/schema';
import type { Role } from '../lib/roles';
import {
  createTaxObligation,
  submitTaxProof,
  createInsurancePolicy,
} from '../app/compliance-actions';
import { reminderTriggerDate, isLapsed } from '../lib/tax-reminder';
import { formatCents } from '../lib/money';
import { SubmitButton } from './SubmitButton';

interface Props {
  taxObligations: TaxObligationRow[];
  insurancePolicies: InsurancePolicyRow[];
  role: Role | null;
  todayISO: string;
}

export function ComplianceSection({
  taxObligations,
  insurancePolicies,
  role,
  todayISO,
}: Props) {
  return (
    <div>
      {/* Property Tax Obligations */}
      <section className="card">
        <h2>Property Tax Obligations</h2>
        <p className="card-description">
          Kenai Peninsula Borough — buyer must pay at least 10 days before delinquency (Deed of
          Trust §A.4). Status is auto-verified weekly from the borough site; proof upload below is
          an optional manual fallback.
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Parcel group</th>
                <th scope="col">Due date</th>
                <th scope="col">Delinquency date</th>
                <th scope="col">Reminder trigger</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Last checked</th>
                <th scope="col">Proof</th>
                {(role === 'buyer' || role === 'seller') && <th scope="col">Action (optional)</th>}
              </tr>
            </thead>
            <tbody>
              {taxObligations.map((t) => (
                <tr
                  key={t.id}
                  className={t.status === 'paid' ? 'row-paid' : undefined}
                >
                  <td>
                    {t.parcelUrl ? (
                      <>
                        {t.parcelGroup}
                        {t.parcelPin && (
                          <span style={{ fontSize: '0.75rem', marginLeft: 4, color: 'var(--sub)' }}>
                            PIN {t.parcelPin}
                          </span>
                        )}
                        {' '}
                        <a
                          href={t.parcelUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View ${t.parcelGroup} on the Kenai Borough tax site (opens in new tab)`}
                          style={{ fontSize: '0.75rem' }}
                        >
                          Borough page
                        </a>
                      </>
                    ) : (
                      <>
                        {t.parcelGroup}
                        {t.parcelPin && (
                          <span style={{ fontSize: '0.75rem', marginLeft: 4, color: 'var(--sub)' }}>
                            PIN {t.parcelPin}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>{t.dueDateISO}</td>
                  <td>{t.delinquencyDateISO}</td>
                  <td>{reminderTriggerDate(t.delinquencyDateISO)}</td>
                  <td className="num">
                    {t.amountCents != null ? formatCents(t.amountCents) : <span aria-hidden="true">—</span>}
                  </td>
                  <td>
                    <strong>{t.status === 'paid' ? 'Paid' : 'Open'}</strong>
                    {t.paidBy && (
                      <span style={{ fontSize: '0.75rem', marginLeft: 4, color: 'var(--sub)' }}>
                        (by {t.paidBy})
                      </span>
                    )}
                  </td>
                  <td>
                    {t.lastCheckedAt
                      ? (t.lastCheckedAt instanceof Date
                          ? t.lastCheckedAt
                          : new Date(t.lastCheckedAt)
                        ).toISOString().slice(0, 10)
                      : <span style={{ color: 'var(--sub)', fontStyle: 'italic' }}>not yet</span>}
                  </td>
                  <td>
                    {t.proofUrl ? (
                      <a
                        href={t.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View tax payment proof for ${t.parcelGroup} due ${t.dueDateISO} (opens in new tab)`}
                      >
                        view
                      </a>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                  {(role === 'buyer' || role === 'seller') && (
                    <td>
                      {t.status === 'open' && (
                        <form action={submitTaxProof} encType="multipart/form-data">
                          <input type="hidden" name="obligationId" value={t.id} />
                          <div className="form-row" style={{ gap: 6 }}>
                            <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span>Proof</span>
                              <input
                                name="proof"
                                type="file"
                                accept="image/*,application/pdf"
                                style={{ fontSize: '0.8rem' }}
                              />
                            </label>
                            <SubmitButton variant="secondary">Mark paid (manual)</SubmitButton>
                          </div>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {taxObligations.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--sub)', fontStyle: 'italic', padding: 12 }}>
                    No tax obligations recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {role === 'seller' && (
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', color: 'var(--accent)' }}>
              + Add tax obligation
            </summary>
            <form action={createTaxObligation} style={{ marginTop: 12 }}>
              <fieldset>
                <legend>New tax obligation (seller only)</legend>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="taxParcelGroup">Parcel group</label>
                    <input id="taxParcelGroup" name="parcelGroup" type="text" defaultValue="Parcels A & B" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="taxDueDate">Due date</label>
                    <input id="taxDueDate" name="dueDateISO" type="date" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="taxDelinquencyDate">Delinquency date</label>
                    <input id="taxDelinquencyDate" name="delinquencyDateISO" type="date" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="taxParcelPin">Parcel PIN (optional)</label>
                    <input id="taxParcelPin" name="parcelPin" type="text" />
                  </div>
                  <div className="form-field">
                    <label htmlFor="taxParcelUrl">Borough page URL (optional)</label>
                    <input id="taxParcelUrl" name="parcelUrl" type="url" style={{ width: 280 }} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="taxAmountDollars">Amount ($, optional)</label>
                    <input id="taxAmountDollars" name="amountDollars" type="number" step="0.01" min="0" style={{ width: 120 }} />
                  </div>
                  <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                    <SubmitButton variant="primary">Add</SubmitButton>
                  </div>
                </div>
              </fieldset>
            </form>
          </details>
        )}
      </section>

      {/* Hazard Insurance Policies */}
      <section className="card">
        <h2>Hazard Insurance</h2>
        <p className="card-description">
          Fire / extended-coverage required; seller must be named loss payee (Deed of Trust §A.2).
          <br />
          <em>Provided by the buyer; seller named as loss payee.</em>
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Carrier</th>
                <th scope="col">Policy #</th>
                <th scope="col" className="num">Coverage</th>
                <th scope="col">Effective</th>
                <th scope="col">Expires</th>
                <th scope="col">Loss payee</th>
                <th scope="col">Status</th>
                <th scope="col">Declarations</th>
              </tr>
            </thead>
            <tbody>
              {insurancePolicies.map((p) => {
                const lapsed = isLapsed(p.expirationDateISO, todayISO);
                return (
                  <tr
                    key={p.id}
                    className={lapsed ? 'row-danger' : undefined}
                  >
                    <td>{p.carrier}</td>
                    <td>{p.policyNumber}</td>
                    <td className="num">{formatCents(p.coverageCents)}</td>
                    <td>{p.effectiveDateISO}</td>
                    <td>
                      {p.expirationDateISO}
                      {lapsed && (
                        <span className="badge badge-lapsed" style={{ marginLeft: 4 }}>
                          LAPSED
                        </span>
                      )}
                    </td>
                    <td>{p.lossPayeeConfirmed === 1 ? 'Confirmed' : 'Not confirmed'}</td>
                    <td>{lapsed ? 'Lapsed' : 'Active'}</td>
                    <td>
                      {p.declarationsUrl ? (
                        <a
                          href={p.declarationsUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View declarations for ${p.carrier} policy ${p.policyNumber} (opens in new tab)`}
                        >
                          view
                        </a>
                      ) : (
                        <span aria-hidden="true">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {insurancePolicies.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--sub)', fontStyle: 'italic', padding: 12 }}>
                    No insurance policies recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(role === 'buyer' || role === 'seller') && (
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', color: 'var(--accent)' }}>
              + Add insurance policy
            </summary>
            <form
              action={createInsurancePolicy}
              encType="multipart/form-data"
              style={{ marginTop: 12 }}
            >
              <fieldset>
                <legend>New insurance policy (buyer or seller)</legend>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="insCarrier">Carrier</label>
                    <input id="insCarrier" name="carrier" type="text" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="insPolicyNum">Policy #</label>
                    <input id="insPolicyNum" name="policyNumber" type="text" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="insCoverage">Coverage ($)</label>
                    <input id="insCoverage" name="coverageDollars" type="number" step="0.01" min="0" required style={{ width: 120 }} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="insEffective">Effective date</label>
                    <input id="insEffective" name="effectiveDateISO" type="date" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="insExpiration">Expiration date</label>
                    <input id="insExpiration" name="expirationDateISO" type="date" required />
                  </div>
                  <div className="form-field" style={{ justifyContent: 'flex-end', paddingBottom: 2 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <input name="lossPayeeConfirmed" type="checkbox" value="true" />
                      Loss payee confirmed
                    </label>
                  </div>
                  <div className="form-field">
                    <label htmlFor="insDeclarations">Declarations page</label>
                    <input id="insDeclarations" name="declarations" type="file" accept="image/*,application/pdf" />
                  </div>
                  <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                    <SubmitButton variant="primary">Add policy</SubmitButton>
                  </div>
                </div>
              </fieldset>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
