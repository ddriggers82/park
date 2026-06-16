'use client';

// Root error boundary. Replaces the root layout entirely, so it must render its
// own <html>/<body>. This is the last-resort net: it catches errors in the root
// layout and hydration errors that the segment boundary cannot. Styles are
// inline because the layout (and its CSS) may not have mounted. A stale chunk
// after a deploy triggers a one-time auto-reload.

import { useEffect } from 'react';
import { useChunkErrorReload } from '../components/use-chunk-error-reload';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reloading = useChunkErrorReload(error);

  useEffect(() => {
    console.error('[global error boundary]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          color: '#1a1a1a',
          background: '#f4f5f7',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          {reloading ? (
            <p style={{ color: '#666' }}>Updating to the latest version…</p>
          ) : (
            <>
              <h1 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>Something went wrong</h1>
              <p style={{ color: '#666', margin: '0 0 16px' }}>
                The app hit an unexpected error. Reloading usually fixes it.
              </p>
              {error.digest && (
                <p style={{ fontSize: '0.75rem', color: '#888', margin: '0 0 16px' }}>
                  Reference code: <code>{error.digest}</code>
                </p>
              )}
              <button
                onClick={() => reset()}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  background: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reload
              </button>
            </>
          )}
        </div>
      </body>
    </html>
  );
}
