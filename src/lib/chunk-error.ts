// Detects the "stale chunk" class of client errors that occur when a browser
// tab holds HTML from an older deployment and then tries to fetch content-hashed
// JS/CSS chunks that no longer exist on the new deployment. These surface as a
// generic "Application error: a client-side exception" overlay. The fix is to
// reload once so the browser fetches the current HTML and chunk manifest.

const CHUNK_ERROR_PATTERNS = [
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  if (!message) return false;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

// Minimal subset of the Web Storage API we depend on, so the guard is testable
// without a real `sessionStorage`.
export interface ReloadGuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const RELOAD_MARKER_KEY = 'pp_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Returns true at most once per cooldown window, recording the attempt so a
 * persistently-failing chunk does not put the page into an infinite reload loop.
 */
export function shouldReloadOnce(storage: ReloadGuardStorage, now: number): boolean {
  const raw = storage.getItem(RELOAD_MARKER_KEY);
  const last = raw === null ? NaN : Number(raw);
  if (Number.isFinite(last) && now - last < RELOAD_COOLDOWN_MS) {
    return false;
  }
  storage.setItem(RELOAD_MARKER_KEY, String(now));
  return true;
}
