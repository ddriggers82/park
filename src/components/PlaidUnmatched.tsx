import type { UnmatchedDeposit } from '../app/plaid-actions';
import { formatCents } from '../lib/money';

interface Props {
  deposits: UnmatchedDeposit[];
}

export function PlaidUnmatched({ deposits }: Props) {
  if (deposits.length === 0) return null;
  return (
    <section style={{ marginTop: 24 }}>
      <h3>Unmatched deposits</h3>
      <p style={{ color: '#a60' }}>
        These incoming deposits could not be automatically matched to a loan period.
        Record them manually if they represent a loan payment, or ignore them if unrelated.
      </p>
      <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Date</th>
            <th>Amount</th>
            <th>Description</th>
            <th>Plaid Transaction ID</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((d) => (
            <tr key={d.transactionId} style={{ borderBottom: '1px solid #ddd' }}>
              <td>{d.date}</td>
              <td>{formatCents(d.amountCents)}</td>
              <td>{d.rawName}</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{d.transactionId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
