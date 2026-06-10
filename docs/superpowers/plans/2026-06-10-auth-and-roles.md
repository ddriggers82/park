# Auth & Roles Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clerk authentication with two roles (seller, buyer) and enforce the authorization boundary: buyers can view their balance but cannot record payments or see seller-only controls.

**Architecture:** Clerk wraps the Next.js app via `ClerkProvider`. `clerkMiddleware` requires every route except the sign-in/sign-up pages to be authenticated. Role lives in each Clerk user's `publicMetadata.role` (`'seller' | 'buyer'`); server code reads it via `currentUser()` and enforces it. The home page renders a seller view (full schedule + payment form) or a buyer view (read-only summary + schedule) based on role. Sign-ups are restricted to an invite allowlist in the Clerk dashboard.

**Tech Stack:** `@clerk/nextjs` v6, Next.js 15.5 App Router, Vitest.

**Depends on:** Plan 1 (Loan Core), complete and verified.

## RESOLVED FACTS (Clerk, from current docs — embed in every subagent dispatch)

- Install: `pnpm add @clerk/nextjs` (resolves to **v7.x**). NOTE: v7 removed `SignedIn`/`SignedOut`; use `<Show when="signed-in">` / `<Show when="signed-out">` instead (verified against the installed package).
- `ClerkProvider`, `Show`, `SignInButton`, `UserButton` from `@clerk/nextjs` wrap the app in `src/app/layout.tsx`.
- Middleware (`src/middleware.ts`):
  ```ts
  import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
  const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);
  export default clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) await auth.protect();
  });
  export const config = {
    matcher: [
      '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
      '/(api|trpc)(.*)',
    ],
  };
  ```
- Server-side auth: `import { auth, currentUser } from '@clerk/nextjs/server'`. `auth()` is async: `const { isAuthenticated, userId } = await auth();`. `currentUser()` returns the Backend User; `user.publicMetadata.role` holds the role.
- Custom sign-in/up pages are catch-all routes using `<SignIn />` / `<SignUp />` from `@clerk/nextjs`. Env vars: `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`.
- Invite-only / role assignment are Clerk Dashboard operations (Task 6), not code.

---

## File Structure

```
src/
  middleware.ts                          # clerkMiddleware route protection
  lib/
    roles.ts                             # pure parseRole() + Role type
    roles.test.ts
    current-role.ts                      # server-only: getCurrentRole(), requireSeller()
  app/
    layout.tsx                           # + ClerkProvider, header with UserButton
    page.tsx                             # role-aware: seller vs buyer view
    actions.ts                           # submitPayment enforces seller role
    sign-in/[[...sign-in]]/page.tsx
    sign-up/[[...sign-up]]/page.tsx
  scripts/
    set-role.ts                          # CLI: set a user's role via Clerk backend API
docs/
  auth-setup.md                          # manual Clerk dashboard steps + 4 invites
```

---

### Task 1: Install Clerk and wrap the app

**Files:** Modify `src/app/layout.tsx`; modify `.env.local` (gitignored).

- [ ] **Step 1: Install**

Run: `pnpm add @clerk/nextjs`
Expected: added to dependencies.

- [ ] **Step 2: Add sign-in/up URL envs to `.env.local`** (the Clerk keys are already present)

Append:
```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
```

- [ ] **Step 3: Wrap `src/app/layout.tsx` with ClerkProvider + a minimal header**

```tsx
import { ClerkProvider, Show, SignInButton, UserButton } from '@clerk/nextjs';

export const metadata = { title: 'Park Payments' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 24 }}>
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <strong>Park Payments</strong>
            <div>
              <Show when="signed-out">
                <SignInButton />
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </div>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 4: Build to verify wiring**

Run: `pnpm run build`
Expected: compiles. (Build does not require a live Clerk connection.)

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: wrap app in ClerkProvider with auth header"
```

---

### Task 2: Route protection middleware

**Files:** Create `src/middleware.ts`.

- [ ] **Step 1: Create `src/middleware.ts`** (exact content from RESOLVED FACTS)

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

- [ ] **Step 2: Build**

