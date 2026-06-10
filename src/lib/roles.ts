export type Role = 'seller' | 'buyer';

export function parseRole(value: unknown): Role | null {
  return value === 'seller' || value === 'buyer' ? value : null;
}
