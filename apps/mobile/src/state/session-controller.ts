import {
  ApiError,
  ApiNetworkError,
  type ApiClient,
  type MembershipSummary,
  type SessionUser,
  type SignedIn,
} from '@sport-performance/contracts';
import type { ApiFailureEvent } from '../api/client.ts';
import {
  snapshotOf,
  type SessionSnapshot,
  type SessionStore,
  type StoredUser,
} from '../auth/session-store.ts';
import { resolveMembership, sortMemberships } from '../clubs/membership.ts';

/** Why the user is on the sign-in screen, when it is not the first time. */
export type SignedOutNotice = 'sessionExpired';

/** Why the user is on the club selector, when they did not ask for it. */
export type ClubNotice = 'membershipLost';

export type SessionState =
  /** Reading the secure storage at launch (the splash screen stays up). */
  | { readonly status: 'starting' }
  | { readonly status: 'signedOut'; readonly notice: SignedOutNotice | null }
  /** There is a session but nothing cached and the API cannot be reached. */
  | { readonly status: 'unavailable' }
  | SignedInState;

export interface SignedInState {
  readonly status: 'signedIn';
  readonly user: StoredUser;
  /** `null` while offline from the snapshot (the email is not kept on the device). */
  readonly email: string | null;
  readonly memberships: readonly MembershipSummary[];
  /** The club the app acts in; `null` while the user has to choose or has none. */
  readonly activeMembership: MembershipSummary | null;
  readonly clubNotice: ClubNotice | null;
  /** The data comes from the device: the last refresh could not reach the API. */
  readonly offline: boolean;
}

export type SessionApi = Pick<
  ApiClient,
  | 'getMe'
  | 'listMyMemberships'
  | 'sendSignInCode'
  | 'verifySignInCode'
  | 'redeemPlayerAccess'
  | 'signOut'
  | 'acceptInvitation'
>;

export interface SessionControllerOptions {
  readonly api: SessionApi;
  readonly store: SessionStore;
  /** Reports unexpected errors (Sentry); never with personal data. */
  readonly reportError?: (error: unknown) => void;
}

export type PlayerAccessCredential = { readonly code: string } | { readonly token: string };

export interface SessionController {
  readonly getState: () => SessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Once, at launch. */
  start(): Promise<void>;
  /** Re-reads the user and memberships (launch, foreground, after a `403` of a club endpoint). */
  refresh(): Promise<void>;
  /** Asks for the email code; resolves with its lifetime in seconds. */
  requestCode(email: string): Promise<number>;
  verifyCode(email: string, code: string): Promise<void>;
  redeemPlayerAccess(credential: PlayerAccessCredential): Promise<void>;
  selectMembership(membershipId: string): Promise<void>;
  /** Back to the selector, to act in another club. */
  chooseAnotherClub(): Promise<void>;
  /** Accepts an invitation and acts in its club. */
  acceptInvitation(token: string): Promise<MembershipSummary>;
  signOut(): Promise<void>;
  /** What the API client publishes (`createMobileApi().onFailure`). */
  handleApiFailure(event: ApiFailureEvent): void;
  /**
   * An invitation link opened while signed out: kept in memory (never on
   * disk) until the sign-in finishes, to come back to it.
   */
  readonly pendingInvitation: {
    get(): string | null;
    set(token: string | null): void;
  };
}

