import type { SessionController } from '../state/session-controller.ts';
import type { SyncEngine } from './engine.ts';

/** iOS gives a background task about 30 s: the cycle is cut a little before. */
export const BACKGROUND_SYNC_BUDGET_MS = 25_000;

function waitFor(
  subscribe: (listener: () => void) => () => void,
  ready: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = subscribe(() => {
      if (!ready()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/**
 * One sync cycle from the background task (ADR 0069): waits for the session
 * read at launch (the token is readable after the first unlock) and for the
 * engine to be on its membership, then syncs within the budget the system
 * gives. Without a session or a club, there is nothing to do. `true` when it
 * synced.
 */
export async function runBackgroundSync(
  services: {
    readonly session: Pick<SessionController, 'getState' | 'subscribe'>;
    readonly sync: SyncEngine;
  },
  budgetMs = BACKGROUND_SYNC_BUDGET_MS,
): Promise<boolean> {
  const { session, sync } = services;
  const started = Date.now();
  const remaining = () => Math.max(0, budgetMs - (Date.now() - started));
  await waitFor(session.subscribe, () => session.getState().status !== 'starting', remaining());
  const state = session.getState();
  if (state.status !== 'signedIn' || state.activeMembership === null) return false;
  const membershipId = state.activeMembership.id;
  const onScope = await waitFor(
    sync.subscribe,
    () => sync.getStatus().membershipId === membershipId,
    remaining(),
  );
  if (!onScope) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, remaining());
  try {
    const outcome = await sync.syncNow({ signal: controller.signal });
    return outcome.status === 'synced';
  } finally {
    clearTimeout(timer);
  }
}
