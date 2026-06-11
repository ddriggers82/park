import { describe, it, expect } from 'vitest';
import { reminderTriggerDate, isLapsed } from './tax-reminder';

describe('reminderTriggerDate', () => {
  it('returns 10 days before the delinquency date — mid-month', () => {
    expect(reminderTriggerDate('2026-10-15')).toBe('2026-10-05');
  });

  it('crosses month boundary correctly', () => {
    // delinquency: Nov 5 → reminder: Oct 26
    expect(reminderTriggerDate('2026-11-05')).toBe('2026-10-26');
  });

  it('crosses year boundary correctly', () => {
    // delinquency: Jan 8 → reminder: Dec 29 of prior year
    expect(reminderTriggerDate('2027-01-08')).toBe('2026-12-29');
  });

  it('handles leap-year February correctly', () => {
    // delinquency: Mar 5 2028 (leap year) → reminder: Feb 24
    expect(reminderTriggerDate('2028-03-05')).toBe('2028-02-24');
  });
});

describe('isLapsed', () => {
  it('returns true when expiration equals today', () => {
    expect(isLapsed('2026-06-10', '2026-06-10')).toBe(true);
  });

  it('returns true when expiration is before today', () => {
    expect(isLapsed('2026-06-09', '2026-06-10')).toBe(true);
  });

  it('returns false when expiration is after today', () => {
    expect(isLapsed('2027-06-10', '2026-06-10')).toBe(false);
  });

  it('handles day-before boundary', () => {
    expect(isLapsed('2026-06-09', '2026-06-09')).toBe(true);
    expect(isLapsed('2026-06-10', '2026-06-09')).toBe(false);
  });
});
