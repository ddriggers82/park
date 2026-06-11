import type { UnmatchedDeposit } from '../app/plaid-actions';
import { formatCents } from '../lib/money';

interface Props {
  deposits: UnmatchedDeposit[];
}

export function PlaidUnmatched({ deposits }: Props) {
  if (deposits.length === 0) return null;
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Unmatched deposits</h2>
      <p style={{ margin: '0 0 12px', fontSize: '0.875rem', color: 'var(--warn)' }}>
        These incoming deposits could not be automatically matched to a loan period.
        Record them manually if they represent a loan payment, or ignore them if unrelated.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col">Description</th>
              <th scope="col">Plaid Transaction ID</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((d) => (
              <tr key={d.transactionId}>
                <td>{d.date}</td>
                <td className="num">{formatCents(d.amountCents)}</td>
                <td>{d.rawName}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{d.transactionId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
