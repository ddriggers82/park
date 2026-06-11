import { formatCents } from '../lib/money';
import { waiveLateFee } from '../app/late-fees-actions';
import type { LateFeeSummary } from '../app/late-fees-actions';

interface Props {
  summary: LateFeeSummary;
  isSeller: boolean;
}

export default function LateFeesSection({ summary, isSeller }: Props) {
  if (summary.periods.length === 0) {
    return null;
  }

  const lateCount = summary.periods.filter((p) => p.isLate && !p.isWaived).length;

  return (
    <section style={{ marginTop: 32 }}>
      <h2>Late Fees</h2>
      <p>
        Total late fees owed:{' '}
        <strong style={{ color: summary.totalOwedCents > 0 ? '#a00' : undefined }}>
          {formatCents(summary.totalOwedCents)}
        </strong>
        {lateCount > 0 && ` across ${lateCount} period${lateCount === 1 ? '' : 's'}`}
      </p>
      <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Period</th>
            <th>Due</th>
            <th>Status</th>
            <th>Satisfied</th>
            <th>Fee</th>
            {isSeller && <th></th>}
          </tr>
        </thead>
        <tbody>
          {summary.periods.map((p) => (
            <tr
              key={p.periodIndex}
              style={{
                borderBottom: '1px solid #ddd',
                background: p.isLate && !p.isWaived ? '#fff5f5' : undefined,
              }}
            >
              <td>{p.periodIndex}</td>
              <td>{p.dueDate}</td>
              <td>
                {p.isWaived
                  ? 'waived'
                  : p.isLate
                  ? 'LATE'
                  : p.satisfiedDate
                  ? 'on time'
                  : 'pending'}
              </td>
              <td>{p.satisfiedDate ?? '—'}</td>
              <td style={{ color: p.lateFeeOwedCents > 0 ? '#a00' : undefined }}>
                {p.lateFeeOwedCents > 0 ? formatCents(p.lateFeeOwedCents) : '—'}
              </td>
              {isSeller && (
                <td>
                  {p.isLate && !p.isWaived && (
                    <form action={waiveLateFee}>
                      <input type="hidden" name="periodIndex" value={p.periodIndex} />
                      <button type="submit">Waive</button>
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
