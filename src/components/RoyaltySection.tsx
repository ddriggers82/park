import { formatCents } from '../lib/money';
import { royaltyDueDates } from '../lib/royalty';
import { reportRoyalty, confirmRoyaltyPaid } from '../app/royalty-actions';
import type { RoyaltyPeriodRow } from '../db/schema';
import type { Role } from '../lib/roles';

interface Props {
  role: Role | null;
  periods: RoyaltyPeriodRow[];
}

export function RoyaltySection({ role, periods }: Props) {
  // Build the two due-date options for the current year and next year so the
  // report form is useful across the full seasonal cycle.
  const currentYear = new Date().getFullYear();
  const dueDateOptions: { label: string; dueDate: string }[] = [];
  for (const yr of [currentYear - 1, currentYear, currentYear + 1]) {
    for (const dd of royaltyDueDates(yr)) {
      dueDateOptions.push({ label: `${yr} — due ${dd}`, dueDate: dd });
    }
  }

  return (
    <section style={{ marginTop: 32 }}>
      <h2>RV Site Royalties (§27d)</h2>
      <p style={{ fontSize: '0.875rem', color: '#555' }}>
        25% of gross Option Property income, due July 1 and October 1 each year.
        Independent of the loan.
      </p>

      {/* Report form -- available to buyer and seller */}
      {(role === 'buyer' || role === 'seller') && (
        <form action={reportRoyalty} style={{ margin: '12px 0' }}>
          <fieldset style={{ display: 'inline-flex', gap: 8, alignItems: 'end' }}>
            <legend>Report gross income for a period</legend>
            <label>
              Period
              <br />
              <select name="dueDate" required>
                {dueDateOptions.map(({ label, dueDate }) => (
                  <option key={dueDate} value={dueDate}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Gross income ($)
              <br />
              <input
                name="grossDollars"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="e.g. 12500.00"
              />
            </label>
            <button type="submit">Report income</button>
          </fieldset>
        </form>
      )}

      {/* Period list */}
      <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Due date</th>
            <th>Gross income</th>
            <th>25% owed</th>
            <th>Status</th>
            <th>Reported by</th>
            {role === 'seller' && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {periods.length === 0 && (
            <tr>
              <td colSpan={role === 'seller' ? 6 : 5} style={{ color: '#888' }}>
                No royalty periods on record yet.
              </td>
            </tr>
          )}
          {periods.map((p) => (
            <tr
              key={p.id}
              style={{
                borderBottom: '1px solid #ddd',
                background: p.status === 'paid' ? '#eef9ee' : undefined,
              }}
            >
              <td>{p.dueDate}</td>
              <td>
                {p.grossIncomeCents != null ? formatCents(p.grossIncomeCents) : '—'}
              </td>
              <td>
                {p.royaltyCents != null ? formatCents(p.royaltyCents) : '—'}
              </td>
              <td>
                <span
                  style={{
                    fontWeight: p.status === 'open' ? 'normal' : 'bold',
                    color:
                      p.status === 'paid'
                        ? '#256325'
                        : p.status === 'reported'
                          ? '#7a5c00'
                          : '#555',
                  }}
                >
                  {p.status}
                </span>
              </td>
              <td>{p.reportedBy ?? '—'}</td>
              {role === 'seller' && (
                <td>
                  {p.status === 'reported' && (
                    <form action={confirmRoyaltyPaid}>
                      <input type="hidden" name="periodId" value={p.id} />
                      <button type="submit">Mark paid</button>
                    </form>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
