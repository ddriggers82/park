# Auth Setup (Clerk)

One-time manual steps in the Clerk Dashboard (https://dashboard.clerk.com):

## 1. Restrict sign-ups (invite-only)
- Configure -> Restrictions -> Sign-up mode -> **Restricted**.
- Add the 4 allowed emails to the allowlist:
  - Seller 1: david.driggers@gmail.com
  - Seller 2: 4leighannw@gmail.com
  - Buyer 1:  offgridelectronicsllc@gmail.com
  - Buyer 2:  <buyer-2-email>  (pending)

## 2. Invite the 4 users
- Send each an invitation (or have them sign in once their email is allowlisted).

## 3. Assign roles
After each user exists, set their role. Either:
- Dashboard: open the user -> Metadata -> Public -> add `{ "role": "seller" }` or `{ "role": "buyer" }`, OR
- Script: `pnpm tsx src/scripts/set-role.ts <userId> <seller|buyer>` (the userId is on the user's page in the dashboard).

Roles: 2 users get `seller`, 2 get `buyer`.
