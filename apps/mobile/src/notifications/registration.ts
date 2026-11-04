import { ApiNetworkError, type ApiClient } from '@sport-performance/contracts';
import type { PushPlatform } from '@sport-performance/domain';
import type { PreferenceStorage } from '../platform/storage.ts';
import type { SessionState } from '../state/session-controller.ts';

/**
 * The push token of this phone on the server (B-510, ADR 0054, ADR 0081).
 * The token belongs to the session, not to a club: it is registered for any
 * signed-in user, whatever the role (`PUT /v1/me/push-token`); signing out
 * deletes it on the server with the session. The person turns the pushes of
 * this phone off from the app (`DELETE`), and the system permission is asked
 * only when they turn them on, never at launch.
 */

/** This device can never get a push token (a simulator or emulator without push). */
export class PushUnavailableError extends Error {
  constructor(options?: { readonly cause?: unknown }) {
    super('This device gets no push token', options);
    this.name = 'PushUnavailableError';
  }
}

/** What the system says about notifications for this app. */
export interface PushPermission {
  readonly status: 'granted' | 'denied' | 'undetermined';
  /** The system can still show its prompt (`false`: only the phone's settings can change it). */
  readonly canAskAgain: boolean;
}

/** The notifications module of the phone (`expo-notifications`), behind an interface. */
export interface PushDevice {
  readonly platform: PushPlatform;
  /** The build can receive pushes: it has its EAS project id (the Expo token needs it). */
  readonly supported: boolean;
  getPermission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  /**
   * The Expo push token (`ExponentPushToken[…]`); rejects without it, with
   * `PushUnavailableError` when it can never come (a simulator without push).
   */
  getToken(): Promise<string>;
  /** The system handed a new token (reinstall, restore): register it again. */
  onTokenChange(listener: () => void): () => void;
  /** A tap on a push while the app runs or opens; `data` as the worker sent it. */
  onResponse(listener: (data: unknown) => void): () => void;
  /** The tap that opened the app from closed, once (`null` when it opened otherwise). */
  takeLaunchResponse(): Promise<unknown>;
  /** Opens the app's page of the phone's settings (to turn a denied permission on). */
  openSettings(): Promise<void>;
}

/**
 * - `unsupported`: this build or device has no push (no EAS project, a
 *   simulator that gets no token).
 * - `off`: the person turned the pushes of this phone off in the app.
 * - `needsPermission`: on, but the system never asked; `enable()` asks.
 * - `denied`: the system permission is off; only the phone's settings turn it on.
 * - `signedOut`: on and allowed, but nobody is signed in: the next session registers it.
 * - `pending`: on and allowed, but the server has not confirmed (no signal): retried.
 * - `registered`: the server has the token of this session.
 */
export type PushStatus =
  'unsupported' | 'off' | 'needsPermission' | 'denied' | 'signedOut' | 'pending' | 'registered';

export interface PushState {
  readonly status: PushStatus;
  /** A refresh is running (enabling, registering). */
  readonly busy: boolean;
}

export interface PushRegistrar {
  readonly getState: () => PushState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Brings the server in line with the phone: registers the token, or
   * deletes it when the person turned the pushes off. On launch, on a new
   * session, on a new token and on going back to the foreground (the
   * permission may have changed in the settings).
   */
  refresh(): Promise<void>;
  /** Turns the pushes of this phone on, asking the system permission if it can. */
  enable(): Promise<void>;
  /** Turns them off: the server forgets the token (when it can be reached). */
  disable(): Promise<void>;
  openSettings(): Promise<void>;
  dispose(): void;
}

export interface PushRegistrarOptions {
  readonly device: PushDevice;
  readonly api: Pick<ApiClient, 'registerMyPushToken' | 'unregisterMyPushToken'>;
  readonly preferences: PreferenceStorage;
  readonly session: {
    readonly getState: () => SessionState;
    readonly subscribe: (listener: () => void) => () => void;
  };
  readonly reportError?: (error: unknown) => void;
}

/** `on` / `off`: the person's choice for this phone. Absent: on once the system allows it. */
export const PUSH_DEVICE_PREFERENCE = 'push.device';
/** Set while a `DELETE` of the token could not reach the server. */
export const PUSH_UNREGISTER_PENDING = 'push.unregisterPending';

function signedInUser(state: SessionState): string | null {
  return state.status === 'signedIn' ? state.user.id : null;
}

