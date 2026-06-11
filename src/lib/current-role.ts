import 'server-only';
import { currentUser, clerkClient } from '@clerk/nextjs/server';
import { parseRole, type Role } from './roles';
import { roleForEmail } from './role-assignments';

export async function getCurrentRole(): Promise<Role | null> {
  const user = await currentUser();
  if (!user) return null;

  const existing = parseRole(user.publicMetadata?.role);
  if (existing) return existing;

  // First sign-in: auto-assign a role by email, then persist it on the Clerk user.
  const assigned = roleForEmail(user.emailAddresses?.[0]?.emailAddress);
  if (assigned) {
    const client = await clerkClient();
    await client.users.updateUserMetadata(user.id, {
      publicMetadata: { role: assigned },
    });
    return assigned;
  }
  return null;
}

export async function requireSeller(): Promise<void> {
  const role = await getCurrentRole();
  if (role !== 'seller') {
    throw new Error('Forbidden: seller role required');
  }
}
