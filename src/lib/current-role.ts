import 'server-only';
import { currentUser } from '@clerk/nextjs/server';
import { parseRole, type Role } from './roles';

export async function getCurrentRole(): Promise<Role | null> {
  const user = await currentUser();
  return parseRole(user?.publicMetadata?.role);
}

export async function requireSeller(): Promise<void> {
  const role = await getCurrentRole();
  if (role !== 'seller') {
    throw new Error('Forbidden: seller role required');
  }
}
