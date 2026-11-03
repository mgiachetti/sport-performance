import type { SyncEngine } from './engine.ts';

/** While the app is in the foreground, a cycle at least this often (pulls what others changed). */
export const FOREGROUND_SYNC_INTERVAL_MS = 5 * 60_000;

export interface SyncTriggerSources {
  /** Calls back with `true` when the app comes to the foreground and `false` when it leaves. */
  readonly onAppActive: (listener: (active: boolean) => void) => () => void;
  /** Calls back with whether the device has a usable connection, on every change. */
  readonly onConnectivity: (listener: (online: boolean) => void) => () => void;
  readonly setInterval: (task: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

/**
 * When the engine syncs on its own (ADR 0065), besides right after a write:
 * on coming to the foreground and on getting the connection back (both
 * "now": they skip a backoff and resume a pause), and every few minutes
 * while in the foreground (a plain request: it never skips a backoff). The
 * background task (`src/platform/background-sync.ts`) covers the rest.
 * Returns the stop.
 */
export function startSyncTriggers(engine: SyncEngine, sources: SyncTriggerSources): () => void {
  let interval: unknown = null;
  let online: boolean | null = null;

  function startInterval(): void {
    if (interval !== null) return;
    interval = sources.setInterval(() => {
      engine.requestSync();
    }, FOREGROUND_SYNC_INTERVAL_MS);
  }

  function stopInterval(): void {
    if (interval === null) return;
    sources.clearInterval(interval);
    interval = null;
  }

  const stopActive = sources.onAppActive((active) => {
    if (active) {
      engine.requestSync({ force: true });
      startInterval();
    } else {
      stopInterval();
    }
  });
  const stopConnectivity = sources.onConnectivity((next) => {
    const cameBack = next && online === false;
    online = next;
    if (cameBack) engine.requestSync({ force: true });
  });
  startInterval();

  return () => {
    stopActive();
    stopConnectivity();
    stopInterval();
  };
}
