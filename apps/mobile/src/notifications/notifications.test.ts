import { createApiClient, type MembershipSummary } from '@sport-performance/contracts';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN_KEY } from '../auth/session-store.ts';
import { memoryPreferenceStorage } from '../platform/storage.ts';
import type { SessionState } from '../state/session-controller.ts';
import { apiError, createFakeApi } from '../test/fake-api.ts';
import {
  COACH_AT_ORC,
  ORC_ID,
  OTHER_CLUB_ID,
  PLAYER_AT_OTHER,
  SESSION_TOKEN,
  USER,
  membership,
  signedInRoutes,
  testServices,
} from '../test/fixtures.ts';
import {
  PUSH_DEVICE_PREFERENCE,
  PUSH_UNREGISTER_PENDING,
  createPushRegistrar,
  PushUnavailableError,
  type PushDevice,
  type PushPermission,
} from './registration.ts';
import { membershipForPush, parsePushData, routeForPush, withTap } from './routing.ts';
import { createPushTapHandler } from './taps.ts';

const ALERT_ID = '0192e7a0-4444-7000-8000-000000000001';
const SESSION_ID = '0192e7a0-8888-7000-8000-000000000001';
const TOKEN = 'ExponentPushToken[abcdefghij0123456789]';
const ADMIN_AT_ORC = membership('a4444444-4444-4444-8444-444444444444', 'admin');

function signedIn(
  memberships: MembershipSummary[] = [COACH_AT_ORC],
  active: MembershipSummary | null = memberships[0] ?? null,
): SessionState {
  return {
    status: 'signedIn',
    user: { id: USER.id, name: USER.name, isSuperadmin: false },
    email: USER.email,
    memberships,
    activeMembership: active,
    clubNotice: null,
    offline: false,
  };
}

