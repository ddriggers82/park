import { describe, it, expect } from 'vitest';
import { parseRole } from './roles';

describe('parseRole', () => {
  it('accepts the two valid roles', () => {
    expect(parseRole('seller')).toBe('seller');
    expect(parseRole('buyer')).toBe('buyer');
  });

  it('returns null for anything else', () => {
    expect(parseRole('admin')).toBeNull();
    expect(parseRole('')).toBeNull();
    expect(parseRole(undefined)).toBeNull();
    expect(parseRole(null)).toBeNull();
    expect(parseRole(42)).toBeNull();
    expect(parseRole({ role: 'seller' })).toBeNull();
  });
});
