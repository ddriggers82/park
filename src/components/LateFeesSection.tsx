import { formatCents } from '../lib/money';
import { waiveLateFee } from '../app/late-fees-actions';
import type { LateFeeSummary } from '../app/late-fees-actions';
import { ConfirmSubmit } from './ConfirmSubmit';

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
    <section className="card">
      <h2>Late Fees</h2>
      <p style={{ margin: '0 0 16px', fontSize: '0.875rem' }}>
        Total late fees owed:{' '}
        <strong style={{ color: summary.totalOwedCents > 0 ? 'var(--danger)' : undefined }}>
          {formatCents(summary.totalOwedCents)}
        </strong>
        {lateCount > 0 && ` across ${lateCount} period${lateCount === 1 ? '' : 's'}`}
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col">Satisfied</th>
              <th scope="col" className="num">Fee</th>
              {isSeller && <th scope="col"><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {summary.periods.map((p) => {
              const statusLabel = p.isWaived
                ? 'Waived'
                : p.isLate
                ? 'Late'
                : p.satisfiedDate
                ? 'On time'
                : 'Pending';
              return (
                <tr
                  key={p.periodIndex}
                  className={p.isLate && !p.isWaived ? 'row-danger' : undefined}
                >
                  <td>{p.periodIndex}</td>
                  <td>{p.dueDate}</td>
                  <td>
                    {statusLabel}
                    {p.isLate && !p.isWaived && (
                      <span className="badge badge-late" aria-hidden="true">LATE</span>
                    )}
                    {p.isWaived && (
                      <span className="badge badge-open" aria-hidden="true">waived</span>
                    )}
                  </td>
                  <td>{p.satisfiedDate ?? <span aria-hidden="true">—</span>}</td>
                  <td className="num" style={{ color: p.lateFeeOwedCents > 0 ? 'var(--danger)' : undefined }}>
                    {p.lateFeeOwedCents > 0 ? formatCents(p.lateFeeOwedCents) : <span aria-hidden="true">—</span>}
                  </td>
                  {isSeller && (
                    <td>
                      {p.isLate && !p.isWaived && (
                        <form action={waiveLateFee}>
                          <input type="hidden" name="periodIndex" value={p.periodIndex} />
                          <ConfirmSubmit message="Waive this late fee?" variant="destructive">
                            Waive
                          </ConfirmSubmit>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
