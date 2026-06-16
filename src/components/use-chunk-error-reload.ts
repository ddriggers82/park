'use client';

import { useEffect, useState } from 'react';
import { isChunkLoadError, shouldReloadOnce } from '../lib/chunk-error';

/**
 * When an error boundary catches a stale-chunk error (browser holding HTML from
 * a previous deployment), reload once so the browser fetches the current chunks.
 * Returns true while a reload is in flight so the boundary can render a spinner
 * instead of a scary error message. Guards against reload loops.
 */
export function useChunkErrorReload(error: Error): boolean {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isChunkLoadError(error)) return;
    if (shouldReloadOnce(window.sessionStorage, Date.now())) {
      setReloading(true);
      window.location.reload();
    }
  }, [error]);

  return reloading;
}