Run: `pnpm run build`
Expected: compiles; middleware is detected.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: clerk middleware protecting all non-auth routes"
```

---

### Task 3: Sign-in and sign-up pages

**Files:** Create `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx`.

- [ ] **Step 1: Create `src/app/sign-in/[[...sign-in]]/page.tsx`**

```tsx
import { SignIn } from '@clerk/nextjs';

export default function Page() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <SignIn />
    </main>
  );
}
```

- [ ] **Step 2: Create `src/app/sign-up/[[...sign-up]]/page.tsx`**

```tsx
import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <SignUp />
    </main>
  );
}
```

- [ ] **Step 3: Build**

Run: `pnpm run build`
Expected: compiles; `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]` routes present.

- [ ] **Step 4: Commit**

```bash
git add src/app/sign-in src/app/sign-up
git commit -m "feat: custom sign-in and sign-up pages"
```

---

### Task 4: Role helpers (pure parse + server guard)

**Files:** Create `src/lib/roles.ts`, `src/lib/roles.test.ts`, `src/lib/current-role.ts`.

- [ ] **Step 1: Write the failing test `src/lib/roles.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `pnpm test src/lib/roles.test.ts`
Expected: FAIL — cannot resolve `./roles`.

- [ ] **Step 3: Implement `src/lib/roles.ts`** (pure, no Clerk import — testable)

```ts
export type Role = 'seller' | 'buyer';

export function parseRole(value: unknown): Role | null {
  return value === 'seller' || value === 'buyer' ? value : null;
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `pnpm test src/lib/roles.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `src/lib/current-role.ts`** (server-only; uses Clerk + the pure parser)

```ts
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
```

- [ ] **Step 6: Install the `server-only` guard package and type-check**

Run: `pnpm add server-only && pnpm exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/roles.ts src/lib/roles.test.ts src/lib/current-role.ts package.json
git commit -m "feat: role parsing and server-side seller guard"
```

---

### Task 5: Enforce role in the action and split the home view

**Files:** Modify `src/app/actions.ts`, `src/app/page.tsx`.

- [ ] **Step 1: Add the seller guard to `submitPayment` in `src/app/actions.ts`**

Add the import at the top:
```ts
import { requireSeller } from '../lib/current-role';
```
And make `submitPayment`'s first line (before reading form data) enforce the role:
```ts
export async function submitPayment(formData: FormData): Promise<void> {
  await requireSeller();
  const loanId = await ensureAnchorRiverLoan();
  // ...rest unchanged...
}
```
(Leave `loadSchedule` unchanged — both roles may read the schedule.)

- [ ] **Step 2: Make `src/app/page.tsx` role-aware**

