import type { SessionController, SessionState } from '../state/session-controller.ts';
import type { SyncEngine, SyncScopeRef } from './engine.ts';

function scopeOf(state: SessionState): SyncScopeRef | null {
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  return { membershipId: state.activeMembership.id, userId: state.user.id };
}

/**
 * Keeps the engine on the membership the app acts in (ADR 0065):
 * - signed in with a club: that membership (another user than the one whose
 *   data the device holds wipes it first, `SyncEngine.setScope`);
 * - choosing a club, or signed out: nothing syncs;
 * - signing out on purpose wipes every club row, queue and issue: data of
 *   minors does not stay on a phone nobody is signed in to. A session that
 *   expired (`401`) keeps them: the same person signs in again and the queue
 *   goes out; someone else signing in wipes them.
 * Returns the stop.
 */
export function bindSyncToSession(
  engine: SyncEngine,
  session: Pick<SessionController, 'getState' | 'subscribe'>,
  reportError: (error: unknown) => void,
): () => void {
  let previous: SessionState = session.getState();
  let chain: Promise<void> = Promise.resolve();

  function run(task: () => Promise<void>): void {
    chain = chain.then(task).catch(reportError);
  }

  function apply(state: SessionState): void {
    if (state.status === 'starting') return;
    // From a session to none without the "expired" notice: the user signed out
    // (a launch without a token goes from `starting`, and wipes nothing).
    const signedOutOnPurpose =
      state.status === 'signedOut' &&
      state.notice === null &&
      (previous.status === 'signedIn' || previous.status === 'unavailable');
    previous = state;
    const scope = scopeOf(state);
    run(async () => {
      await engine.setScope(scope);
      if (signedOutOnPurpose) await engine.wipe();
    });
  }

  apply(previous);
  const unsubscribe = session.subscribe(() => {
    apply(session.getState());
  });
  return unsubscribe;
}
