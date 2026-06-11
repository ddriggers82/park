import { loadSchedule, submitPayment, submitCredit, reverseCredit, loadCredits } from './actions';
import { formatCents } from '../lib/money';
import { getCurrentRole } from '../lib/current-role';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const role = await getCurrentRole();
  const [schedule, credits] = await Promise.all([loadSchedule(), loadCredits()]);

  return (
    <main>
      <h1>Anchor River Note</h1>
      {!role && (
        <p style={{ color: '#a00' }}>
          Your account has no role assigned yet. Ask the seller to set it.
        </p>
      )}
      <p>
        Payoff: <strong>{schedule.payoffDate}</strong> · Payments:{' '}
        <strong>{schedule.periods}</strong> · Total interest:{' '}
        <strong>{formatCents(schedule.totalInterestCents)}</strong> · Final
        balance: <strong>{formatCents(schedule.finalBalanceCents)}</strong>
      </p>

      {role === 'seller' && (
        <form action={submitPayment} style={{ margin: '16px 0' }}>
          <fieldset style={{ display: 'inline-flex', gap: 8, alignItems: 'end' }}>
            <legend>Record a payment</legend>
            <label>
              Period
              <br />
              <input name="periodIndex" type="number" min="1" required />
            </label>
            <label>
              Amount ($)
              <br />
              <input name="amountDollars" type="number" step="0.01" min="0" required />
            </label>
            <label>
              Posted date
              <br />
              <input name="postedDate" type="date" required />
            </label>
            <button type="submit">Add</button>
          </fieldset>
        </form>
      )}

      <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'right', borderBottom: '2px solid #333' }}>
            <th style={{ textAlign: 'left' }}>#</th>
            <th style={{ textAlign: 'left' }}>Due</th>
            <th>Payment</th>
            <th>Interest</th>
            <th>Principal</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {schedule.rows.map((row) => (
            <tr
              key={row.index}
              style={{
                textAlign: 'right',
                borderBottom: '1px solid #ddd',
                background: row.isExtra ? '#eef9ee' : undefined,
              }}
            >
              <td style={{ textAlign: 'left' }}>{row.index}</td>
              <td style={{ textAlign: 'left' }}>{row.dueDate}</td>
              <td>{formatCents(row.appliedCents)}</td>
              <td>{formatCents(row.interestCents)}</td>
              <td>{formatCents(row.principalCents)}</td>
              <td>{formatCents(row.balanceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section style={{ marginTop: 32 }}>
        <h2>Expense credits</h2>
        <form action={submitCredit} encType="multipart/form-data" style={{ margin: '12px 0' }}>
          <fieldset style={{ display: 'inline-flex', gap: 8, alignItems: 'end' }}>
            <legend>Log a credit (applies to the current month)</legend>
            <label>Amount ($)<br /><input name="amountDollars" type="number" step="0.01" min="0" required /></label>
            <label>Description<br /><input name="description" type="text" required /></label>
            <label>Receipt<br /><input name="receipt" type="file" accept="image/*,application/pdf" /></label>
            <button type="submit">Add credit</button>
          </fieldset>
        </form>
        <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
              <th>Period</th><th>Amount</th><th>Description</th><th>Status</th><th>Receipt</th>
              {role === 'seller' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {credits.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #ddd', opacity: c.status === 'reversed' ? 0.5 : 1 }}>
                <td>{c.periodIndex}</td>
                <td>{formatCents(c.amountCents)}</td>
                <td>{c.description}</td>
                <td>{c.status}</td>
                <td>{c.receiptUrl ? <a href={c.receiptUrl} target="_blank" rel="noreferrer">view</a> : '—'}</td>
                {role === 'seller' && (
                  <td>
                    {c.status === 'applied' && (
                      <form action={reverseCredit}>
                        <input type="hidden" name="creditId" value={c.id} />
                        <button type="submit">Reverse</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
