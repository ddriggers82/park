import { SignUp } from '@clerk/nextjs';

export const metadata = { title: 'Create account | Park Payments' };

export default function Page() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <SignUp />
    </main>
  );
}
