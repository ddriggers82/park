import type { Role } from './roles';

// Email -> role mapping for automatic role assignment on first sign-in.
// Add the 4th buyer email here when known, then redeploy.
const SELLER_EMAILS = ['david.driggers@gmail.com', '4leighannw@gmail.com'];
const BUYER_EMAILS = ['offgridelectronicsllc@gmail.com'];

export function roleForEmail(email: string | null | undefined): Role | null {
  if (!email) return null;
  const e = email.toLowerCase();
  if (SELLER_EMAILS.includes(e)) return 'seller';
  if (BUYER_EMAILS.includes(e)) return 'buyer';
  return null;
}
