import { describe, it, expect } from 'vitest';
import { aggregateSettlements } from './settlement';

const SCHEDULED = 187_218;

describe('aggregateSettlements', () => {
  it('returns empty when nothing recorded', () => {
    expect(aggregateSettlements([], [], SCHEDULED)).toEqual([]);
  });

  it('sums cash and credits within a period', () => {
    const out = aggregateSettlements(
      [{ periodIndex: 1, amountCents: 100_000 }],
      [{ periodIndex: 1, amountCents: 87_218 }],
      SCHEDULED,
    );
    expect(out).toEqual([{ amountCents: 187_218 }]);
  });

  it('fills unsettled gaps below the max period with the scheduled amount', () => {
    const out = aggregateSettlements(
      [{ periodIndex: 3, amountCents: 187_218 }],
      [],
      SCHEDULED,
    );
    expect(out).toEqual([
      { amountCents: 187_218 },
      { amountCents: 187_218 },
      { amountCents: 187_218 },
    ]);
  });

  it('reflects an overpayment (cash + credit > scheduled) for spill-to-principal', () => {
    const out = aggregateSettlements(
      [{ periodIndex: 1, amountCents: 187_218 }],
      [{ periodIndex: 1, amountCents: 50_000 }],
      SCHEDULED,
    );
    expect(out[0].amountCents).toBe(237_218);
  });
});
