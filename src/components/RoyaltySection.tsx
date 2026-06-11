import { formatCents } from '../lib/money';
import { royaltyDueDates } from '../lib/royalty';
import { reportRoyalty, confirmRoyaltyPaid } from '../app/royalty-actions';
import type { RoyaltyPeriodRow } from '../db/schema';
import type { Role } from '../lib/roles';
import { SubmitButton } from './SubmitButton';

interface Props {
  role: Role | null;
  periods: RoyaltyPeriodRow[];
}

export function RoyaltySection({ role, periods }: Props) {
  const currentYear = new Date().getFullYear();
  const dueDateOptions: { label: string; dueDate: string }[] = [];
  for (const yr of [currentYear - 1, currentYear, currentYear + 1]) {
    for (const dd of royaltyDueDates(yr)) {
      dueDateOptions.push({ label: `${yr} (due ${dd})`, dueDate: dd });
    }
  }

  return (
    <section className="card">
      <h2>RV Site Royalties (§27d)</h2>
      <p className="card-description">
        25% of gross Option Property income, due July 1 and October 1 each year.
        Independent of the loan.
      </p>

      {(role === 'buyer' || role === 'seller') && (
        <form action={reportRoyalty} style={{ marginBottom: 16 }}>
          <fieldset>
            <legend>Report gross income for a period</legend>
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="royaltyDueDate">Period</label>
                <select id="royaltyDueDate" name="dueDate" required>
                  {dueDateOptions.map(({ label, dueDate }) => (
                    <option key={dueDate} value={dueDate}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="royaltyGross">Gross income ($)</label>
                <input
                  id="royaltyGross"
                  name="grossDollars"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="e.g. 12500.00"
                  style={{ width: 150 }}
                />
              </div>
              <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                <SubmitButton variant="primary">Report income</SubmitButton>
              </div>
            </div>
          </fieldset>
        </form>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Due date</th>
              <th scope="col" className="num">Gross income</th>
              <th scope="col" className="num">25% owed</th>
              <th scope="col">Status</th>
              <th scope="col">Reported by</th>
              {role === 'seller' && <th scope="col">Action</th>}
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 && (
              <tr>
                <td colSpan={role === 'seller' ? 6 : 5} style={{ color: 'var(--sub)', fontStyle: 'italic' }}>
                  No royalty periods on record yet.
                </td>
              </tr>
            )}
            {periods.map((p) => (
              <tr key={p.id} className={p.status === 'paid' ? 'row-paid' : undefined}>
                <td>{p.dueDate}</td>
                <td className="num">
                  {p.grossIncomeCents != null ? formatCents(p.grossIncomeCents) : <span aria-hidden="true">—</span>}
                </td>
                <td className="num">
                  {p.royaltyCents != null ? formatCents(p.royaltyCents) : <span aria-hidden="true">—</span>}
                </td>
                <td>
                  {p.status === 'paid' && <span className="badge badge-paid">Paid</span>}
                  {p.status === 'reported' && <span className="badge badge-reported">Reported</span>}
                  {p.status === 'open' && <span className="badge badge-open">Open</span>}
                  {!['paid', 'reported', 'open'].includes(p.status) && p.status}
                </td>
                <td>{p.reportedBy ?? <span aria-hidden="true">—</span>}</td>
                {role === 'seller' && (
                  <td>
                    {p.status === 'reported' && (
                      <form action={confirmRoyaltyPaid}>
                        <input type="hidden" name="periodId" value={p.id} />
                        <SubmitButton variant="secondary">Mark paid</SubmitButton>
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
  );
}