```tsx
import { loadSchedule, submitPayment } from './actions';
import { formatCents } from '../lib/money';
import { getCurrentRole } from '../lib/current-role';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const role = await getCurrentRole();
  const schedule = await loadSchedule();
  const balance =
    schedule.rows.length > 0
      ? schedule.rows[schedule.rows.length - 1].balanceCents
      : 0;
  const nextDue = schedule.rows.find((r) => r.balanceCents >= 0) ?? schedule.rows[0];

  return (
    <main>
      <h1>Anchor River Note</h1>
      {!role && (
        <p style={{ color: '#a00' }}>
          Your account has no role assigned yet. Ask the seller to set it.
        </p>
      )}
      <p>
        Payoff: <strong>{schedule.payoffDate}</strong> · Payments:{' '}
        <strong>{schedule.periods}</strong> · Total interest:{' '}
        <strong>{formatCents(schedule.totalInterestCents)}</strong> · Final
        balance: <strong>{formatCents(schedule.finalBalanceCents)}</strong>
      </p>

      {role === 'seller' && (
        <form action={submitPayment} style={{ margin: '16px 0' }}>
          <fieldset style={{ display: 'inline-flex', gap: 8, alignItems: 'end' }}>
            <legend>Record a payment</legend>
            <label>
              Period
              <br />
              <input name="periodIndex" type="number" min="1" required />
            </label>
            <label>
              Amount ($)
              <br />
              <input name="amountDollars" type="number" step="0.01" min="0" required />
            </label>
            <label>
              Posted date
              <br />
              <input name="postedDate" type="date" required />
            </label>
            <button type="submit">Add</button>
          </fieldset>
        </form>
      )}

      <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'right', borderBottom: '2px solid #333' }}>
            <th style={{ textAlign: 'left' }}>#</th>
            <th style={{ textAlign: 'left' }}>Due</th>
            <th>Payment</th>
            <th>Interest</th>
            <th>Principal</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {schedule.rows.map((row) => (
            <tr
              key={row.index}
              style={{
                textAlign: 'right',
                borderBottom: '1px solid #ddd',
                background: row.isExtra ? '#eef9ee' : undefined,
              }}
            >
              <td style={{ textAlign: 'left' }}>{row.index}</td>
              <td style={{ textAlign: 'left' }}>{row.dueDate}</td>
              <td>{formatCents(row.appliedCents)}</td>
              <td>{formatCents(row.interestCents)}</td>
              <td>{formatCents(row.principalCents)}</td>
              <td>{formatCents(row.balanceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Type-check, build, and run the unit suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; unit tests pass (money, amortization, loan-terms, roles), repository integration skipped (no DATABASE_URL in the bare test run).

- [ ] **Step 4: Commit**

```bash
git add src/app/actions.ts src/app/page.tsx
git commit -m "feat: role-aware home view; seller-only payment entry"
```

---

### Task 6: Role-setting script + manual setup doc

**Files:** Create `src/scripts/set-role.ts`, `docs/auth-setup.md`.

- [ ] **Step 1: Create `src/scripts/set-role.ts`** (sets a user's role via Clerk backend API)

```ts
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
```

- [ ] **Step 2: Create `docs/auth-setup.md`**

```markdown
# Auth Setup (Clerk)

One-time manual steps in the Clerk Dashboard (https://dashboard.clerk.com):

## 1. Restrict sign-ups (invite-only)
- Configure → Restrictions → Sign-up mode → **Restricted**.
- Add the 4 allowed emails to the allowlist:
  - Seller 1: <seller-1-email>
  - Seller 2: <seller-2-email>
  - Buyer 1:  <buyer-1-email>
  - Buyer 2:  <buyer-2-email>

## 2. Invite the 4 users
- Send each an invitation (or have them sign in once their email is allowlisted).

## 3. Assign roles
After each user exists, set their role. Either:
- Dashboard: open the user → Metadata → Public → add `{ "role": "seller" }` or `{ "role": "buyer" }`, OR
- Script: `pnpm tsx src/scripts/set-role.ts <userId> <seller|buyer>` (the userId is on the user's page in the dashboard).

Roles: 2 users get `seller`, 2 get `buyer`.
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/set-role.ts docs/auth-setup.md
git commit -m "feat: role-setting script and auth setup doc"
```

---

## Manual Verification Gate (after all tasks, requires the dev server + Clerk dashboard)

1. Clerk dashboard: set sign-ups to Restricted, allowlist your own email, and sign up.
2. `pnpm dev`, open the app → you are redirected to `/sign-in`; after signing in you see the home page.
3. With no role set, the page shows the "no role assigned" notice and no payment form.
4. Set your user's role to `seller` (dashboard or script) → reload → the payment form appears and you can record a payment.
5. Set a second test user to `buyer` → that session sees the schedule and summary but no payment form, and a direct `submitPayment` attempt throws "Forbidden".

## Self-Review

**Spec coverage:** Clerk auth (Task 1–3); two roles via publicMetadata (Task 4, 6); authorization boundary — buyer cannot record payments (Task 5 action guard + conditional form); invite-only (Task 6 dashboard). ✓

**Placeholder scan:** the only placeholders are the four `<...-email>` fields in `auth-setup.md`, which are intentional fill-ins for the human operator, not code gaps.

**Type consistency:** `Role` and `parseRole` defined in `roles.ts`, reused by `current-role.ts`; `requireSeller`/`getCurrentRole` consumed by `actions.ts`/`page.tsx` as defined.

**Deferred to later plans:** the buyer's richer dedicated views (expense-credit entry, royalty reporting) arrive in Plans 3 and 5; here the buyer simply gets read-only schedule access. Integration-test DB isolation (Neon test branch) is tracked separately and not required for this plan's automated tests.
