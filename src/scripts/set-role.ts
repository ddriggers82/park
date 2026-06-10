import { clerkClient } from '@clerk/nextjs/server';

// Usage: pnpm tsx src/scripts/set-role.ts <userId> <seller|buyer>
async function main() {
  const [userId, role] = process.argv.slice(2);
  if (!userId || (role !== 'seller' && role !== 'buyer')) {
    console.error('Usage: tsx src/scripts/set-role.ts <userId> <seller|buyer>');
    process.exit(1);
  }
  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, { publicMetadata: { role } });
  console.log(`Set role '${role}' on user ${userId}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
