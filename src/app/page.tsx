import { loadSchedule, submitPayment } from './actions';
import { formatCents } from '../lib/money';

export default async function Home() {
  const schedule = await loadSchedule();
  const balance =
    schedule.rows.length > 0
      ? schedule.rows[schedule.rows.length - 1].balanceCents
      : 0;

  return (
    <main>
      <h1>Anchor River Note</h1>
      <p>
        Payoff: <strong>{schedule.payoffDate}</strong> · Payments:{' '}
        <strong>{schedule.periods}</strong> · Total interest:{' '}
        <strong>{formatCents(schedule.totalInterestCents)}</strong> · Final
        balance: <strong>{formatCents(schedule.finalBalanceCents)}</strong>
      </p>

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
    </main>
  );
}
