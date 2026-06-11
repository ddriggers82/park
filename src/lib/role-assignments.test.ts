import { describe, it, expect } from 'vitest';
import { roleForEmail } from './role-assignments';

describe('roleForEmail', () => {
  it('maps seller emails to seller', () => {
    expect(roleForEmail('david.driggers@gmail.com')).toBe('seller');
    expect(roleForEmail('4leighannw@gmail.com')).toBe('seller');
  });

  it('maps buyer emails to buyer', () => {
    expect(roleForEmail('offgridelectronicsllc@gmail.com')).toBe('buyer');
  });

  it('is case-insensitive', () => {
    expect(roleForEmail('David.Driggers@Gmail.com')).toBe('seller');
  });

  it('returns null for unknown or empty emails', () => {
    expect(roleForEmail('stranger@example.com')).toBeNull();
    expect(roleForEmail('')).toBeNull();
    expect(roleForEmail(null)).toBeNull();
    expect(roleForEmail(undefined)).toBeNull();
  });
});
