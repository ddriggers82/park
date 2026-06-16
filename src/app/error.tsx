'use client';

// Segment-level error boundary. Catches errors thrown while rendering a route
// (e.g. the dashboard) while keeping the root layout (header) intact. A stale
// chunk after a deploy triggers a one-time auto-reload; everything else shows a
// recoverable message with the digest for support.

import { useEffect } from 'react';
import { useChunkErrorReload } from '../components/use-chunk-error-reload';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reloading = useChunkErrorReload(error);

  useEffect(() => {
    console.error('[dashboard error boundary]', error);
  }, [error]);

  if (reloading) {
    return (
      <main>
        <p style={{ color: 'var(--sub)' }}>Updating to the latest version…</p>
      </main>
    );
  }

  return (
    <main>
      <div className="card">
        <h2>Something went wrong</h2>
        <p style={{ color: 'var(--sub)' }}>
          This page hit an unexpected error. Try again, and if it keeps happening, refresh the
          page.
        </p>
        {error.digest && (
          <p style={{ fontSize: '0.75rem', color: 'var(--sub)' }}>
            Reference code: <code>{error.digest}</code>
          </p>
        )}
        <button className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </main>
  );
}
