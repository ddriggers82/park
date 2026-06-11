import { describe, it, expect } from 'vitest';
import { royaltyOwed, royaltyDueDates } from './royalty';

describe('royaltyOwed', () => {
  it('returns 25% rounded for a round number', () => {
    // $10,000 gross -> $2,500 owed
    expect(royaltyOwed(1_000_000)).toBe(250_000);
  });

  it('returns 25% rounded for an exact cent value', () => {
    // $1,872.18 -> $468.045 -> rounds to $468.05 (46805 cents)
    expect(royaltyOwed(187_218)).toBe(46_805);
  });

  it('rounds half-cent up (Math.round behavior)', () => {
    // 3 cents * 0.25 = 0.75 cents -> rounds to 1 cent
    expect(royaltyOwed(3)).toBe(1);
  });

  it('returns 0 for 0 gross income', () => {
    expect(royaltyOwed(0)).toBe(0);
  });

  it('handles a large seasonal gross (100 sites * $3000/mo * 6mo = $1,800,000)', () => {
    // gross: $1,800,000 -> $450,000 owed
    expect(royaltyOwed(180_000_000)).toBe(45_000_000);
  });
});

describe('royaltyDueDates', () => {
  it('returns July 1 and October 1 for a given year', () => {
    expect(royaltyDueDates(2026)).toEqual(['2026-07-01', '2026-10-01']);
  });

  it('works for any calendar year', () => {
    expect(royaltyDueDates(2028)).toEqual(['2028-07-01', '2028-10-01']);
  });

  it('returns exactly two dates', () => {
    expect(royaltyDueDates(2027)).toHaveLength(2);
  });

  it('July date is always before October date', () => {
    const [first, second] = royaltyDueDates(2026);
    expect(first < second).toBe(true);
  });
});
