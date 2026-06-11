import type { TaxObligationRow, InsurancePolicyRow } from '../db/schema';
import type { Role } from '../lib/roles';
import {
  createTaxObligation,
  submitTaxProof,
  createInsurancePolicy,
} from '../app/compliance-actions';
import { reminderTriggerDate, isLapsed } from '../lib/tax-reminder';
import { formatCents } from '../lib/money';

interface Props {
  taxObligations: TaxObligationRow[];
  insurancePolicies: InsurancePolicyRow[];
  role: Role | null;
  todayISO: string; // injected from the parent server component
}

export function ComplianceSection({
  taxObligations,
  insurancePolicies,
  role,
  todayISO,
}: Props) {
  return (
    <div style={{ marginTop: 40 }}>
      {/* ------------------------------------------------------------------ */}
      {/* Property Tax Obligations                                            */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2>Property Tax Obligations</h2>
        <p style={{ fontSize: '0.875rem', color: '#666' }}>
          Kenai Peninsula Borough — buyer must pay at least 10 days before delinquency (Deed of
          Trust §A.4).
        </p>

        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
              <th>Parcel group</th>
              <th>Due date</th>
              <th>Delinquency date</th>
              <th>Reminder trigger</th>
              <th>Status</th>
              <th>Proof</th>
              {(role === 'buyer' || role === 'seller') && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {taxObligations.map((t) => (
              <tr
                key={t.id}
                style={{
                  borderBottom: '1px solid #ddd',
                  background: t.status === 'paid' ? '#eef9ee' : undefined,
                }}
              >
                <td>{t.parcelGroup}</td>
                <td>{t.dueDateISO}</td>
                <td>{t.delinquencyDateISO}</td>
                <td>{reminderTriggerDate(t.delinquencyDateISO)}</td>
                <td>
                  <strong>{t.status === 'paid' ? 'Paid' : 'Open'}</strong>
                  {t.paidBy && (
                    <span style={{ fontSize: '0.75rem', marginLeft: 4, color: '#555' }}>
                      (by {t.paidBy})
                    </span>
                  )}
                </td>
                <td>
                  {t.proofUrl ? (
                    <a href={t.proofUrl} target="_blank" rel="noreferrer">
                      view
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                {(role === 'buyer' || role === 'seller') && (
                  <td>
                    {t.status === 'open' && (
                      <form action={submitTaxProof} encType="multipart/form-data">
                        <input type="hidden" name="obligationId" value={t.id} />
                        <label style={{ fontSize: '0.8rem' }}>
                          Proof&nbsp;
                          <input
                            name="proof"
                            type="file"
                            accept="image/*,application/pdf"
                            style={{ fontSize: '0.8rem' }}
                          />
                        </label>
                        &nbsp;
                        <button type="submit" style={{ fontSize: '0.8rem' }}>
                          Mark paid
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {taxObligations.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: '#888', padding: 12 }}>
                  No tax obligations recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {role === 'seller' && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              + Add tax obligation
            </summary>
            <form action={createTaxObligation} style={{ marginTop: 8 }}>
              <fieldset style={{ display: 'inline-flex', gap: 8, alignItems: 'end' }}>
                <legend>New tax obligation (seller only)</legend>
                <label>
                  Parcel group
                  <br />
                  <input name="parcelGroup" type="text" defaultValue="Parcels A & B" required />
                </label>
                <label>
                  Due date
                  <br />
                  <input name="dueDateISO" type="date" required />
                </label>
                <label>
                  Delinquency date
                  <br />
                  <input name="delinquencyDateISO" type="date" required />
                </label>
                <button type="submit">Add</button>
              </fieldset>
            </form>
          </details>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Hazard Insurance Policies                                           */}
      {/* ------------------------------------------------------------------ */}
      <section style={{ marginTop: 32 }}>
        <h2>Hazard Insurance</h2>
        <p style={{ fontSize: '0.875rem', color: '#666' }}>
          Fire / extended-coverage required; seller must be named loss payee (Deed of Trust §A.2).
        </p>

        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
              <th>Carrier</th>
              <th>Policy #</th>
              <th>Coverage</th>
              <th>Effective</th>
              <th>Expires</th>
              <th>Loss payee</th>
              <th>Status</th>
              <th>Declarations</th>
            </tr>
          </thead>
          <tbody>
            {insurancePolicies.map((p) => {
              const lapsed = isLapsed(p.expirationDateISO, todayISO);
              return (
                <tr
                  key={p.id}
                  style={{
                    borderBottom: '1px solid #ddd',
                    background: lapsed ? '#fef2f2' : undefined,
                  }}
                >
                  <td>{p.carrier}</td>
                  <td>{p.policyNumber}</td>
                  <td>{formatCents(p.coverageCents)}</td>
                  <td>{p.effectiveDateISO}</td>
                  <td>
                    {p.expirationDateISO}
                    {lapsed && (
                      <span style={{ color: '#a00', marginLeft: 4, fontWeight: 'bold' }}>
                        LAPSED
                      </span>
                    )}
                  </td>
                  <td>{p.lossPayeeConfirmed === 1 ? 'Confirmed' : 'Not confirmed'}</td>
                  <td>{lapsed ? 'Lapsed' : 'Active'}</td>
                  <td>
                    {p.declarationsUrl ? (
                      <a href={p.declarationsUrl} target="_blank" rel="noreferrer">
                        view
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
            {insurancePolicies.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: '#888', padding: 12 }}>
                  No insurance policies recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {role === 'seller' && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              + Add insurance policy
            </summary>
            <form
              action={createInsurancePolicy}
              encType="multipart/form-data"
              style={{ marginTop: 8 }}
            >
              <fieldset style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
                <legend>New insurance policy (seller only)</legend>
                <label>
                  Carrier
                  <br />
                  <input name="carrier" type="text" required />
                </label>
                <label>
                  Policy #
                  <br />
                  <input name="policyNumber" type="text" required />
                </label>
                <label>
                  Coverage ($)
                  <br />
                  <input name="coverageDollars" type="number" step="0.01" min="0" required />
                </label>
                <label>
                  Effective date
                  <br />
                  <input name="effectiveDateISO" type="date" required />
                </label>
                <label>
                  Expiration date
                  <br />
                  <input name="expirationDateISO" type="date" required />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input name="lossPayeeConfirmed" type="checkbox" value="true" />
                  Loss payee confirmed
                </label>
                <label>
                  Declarations page
                  <br />
                  <input name="declarations" type="file" accept="image/*,application/pdf" />
                </label>
                <button type="submit">Add policy</button>
              </fieldset>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