function fakeSession(initial: SessionState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectMembership: vi.fn((id: string) => {
      if (state.status === 'signedIn') {
        const next = state.memberships.find((m) => m.id === id) ?? null;
        state = { ...state, activeMembership: next };
        for (const listener of listeners) listener();
      }
      return Promise.resolve();
    }),
    set(next: SessionState) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('push data and routes (ADR 0054)', () => {
  it('reads what the worker sends and nothing else', () => {
    expect(
      parsePushData({
        kind: 'critical_alert',
        clubId: ORC_ID.toUpperCase(),
        path: `/alerts/${ALERT_ID}`,
      }),
    ).toEqual({ kind: 'critical_alert', clubId: ORC_ID, path: `/alerts/${ALERT_ID}` });
    expect(parsePushData(null)).toBeNull();
    expect(parsePushData({ kind: 'other', clubId: ORC_ID, path: '/' })).toBeNull();
    expect(parsePushData({ kind: 'critical_alert', clubId: 'orc', path: '/' })).toBeNull();
    expect(
      parsePushData({ kind: 'critical_alert', clubId: ORC_ID, path: 'x'.repeat(201) }),
    ).toBeNull();
  });

  it('each tap on the summary opens the board as a new opening, even of the same session', () => {
    const board = { pathname: '/staff', params: { sessionId: SESSION_ID } } as const;
    expect(withTap(board, 1)).toEqual({
      pathname: '/staff',
      params: { sessionId: SESSION_ID, tap: '1' },
    });
    expect(withTap(withTap(board, 1), 2)).toEqual({
      pathname: '/staff',
      params: { sessionId: SESSION_ID, tap: '2' },
    });
    const alert = { pathname: '/alerts/[alertId]', params: { alertId: ALERT_ID } } as const;
    expect(withTap(alert, 3)).toBe(alert);
  });

  it('opens the alert, the board of the session or home', () => {
    expect(
      routeForPush({ kind: 'critical_alert', clubId: ORC_ID, path: `/alerts/${ALERT_ID}` }),
    ).toEqual({
      pathname: '/alerts/[alertId]',
      params: { alertId: ALERT_ID },
    });
    expect(
      routeForPush({
        kind: 'pre_training_summary',
        clubId: ORC_ID,
        path: `/training-sessions/${SESSION_ID}`,
      }),
    ).toEqual({ pathname: '/staff', params: { sessionId: SESSION_ID } });
    // The player's RPE screen (B-503) takes this one: home until then.
    expect(
      routeForPush({
        kind: 'rpe_request',
        clubId: ORC_ID,
        path: `/training-sessions/${SESSION_ID}/rpe`,
      }),
    ).toEqual({ pathname: '/home' });
    expect(
      routeForPush({ kind: 'critical_alert', clubId: ORC_ID, path: '/alerts/not-a-uuid' }),
    ).toEqual({
      pathname: '/home',
    });
    expect(
      routeForPush({ kind: 'critical_alert', clubId: ORC_ID, path: `/alerts/${ALERT_ID}/x/y` }),
    ).toEqual({ pathname: '/home' });
    // A path that does not match its kind is not trusted.
    expect(
      routeForPush({ kind: 'rpe_request', clubId: ORC_ID, path: `/alerts/${ALERT_ID}` }),
    ).toEqual({
      pathname: '/home',
    });
  });

  it('acts in the membership the push is for', () => {
    const alert = { kind: 'critical_alert', clubId: ORC_ID, path: '/' } as const;
    expect(membershipForPush([COACH_AT_ORC, ADMIN_AT_ORC], ADMIN_AT_ORC, alert)).toBe(ADMIN_AT_ORC);
    expect(membershipForPush([PLAYER_AT_OTHER, COACH_AT_ORC], PLAYER_AT_OTHER, alert)).toBe(
      COACH_AT_ORC,
    );
    const rpe = { kind: 'rpe_request', clubId: OTHER_CLUB_ID, path: '/' } as const;
    expect(membershipForPush([COACH_AT_ORC, PLAYER_AT_OTHER], COACH_AT_ORC, rpe)).toBe(
      PLAYER_AT_OTHER,
    );
    expect(membershipForPush([COACH_AT_ORC], COACH_AT_ORC, rpe)).toBeNull();
  });
});

describe('a tap on a push', () => {
  it('switches club and opens the alert', async () => {
    const session = fakeSession(signedIn([PLAYER_AT_OTHER, COACH_AT_ORC], PLAYER_AT_OTHER));
    const navigate = vi.fn();
    const handler = createPushTapHandler({ session, navigate });
    handler.handle({ kind: 'critical_alert', clubId: ORC_ID, path: `/alerts/${ALERT_ID}` });
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    expect(session.selectMembership).toHaveBeenCalledWith(COACH_AT_ORC.id);
    // The layout opens it once the session shows the club it switched to.
    expect(navigate).toHaveBeenCalledWith(
      { pathname: '/alerts/[alertId]', params: { alertId: ALERT_ID } },
      COACH_AT_ORC.id,
    );
  });

  it('waits for the sign-in when the app opened from a push', () => {
    const session = fakeSession({ status: 'starting' });
    const navigate = vi.fn();
    const handler = createPushTapHandler({ session, navigate });
    handler.handle({
      kind: 'pre_training_summary',
      clubId: ORC_ID,
      path: `/training-sessions/${SESSION_ID}`,
    });
    expect(navigate).not.toHaveBeenCalled();
    session.set(signedIn());
    expect(navigate).toHaveBeenCalledWith(
      { pathname: '/staff', params: { sessionId: SESSION_ID } },
      expect.any(String),
    );
    // Once.
    session.set(signedIn());
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('opens home for data it does not understand or a club it is not in', () => {
    const session = fakeSession(signedIn());
    const navigate = vi.fn();
    const handler = createPushTapHandler({ session, navigate });
    handler.handle({ kind: 'nope' });
    handler.handle({ kind: 'critical_alert', clubId: OTHER_CLUB_ID, path: `/alerts/${ALERT_ID}` });
    expect(navigate).toHaveBeenNthCalledWith(1, { pathname: '/home' }, expect.any(String));
    expect(navigate).toHaveBeenNthCalledWith(2, { pathname: '/home' }, expect.any(String));
    expect(session.selectMembership).not.toHaveBeenCalled();
  });
});

function fakeDevice(permission: PushPermission, options: { supported?: boolean } = {}) {
  let current = permission;
  let tokenListener: (() => void) | null = null;
  let token = TOKEN;
  let tokenFails: Error | null = null;
  const requestSpy = vi.fn(() => {
    current = { status: 'granted', canAskAgain: true };
    return Promise.resolve(current);
  });
  const device: PushDevice & {
    readonly requestSpy: typeof requestSpy;
    readonly rotate: (next: string) => void;
    readonly setPermission: (next: PushPermission) => void;
    readonly setTokenFails: (error: Error | null) => void;
  } = {
    platform: 'android',
    supported: options.supported ?? true,
    getPermission: () => Promise.resolve(current),
    requestPermission: requestSpy,
    requestSpy,
    getToken: () => (tokenFails === null ? Promise.resolve(token) : Promise.reject(tokenFails)),
    onTokenChange(listener) {
      tokenListener = listener;
      return () => {
        tokenListener = null;
      };
    },
    onResponse: () => () => undefined,
    takeLaunchResponse: () => Promise.resolve(null),
    openSettings: () => Promise.resolve(),
    rotate: (next) => {
      token = next;
      tokenListener?.();
    },
    setPermission: (next) => {
      current = next;
    },
    setTokenFails: (error) => {
      tokenFails = error;
    },
  };
  return device;
}

function registrarSetup(
  permission: PushPermission,
  options: { supported?: boolean; state?: SessionState } = {},
) {
  const api = createFakeApi();
  api.on('PUT /v1/me/push-token', { status: 204 });
  api.on('DELETE /v1/me/push-token', { status: 204 });
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const device = fakeDevice(permission, options);
  const preferences = memoryPreferenceStorage();
  const session = fakeSession(options.state ?? signedIn());
  const errors: unknown[] = [];
  const registrar = createPushRegistrar({
    device,
    api: client,
    preferences,
    session,
    reportError: (error) => errors.push(error),
  });
  const calls = (route: string) =>
    api.requests.filter((request) => `${request.method} ${request.path}` === route);
  return { api, device, preferences, session, registrar, errors, calls };
}

const GRANTED: PushPermission = { status: 'granted', canAskAgain: true };
const UNDETERMINED: PushPermission = { status: 'undetermined', canAskAgain: true };

describe('the push token of this phone (B-510)', () => {
  it('registers the token of a phone that already allows notifications, once per session', async () => {
    const { registrar, calls } = registrarSetup(GRANTED);
    await registrar.refresh();
    await registrar.refresh();
    expect(registrar.getState()).toEqual({ status: 'registered', busy: false });
    expect(calls('PUT /v1/me/push-token').map((r) => r.body)).toEqual([
      { token: TOKEN, platform: 'android' },
    ]);
  });

  it('never asks the system at launch; turning them on does', async () => {
    const { registrar, device, calls } = registrarSetup(UNDETERMINED);
    await registrar.refresh();
    expect(registrar.getState().status).toBe('needsPermission');
    expect(device.requestSpy).not.toHaveBeenCalled();
    expect(calls('PUT /v1/me/push-token')).toHaveLength(0);
    await registrar.enable();
    expect(device.requestSpy).toHaveBeenCalledTimes(1);
    expect(registrar.getState().status).toBe('registered');
  });

  it('says when only the settings can turn them on', async () => {
    const { registrar, device } = registrarSetup({ status: 'denied', canAskAgain: false });
    await registrar.enable();
    expect(device.requestSpy).not.toHaveBeenCalled();
    expect(registrar.getState().status).toBe('denied');
  });

  it('retries a registration that got no answer', async () => {
    const { api, registrar, calls } = registrarSetup(GRANTED);
    api.setOffline(true);
    await registrar.refresh();
    expect(registrar.getState().status).toBe('pending');
    api.setOffline(false);
    await registrar.refresh();
    expect(registrar.getState().status).toBe('registered');
    expect(calls('PUT /v1/me/push-token')).toHaveLength(2);
  });

  it('reports a refusal of the server and stays pending', async () => {
    const { api, registrar, errors } = registrarSetup(GRANTED);
    api.on('PUT /v1/me/push-token', apiError(500, 'internal'));
    await registrar.refresh();
    expect(registrar.getState().status).toBe('pending');
    expect(errors).toHaveLength(1);
  });

  it('reports a token that does not come once, not on every refresh', async () => {
    const { device, registrar, errors } = registrarSetup(GRANTED);
    device.setTokenFails(new Error('No token service'));
    await registrar.refresh();
    await registrar.refresh();
    await registrar.refresh();
    expect(registrar.getState().status).toBe('pending');
    expect(errors).toHaveLength(1);
    device.setTokenFails(null);
    await registrar.refresh();
    expect(registrar.getState().status).toBe('registered');
    // After a token came, a new failure is news again.
    device.setTokenFails(new Error('No token service'));
    device.rotate(TOKEN);
    await vi.waitFor(() => {
      expect(errors).toHaveLength(2);
    });
  });

  it('a simulator that gets no token says this build gets no notifications, without reporting', async () => {
    const { device, registrar, errors, calls } = registrarSetup(GRANTED);
    device.setTokenFails(new PushUnavailableError());
    await registrar.refresh();
    await registrar.refresh();
    expect(registrar.getState()).toEqual({ status: 'unsupported', busy: false });
    expect(errors).toHaveLength(0);
    expect(calls('PUT /v1/me/push-token')).toHaveLength(0);
  });

  it('turning them off forgets the token on the server, also later without signal', async () => {
    const { api, registrar, preferences, calls } = registrarSetup(GRANTED);
    await registrar.refresh();
    api.setOffline(true);
    await registrar.disable();
    expect(registrar.getState().status).toBe('off');
    expect(await preferences.get(PUSH_DEVICE_PREFERENCE)).toBe('off');
    expect(await preferences.get(PUSH_UNREGISTER_PENDING)).toBe('1');
    api.setOffline(false);
    await registrar.refresh();
    expect(calls('DELETE /v1/me/push-token').length).toBeGreaterThanOrEqual(1);
    expect(await preferences.get(PUSH_UNREGISTER_PENDING)).toBeNull();
    // Off stays off: nothing registers again on its own.
    await registrar.refresh();
    expect(calls('PUT /v1/me/push-token')).toHaveLength(1);
  });

  it('registers again for a new session and a new token', async () => {
    const { registrar, session, device, calls } = registrarSetup(GRANTED);
    await registrar.refresh();
    session.set({ status: 'signedOut', notice: null });
    session.set(signedIn());
    await vi.waitFor(() => {
      expect(calls('PUT /v1/me/push-token')).toHaveLength(2);
    });
    device.rotate('ExponentPushToken[zzzzzzzzzz0123456789]');
    await vi.waitFor(() => {
      expect(calls('PUT /v1/me/push-token')).toHaveLength(3);
    });
    expect(calls('PUT /v1/me/push-token').at(-1)?.body).toEqual({
      token: 'ExponentPushToken[zzzzzzzzzz0123456789]',
      platform: 'android',
    });
  });

  it('does nothing on a build without push', async () => {
    const { registrar, calls } = registrarSetup(GRANTED, { supported: false });
    await registrar.enable();
    expect(registrar.getState().status).toBe('unsupported');
    expect(calls('PUT /v1/me/push-token')).toHaveLength(0);
  });

  it('signed out, nothing is sent', async () => {
    const { registrar, calls } = registrarSetup(GRANTED, {
      state: { status: 'signedOut', notice: null },
    });
    await registrar.refresh();
    expect(calls('PUT /v1/me/push-token')).toHaveLength(0);
    // Neutral: nothing failed, the next session registers it.
    expect(registrar.getState().status).toBe('signedOut');
  });
});

describe('the app services (wiring)', () => {
  it('registers the token with the bearer of the session once it is read', async () => {
    const { services, api } = testServices({
      secure: { [SESSION_TOKEN_KEY]: SESSION_TOKEN },
      push: fakeDevice(GRANTED),
    });
    signedInRoutes(api, [COACH_AT_ORC]);
    api.on('PUT /v1/me/push-token', { status: 204 });
    await services.session.start();
    await vi.waitFor(() => {
      expect(services.push.getState().status).toBe('registered');
    });
    const put = api.last('PUT /v1/me/push-token');
    expect(put?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(put?.body).toEqual({ token: TOKEN, platform: 'android' });
    services.dispose();
  });
});
