import { describe, it, expect } from 'vitest';
import { isChunkLoadError, shouldReloadOnce } from './chunk-error';

describe('isChunkLoadError', () => {
  it('detects a ChunkLoadError by name', () => {
    const e = new Error('whatever');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  it('detects the classic "Loading chunk N failed" message', () => {
    expect(isChunkLoadError(new Error('Loading chunk 481 failed.'))).toBe(true);
  });

  it('detects a failed CSS chunk', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed'))).toBe(true);
  });

  it('detects a failed dynamic import (module script)', () => {
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/y.js')),
    ).toBe(true);
  });

  it('detects "Importing a module script failed"', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('is safe on non-Error values', () => {
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError('Loading chunk 1 failed')).toBe(true); // string message still matches
    expect(isChunkLoadError({})).toBe(false);
  });
});

describe('shouldReloadOnce', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const store: Record<string, string> = { ...initial };
    return {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
  }

  it('allows a reload on the first chunk error and records the attempt', () => {
    const storage = memoryStorage();
    expect(shouldReloadOnce(storage, 1_000_000)).toBe(true);
    // marker is now set to "now"
    expect(storage.getItem('pp_chunk_reload_at')).toBe('1000000');
  });

  it('blocks a second reload within the cooldown window (avoids reload loops)', () => {
    const storage = memoryStorage();
    shouldReloadOnce(storage, 1_000_000);
    expect(shouldReloadOnce(storage, 1_000_000 + 5_000)).toBe(false);
  });

  it('allows another reload after the cooldown window passes', () => {
    const storage = memoryStorage();
    shouldReloadOnce(storage, 1_000_000);
    expect(shouldReloadOnce(storage, 1_000_000 + 60_000)).toBe(true);
  });

  it('treats a corrupt marker as no prior reload', () => {
    const storage = memoryStorage({ pp_chunk_reload_at: 'not-a-number' });
    expect(shouldReloadOnce(storage, 1_000_000)).toBe(true);
  });
});