function isNetworkError(error: unknown): boolean {
  return error instanceof ApiNetworkError;
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated';
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  const { api, store } = options;
  const report = options.reportError ?? (() => undefined);
  const listeners = new Set<() => void>();
  let state: SessionState = { status: 'starting' };
  let pendingInvitation: string | null = null;
  // Bumped on every sign-in and sign-out: answers of a refresh started for a
  // previous session are ignored instead of resurrecting it.
  let generation = 0;
  let refreshing: { readonly generation: number; readonly promise: Promise<void> } | null = null;

  function setState(next: SessionState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  async function signedInFrom(
    user: StoredUser,
    email: string | null,
    memberships: readonly MembershipSummary[],
    offline: boolean,
    clubNotice: ClubNotice | null,
  ): Promise<SignedInState> {
    const sorted = sortMemberships(memberships);
    const storedId = await store.getMembershipId();
    const resolution = resolveMembership(sorted, storedId);
    const activeMembership = resolution.kind === 'active' ? resolution.membership : null;
    if (!offline) {
      // Keep the stored choice in line with what the server says.
      if (activeMembership !== null && activeMembership.id !== storedId) {
        await store.setMembershipId(activeMembership.id);
      } else if (activeMembership === null && storedId !== null) {
        await store.setMembershipId(null);
      }
    }
    const lost = !offline && storedId !== null && activeMembership?.id !== storedId;
    return {
      status: 'signedIn',
      user,
      email,
      memberships: sorted,
      activeMembership,
      clubNotice: lost && activeMembership === null ? 'membershipLost' : clubNotice,
      offline,
    };
  }

  async function signOutLocally(notice: SignedOutNotice | null): Promise<void> {
    generation += 1;
    try {
      await store.clear();
    } catch (error) {
      report(error);
    }
    setState({ status: 'signedOut', notice });
  }

  async function doRefresh(): Promise<void> {
    const started = generation;
    let user: SessionUser;
    let memberships: MembershipSummary[];
    try {
      const [me, list] = await Promise.all([api.getMe(), api.listMyMemberships()]);
      user = me.user;
      memberships = list.items;
    } catch (error) {
      if (started !== generation) return;
      if (isUnauthenticated(error)) {
        await signOutLocally('sessionExpired');
        return;
      }
      if (state.status === 'signedIn') {
        setState({ ...state, offline: true });
      } else if (state.status === 'starting') {
        setState({ status: 'unavailable' });
      }
      if (!isNetworkError(error)) report(error);
      return;
    }
    if (started !== generation) return;
    await store.saveSnapshot(snapshotOf(user, memberships));
    const notice = state.status === 'signedIn' ? state.clubNotice : null;
    const next = await signedInFrom(user, user.email, memberships, false, notice);
    if (started !== generation) return;
    setState(next);
  }

  function refresh(): Promise<void> {
    // One refresh at a time per session: launch, foreground and a `403` can overlap.
    if (refreshing?.generation === generation) return refreshing.promise;
    const current = {
      generation,
      promise: doRefresh().finally(() => {
        if (refreshing === current) refreshing = null;
      }),
    };
    refreshing = current;
    return current.promise;
  }

  async function openSession(signedIn: SignedIn): Promise<void> {
    const token = signedIn.session.token;
    if (token === null) throw new Error('The API answered a cookie session to the app');
    generation += 1;
    await store.saveSession(token);
    // Until the memberships arrive (or the API cannot be reached: `unavailable`).
    setState({ status: 'starting' });
    await refresh();
  }

  async function snapshotState(snapshot: SessionSnapshot): Promise<SignedInState> {
    return signedInFrom(snapshot.user, null, snapshot.memberships, true, null);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      let token: string | null;
      try {
        token = await store.getToken();
      } catch (error) {
        // An unreadable Keychain entry (restored backup, changed device lock): sign in again.
        report(error);
        token = null;
      }
      if (token === null) {
        setState({ status: 'signedOut', notice: null });
        return;
      }
      const snapshot = await store.getSnapshot();
      if (snapshot !== null) setState(await snapshotState(snapshot));
      await refresh();
    },
    refresh,
    async requestCode(email) {
      const sent = await api.sendSignInCode({ body: { email: email.trim() } });
      return sent.expiresInS;
    },
    async verifyCode(email, code) {
      const deviceId = await store.getDeviceId();
      const signedIn = await api.verifySignInCode({
        body: { email: email.trim(), code: code.trim(), transport: 'bearer', deviceId },
      });
      await openSession(signedIn);
    },
    async redeemPlayerAccess(credential) {
      const deviceId = await store.getDeviceId();
      const body =
        'code' in credential
          ? { code: credential.code.trim(), deviceId }
          : { token: credential.token, deviceId };
      await openSession(await api.redeemPlayerAccess({ body }));
    },
    async selectMembership(membershipId) {
      if (state.status !== 'signedIn') return;
      const membership = state.memberships.find((m) => m.id === membershipId);
      if (membership === undefined) throw new Error('Unknown membership');
      await store.setMembershipId(membership.id);
      setState({ ...state, activeMembership: membership, clubNotice: null });
    },
    async chooseAnotherClub() {
      if (state.status !== 'signedIn' || state.memberships.length < 2) return;
      await store.setMembershipId(null);
      setState({ ...state, activeMembership: null, clubNotice: null });
    },
    async acceptInvitation(token) {
      const { membership } = await api.acceptInvitation({ body: { token } });
      await store.setMembershipId(membership.id);
      pendingInvitation = null;
      await refresh();
      return membership;
    },
    async signOut() {
      try {
        await api.signOut();
      } catch (error) {
        // Offline or already closed: the device forgets the session anyway, and
        // the user can close it from "Sesiones activas" on another device.
        if (!isNetworkError(error) && !isUnauthenticated(error)) report(error);
      }
      pendingInvitation = null;
      await signOutLocally(null);
    },
    handleApiFailure(event) {
      if (state.status !== 'signedIn' && state.status !== 'unavailable') return;
      switch (event.kind) {
        case 'session_expired':
          void signOutLocally('sessionExpired');
          return;
        case 'club_forbidden':
          // A permission of that resource keeps the club; a closed membership
          // sends the user back to the selector (`membershipLost`).
          void refresh();
          return;
        case 'update_required':
          // The version gate handles it (ADR 0045).
          return;
      }
    },
    pendingInvitation: {
      get: () => pendingInvitation,
      set: (token) => {
        pendingInvitation = token;
      },
    },
  };
}
