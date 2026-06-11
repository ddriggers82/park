import type { Cents } from './money';

// A single dated settlement amount that applies to one loan period.
export interface DatedSettlement {
  amountCents: Cents;
  postedDate: string; // 'YYYY-MM-DD'
}

export interface LateFeeResult {
  isLate: boolean;
  lateFeeOwedCents: Cents;   // 0 when not late or already waived (waiver applied upstream)
  satisfiedDate: string | null; // ISO date the period was fully satisfied, or null if still open
}

// Calendar-day difference: how many full days after `from` is `to`.
// Returns a positive integer when `to` is after `from`, 0 when equal, negative otherwise.
function calendarDayDiff(from: string, to: string): number {
  const msPerDay = 86_400_000;
  return (Date.parse(to) - Date.parse(from)) / msPerDay;
}

// Determine whether a period is late and what late fee is owed.
//
// Parameters:
//   dueDateISO     - The due date of the period ('YYYY-MM-DD'), always the 1st of the month.
//   scheduledCents - The full scheduled payment amount for the period (e.g. 187_218).
//   settlements    - All dated settlements applied to this period (may be empty).
//   todayISO       - The reference date for the unsatisfied-but-overdue check ('YYYY-MM-DD').
//
// Rules:
//   1. Walk settlements in chronological order (caller may provide them in any order; we sort).
//   2. Find the first settlement whose running total >= scheduledCents -- that is the satisfiedDate.
//   3. If satisfiedDate exists and calendarDayDiff(dueDate, satisfiedDate) > 5 -> late.
//   4. If never satisfied and calendarDayDiff(dueDate, today) > 5 -> late, satisfiedDate = null.
//   5. Late fee = Math.round(scheduledCents * 0.05). Zero when not late.
//
export function assessLateFee(
  dueDateISO: string,
  scheduledCents: Cents,
  settlements: DatedSettlement[],
  todayISO: string,
): LateFeeResult {
  // Sort by posted date ascending (ISO lexical sort is safe for YYYY-MM-DD).
  const sorted = [...settlements].sort((a, b) =>
    a.postedDate < b.postedDate ? -1 : a.postedDate > b.postedDate ? 1 : 0,
  );

  let cumulative = 0;
  let satisfiedDate: string | null = null;

  for (const s of sorted) {
    cumulative += s.amountCents;
    if (cumulative >= scheduledCents) {
      satisfiedDate = s.postedDate;
      break;
    }
  }

  const daysLate = satisfiedDate !== null
    ? calendarDayDiff(dueDateISO, satisfiedDate)
    : calendarDayDiff(dueDateISO, todayISO);

  const isLate = daysLate > 5;
  const lateFeeOwedCents = isLate ? Math.round(scheduledCents * 0.05) : 0;

  return { isLate, lateFeeOwedCents, satisfiedDate };
}