export function createPushRegistrar(options: PushRegistrarOptions): PushRegistrar {
  const { device, api, preferences, session } = options;
  const report = options.reportError ?? (() => undefined);
  const listeners = new Set<() => void>();
  let state: PushState = {
    status: device.supported ? 'needsPermission' : 'unsupported',
    busy: false,
  };
  // `<user>:<token>` the server confirmed for the current session; reset by
  // every sign-in and sign-out (a new session needs its own registration).
  let registered: string | null = null;
  let running: Promise<void> | null = null;
  // Bumped by every refresh: one asked while another runs makes it run once more.
  let requested = 0;
  let lastUser = signedInUser(session.getState());
  // A token that does not come (no network for Expo's service) is reported
  // once, not on every refresh, until a token comes again.
  let tokenFailureReported = false;

  function setState(next: PushState): void {
    if (next.status === state.status && next.busy === state.busy) return;
    state = next;
    for (const listener of listeners) listener();
  }

  /** `true` when the server answered; a network error leaves it for the next refresh. */
  async function reach(call: () => Promise<void>): Promise<boolean> {
    try {
      await call();
      return true;
    } catch (error) {
      if (!(error instanceof ApiNetworkError)) report(error);
      return false;
    }
  }

  async function once(): Promise<PushStatus> {
    const userId = signedInUser(session.getState());
    const choice = await preferences.get(PUSH_DEVICE_PREFERENCE);
    if (choice === 'off') {
      if (userId !== null && (await preferences.get(PUSH_UNREGISTER_PENDING)) !== null) {
        if (await reach(() => api.unregisterMyPushToken())) {
          await preferences.remove(PUSH_UNREGISTER_PENDING);
        }
      }
      registered = null;
      return 'off';
    }
    if (!device.supported) return 'unsupported';
    const permission = await device.getPermission();
    if (permission.status !== 'granted') {
      return permission.status === 'denied' ? 'denied' : 'needsPermission';
    }
    // Signed out, the server has nothing of this phone (the session took its token).
    if (userId === null) return 'signedOut';
    let token: string;
    try {
      token = await device.getToken();
    } catch (error) {
      // A simulator without push: this build gets no notifications, nothing to report.
      if (error instanceof PushUnavailableError) return 'unsupported';
      // No network for Expo's token service: retried by the next refresh.
      if (!tokenFailureReported) report(error);
      tokenFailureReported = true;
      return 'pending';
    }
    tokenFailureReported = false;
    const key = `${userId}:${token}`;
    if (registered === key) return 'registered';
    const ok = await reach(() =>
      api.registerMyPushToken({ body: { token, platform: device.platform } }),
    );
    if (!ok) return 'pending';
    // Signed out or someone else signed in meanwhile: that session registers its own.
    const now = signedInUser(session.getState());
    if (now !== userId) return now === null ? 'signedOut' : 'pending';
    registered = key;
    return 'registered';
  }

  function refresh(): Promise<void> {
    requested += 1;
    if (running !== null) return running;
    setState({ ...state, busy: true });
    const run = (async () => {
      let status: PushStatus;
      let seen: number;
      do {
        seen = requested;
        try {
          status = await once();
        } catch (error) {
          report(error);
          status = 'pending';
        }
      } while (seen !== requested);
      setState({ status, busy: false });
    })().finally(() => {
      running = null;
    });
    running = run;
    return run;
  }

  const stopSession = session.subscribe(() => {
    const userId = signedInUser(session.getState());
    const current = session.getState().status;
    if (current === 'starting' || current === 'unavailable') return;
    if (userId === lastUser) return;
    lastUser = userId;
    registered = null;
    void refresh();
  });
  const stopToken = device.onTokenChange(() => {
    registered = null;
    void refresh();
  });

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    async enable() {
      await preferences.set(PUSH_DEVICE_PREFERENCE, 'on');
      await preferences.remove(PUSH_UNREGISTER_PENDING);
      if (device.supported) {
        const permission = await device.getPermission();
        if (permission.status !== 'granted' && permission.canAskAgain) {
          await device.requestPermission();
        }
      }
      await refresh();
    },
    async disable() {
      await preferences.set(PUSH_DEVICE_PREFERENCE, 'off');
      if (signedInUser(session.getState()) !== null) {
        await preferences.set(PUSH_UNREGISTER_PENDING, '1');
      }
      registered = null;
      await refresh();
    },
    openSettings: () => device.openSettings(),
    dispose() {
      stopSession();
      stopToken();
      listeners.clear();
    },
  };
}

/** A phone without push (tests, and the fallback when the module cannot load). */
export function unsupportedPushDevice(platform: PushPlatform = 'ios'): PushDevice {
  return {
    platform,
    supported: false,
    getPermission: () => Promise.resolve({ status: 'undetermined', canAskAgain: false }),
    requestPermission: () => Promise.resolve({ status: 'undetermined', canAskAgain: false }),
    getToken: () => Promise.reject(new Error('Push is not supported on this device')),
    onTokenChange: () => () => undefined,
    onResponse: () => () => undefined,
    takeLaunchResponse: () => Promise.resolve(null),
    openSettings: () => Promise.resolve(),
  };
}
