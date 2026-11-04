import type { SessionController } from '../state/session-controller.ts';
import { membershipForPush, parsePushData, routeForPush, type AppRoute } from './routing.ts';

/**
 * Opens what a tapped push points at (B-510, ADR 0081). A tap can arrive
 * before the app knows who is signed in (it opened from closed) or while the
 * user is signed out: it waits in memory, never on disk, until the session
 * has memberships. Then it switches to the membership the push is for (if it
 * is not the active one) and navigates. A push whose `data` the app does not
 * understand opens home.
 */
export interface PushTapHandler {
  /** `data` of the tapped push, as the device hands it. */
  handle(data: unknown): void;
  dispose(): void;
}

export function createPushTapHandler(options: {
  readonly session: Pick<SessionController, 'getState' | 'subscribe' | 'selectMembership'>;
  /**
   * Opens `route` once the session acts in `membershipId` (the club's
   * screens are behind guards that render after the switch): the caller
   * waits for the session state to show it before navigating.
   */
  readonly navigate: (route: AppRoute, membershipId: string) => void;
  readonly reportError?: (error: unknown) => void;
}): PushTapHandler {
  const { session, navigate } = options;
  const report = options.reportError ?? (() => undefined);
  let pending: unknown = undefined;
  let hasPending = false;

  function flush(): void {
    if (!hasPending) return;
    const state = session.getState();
    // Signed out or still starting: the tap waits for the sign-in.
    if (state.status !== 'signedIn') return;
    const data = parsePushData(pending);
    hasPending = false;
    pending = undefined;
    const active = state.activeMembership;
    if (data === null) {
      if (active !== null) navigate({ pathname: '/home' }, active.id);
      return;
    }
    const target = membershipForPush(state.memberships, active, data);
    if (target !== null && target.id !== active?.id) {
      const route = routeForPush(data);
      session
        .selectMembership(target.id)
        .then(() => {
          navigate(route, target.id);
        })
        .catch(report);
      return;
    }
    // Without a club yet (the selector), there is nowhere to go: the selector stays.
    if (active === null) return;
    navigate(target === null ? { pathname: '/home' } : routeForPush(data), active.id);
  }

  const unsubscribe = session.subscribe(flush);
  return {
    handle(data) {
      pending = data;
      hasPending = true;
      flush();
    },
    dispose() {
      unsubscribe();
    },
  };
}
