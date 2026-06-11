import { ClerkProvider, Show, SignInButton, UserButton } from '@clerk/nextjs';
import './globals.css';

export const metadata = { title: 'Park Payments' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header className="site-header">
            <div className="site-header__inner">
              <span className="site-header__brand">Park Payments</span>
              <div>
                <Show when="signed-out">
                  <SignInButton />
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </div>
          </header>
          <div className="site-content">{children}</div>
        </body>
      </html>
    </ClerkProvider>
  );
}
