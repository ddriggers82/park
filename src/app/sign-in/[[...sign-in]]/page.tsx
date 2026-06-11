import { SignIn } from '@clerk/nextjs';

export const metadata = { title: 'Sign in | Park Payments' };

export default function Page() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <SignIn />
    </main>
  );
}
