import type { AppliedPayment } from './amortization';

export interface PeriodAmount {
  periodIndex: number;
  amountCents: number;
}

// Aggregate cash payments + (already-filtered active) credits into the engine's
// positional AppliedPayment[]. Periods with no record default to `scheduledCents`.
export function aggregateSettlements(
  payments: PeriodAmount[],
  credits: PeriodAmount[],
  scheduledCents: number,
): AppliedPayment[] {
  const all = [...payments, ...credits];
  if (all.length === 0) return [];
  const byPeriod = new Map<number, number>();
  for (const { periodIndex, amountCents } of all) {
    byPeriod.set(periodIndex, (byPeriod.get(periodIndex) ?? 0) + amountCents);
  }
  const maxPeriod = Math.max(...byPeriod.keys());
  const out: AppliedPayment[] = [];
  for (let i = 1; i <= maxPeriod; i += 1) {
    out.push({ amountCents: byPeriod.get(i) ?? scheduledCents });
  }
  return out;
}
