import { ApiError } from '@sport-performance/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_ID_KEY,
  MEMBERSHIP_ID_KEY,
  SESSION_SNAPSHOT_KEY,
  SESSION_TOKEN_KEY,
} from '../auth/session-store.ts';
import { apiError } from '../test/fake-api.ts';
import {
  COACH_AT_ORC,
  DEVICE_ID,
  PARENT_AT_ORC,
  PLAYER_AT_OTHER,
  SESSION_TOKEN,
  USER,
  signedInRoutes,
  testServices,
} from '../test/fixtures.ts';

const signedInSecure = { [SESSION_TOKEN_KEY]: SESSION_TOKEN };

describe('session controller: launch', () => {
  it('is signed out without a stored token', async () => {
    const { services } = testServices();
    await services.session.start();
    expect(services.session.getState()).toEqual({ status: 'signedOut', notice: null });
  });

  it('enters the only club directly and remembers it', async () => {
    const { services, api, secure } = testServices({ secure: signedInSecure });
    signedInRoutes(api, [COACH_AT_ORC]);
    await services.session.start();
    const state = services.session.getState();
    expect(state).toMatchObject({
      status: 'signedIn',
      email: USER.email,
      activeMembership: COACH_AT_ORC,
      offline: false,
    });
    expect(secure.entries.get(MEMBERSHIP_ID_KEY)).toBe(COACH_AT_ORC.id);
    expect(api.last('GET /v1/me')?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('asks to choose with several clubs and keeps a valid stored choice', async () => {
    const first = testServices({ secure: signedInSecure });
    signedInRoutes(first.api, [COACH_AT_ORC, PLAYER_AT_OTHER]);
    await first.services.session.start();
    expect(first.services.session.getState()).toMatchObject({ activeMembership: null });

    const second = testServices({
      secure: { ...signedInSecure, [MEMBERSHIP_ID_KEY]: PLAYER_AT_OTHER.id },
    });
    signedInRoutes(second.api, [COACH_AT_ORC, PLAYER_AT_OTHER]);
    await second.services.session.start();
    expect(second.services.session.getState()).toMatchObject({
      activeMembership: PLAYER_AT_OTHER,
      clubNotice: null,
    });
    expect(second.api.last('GET /v1/me')?.headers['x-membership-id']).toBe(PLAYER_AT_OTHER.id);
  });

  it('opens offline from the snapshot of the last session, without the email', async () => {
    const online = testServices({ secure: signedInSecure });
    signedInRoutes(online.api, [COACH_AT_ORC, PARENT_AT_ORC]);
    await online.services.session.start();
    await online.services.session.selectMembership(PARENT_AT_ORC.id);
    const snapshot = online.secure.entries.get(SESSION_SNAPSHOT_KEY);
    expect(snapshot).toBeDefined();
    expect(snapshot).not.toContain(USER.email);

    const offline = testServices({ secure: Object.fromEntries(online.secure.entries) });
    offline.api.setOffline(true);
    await offline.services.session.start();
    expect(offline.services.session.getState()).toMatchObject({
      status: 'signedIn',
      email: null,
      offline: true,
      activeMembership: PARENT_AT_ORC,
    });
    expect(offline.errors).toEqual([]);
  });

  it('is unavailable with a session, nothing cached and no signal', async () => {
    const { services, api } = testServices({ secure: signedInSecure });
    api.setOffline(true);
    await services.session.start();
    expect(services.session.getState()).toEqual({ status: 'unavailable' });
    api.setOffline(false);
    signedInRoutes(api, [COACH_AT_ORC]);
    await services.session.refresh();
    expect(services.session.getState()).toMatchObject({ status: 'signedIn' });
  });

  it('signs out with a notice when the stored session expired', async () => {
    const { services, api, secure } = testServices({
      secure: {
        ...signedInSecure,
        [MEMBERSHIP_ID_KEY]: COACH_AT_ORC.id,
        [DEVICE_ID_KEY]: DEVICE_ID,
      },
    });
    api.on('GET /v1/me', apiError(401, 'unauthenticated'));
    api.on('GET /v1/me/memberships', apiError(401, 'unauthenticated'));
    await services.session.start();
    expect(services.session.getState()).toEqual({ status: 'signedOut', notice: 'sessionExpired' });
    expect(secure.entries.has(SESSION_TOKEN_KEY)).toBe(false);
    expect(secure.entries.has(MEMBERSHIP_ID_KEY)).toBe(false);
    // The installation id identifies the device, not the user.
    expect(secure.entries.get(DEVICE_ID_KEY)).toBe(DEVICE_ID);
  });
});

describe('session controller: sign-in', () => {
  it('asks for a code and verifies it as a bearer session with the installation id', async () => {
    const { services, api, secure } = testServices();
    api.on('POST /v1/auth/email-otp', { status: 202, body: { expiresInS: 300 } });
    api.on('POST /v1/auth/email-otp/verify', {
      status: 200,
      body: {
        user: USER,
        session: { expiresAt: '2026-12-01T12:00:00.000Z', token: SESSION_TOKEN },
      },
    });
    signedInRoutes(api, [COACH_AT_ORC]);
    await services.session.start();

    await expect(services.session.requestCode(' ana@example.com ')).resolves.toBe(300);
    expect(api.last('POST /v1/auth/email-otp')?.body).toEqual({ email: 'ana@example.com' });

    await services.session.verifyCode('ana@example.com', '482913');
    expect(api.last('POST /v1/auth/email-otp/verify')?.body).toEqual({
      email: 'ana@example.com',
      code: '482913',
      transport: 'bearer',
      deviceId: DEVICE_ID,
    });
    expect(api.last('POST /v1/auth/email-otp/verify')?.headers.authorization).toBeUndefined();
    expect(secure.entries.get(SESSION_TOKEN_KEY)).toBe(SESSION_TOKEN);
    expect(services.session.getState()).toMatchObject({
      status: 'signedIn',
      activeMembership: COACH_AT_ORC,
    });
  });

  it('keeps the user signed out on a wrong code (no session-expired notice)', async () => {
    const { services, api } = testServices();
    api.on('POST /v1/auth/email-otp/verify', apiError(401, 'unauthenticated'));
    await services.session.start();
    await expect(services.session.verifyCode('ana@example.com', '000000')).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(services.session.getState()).toEqual({ status: 'signedOut', notice: null });
  });

  it('redeems a guardian code or link for a player session', async () => {
    const { services, api, secure } = testServices();
    api.on('POST /v1/auth/player-access', {
      status: 200,
      body: {
        user: USER,
        session: { expiresAt: '2026-12-01T12:00:00.000Z', token: SESSION_TOKEN },
      },
    });
    signedInRoutes(api, [PLAYER_AT_OTHER]);
    await services.session.start();
    await services.session.redeemPlayerAccess({ code: ' K7QM-2XPA ' });
    expect(api.last('POST /v1/auth/player-access')?.body).toEqual({
      code: 'K7QM-2XPA',
      deviceId: DEVICE_ID,
    });
    expect(secure.entries.get(SESSION_TOKEN_KEY)).toBe(SESSION_TOKEN);
    expect(services.session.getState()).toMatchObject({ activeMembership: PLAYER_AT_OTHER });
  });

  it('forgets the club chosen by the previous user on a new sign-in', async () => {
    const { services, api, secure } = testServices({
      secure: { [MEMBERSHIP_ID_KEY]: PLAYER_AT_OTHER.id },
    });
    api.on('POST /v1/auth/email-otp/verify', {
      status: 200,
      body: {
        user: USER,
        session: { expiresAt: '2026-12-01T12:00:00.000Z', token: SESSION_TOKEN },
      },
    });
    signedInRoutes(api, [COACH_AT_ORC, PLAYER_AT_OTHER]);
    await services.session.start();
    await services.session.verifyCode('ana@example.com', '482913');
    expect(secure.entries.has(MEMBERSHIP_ID_KEY)).toBe(false);
    expect(services.session.getState()).toMatchObject({ activeMembership: null });
  });
});

describe('session controller: clubs and sign-out', () => {
  async function signedInWith(memberships = [COACH_AT_ORC, PLAYER_AT_OTHER]) {
    const context = testServices({ secure: signedInSecure });
    signedInRoutes(context.api, memberships);
    await context.services.session.start();
    return context;
  }

  it('selects a club, sends it in X-Membership-Id and goes back to the selector', async () => {
    const { services, api, secure } = await signedInWith();
    await services.session.selectMembership(COACH_AT_ORC.id);
    expect(secure.entries.get(MEMBERSHIP_ID_KEY)).toBe(COACH_AT_ORC.id);
    api.on('GET /v1/players', { status: 200, body: { items: [], nextCursor: null } });
    await services.api.client.listPlayers().catch(() => undefined);
    expect(api.last('GET /v1/players')?.headers['x-membership-id']).toBe(COACH_AT_ORC.id);

    await services.session.chooseAnotherClub();
    expect(services.session.getState()).toMatchObject({ activeMembership: null });
    expect(secure.entries.has(MEMBERSHIP_ID_KEY)).toBe(false);
  });

  it('keeps the club on a 403 of a resource, and leaves it when the membership closed', async () => {
    const { services, api } = await signedInWith();
    await services.session.selectMembership(COACH_AT_ORC.id);
    api.on('GET /v1/players', apiError(403, 'forbidden'));

    await expect(services.api.client.listPlayers()).rejects.toBeInstanceOf(ApiError);
    await services.session.refresh();
    expect(services.session.getState()).toMatchObject({ activeMembership: COACH_AT_ORC });

    signedInRoutes(api, [PLAYER_AT_OTHER, PARENT_AT_ORC]);
    await expect(services.api.client.listPlayers()).rejects.toBeInstanceOf(ApiError);
    await services.session.refresh();
    expect(services.session.getState()).toMatchObject({
      activeMembership: null,
      clubNotice: 'membershipLost',
    });
  });

  it('signs out on a 401 of any authenticated call', async () => {
    const { services, api } = await signedInWith([COACH_AT_ORC]);
    api.on('GET /v1/players', apiError(401, 'unauthenticated'));
    await expect(services.api.client.listPlayers()).rejects.toBeInstanceOf(ApiError);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(services.session.getState()).toEqual({ status: 'signedOut', notice: 'sessionExpired' });
  });

  it('accepts an invitation and acts in its club', async () => {
    const { services, api, secure } = await signedInWith([COACH_AT_ORC]);
    api.on('POST /v1/invitations/accept', { status: 200, body: { membership: PLAYER_AT_OTHER } });
    signedInRoutes(api, [COACH_AT_ORC, PLAYER_AT_OTHER]);
    services.session.pendingInvitation.set('token');
    await services.session.acceptInvitation('k'.repeat(43));
    expect(secure.entries.get(MEMBERSHIP_ID_KEY)).toBe(PLAYER_AT_OTHER.id);
    expect(services.session.getState()).toMatchObject({ activeMembership: PLAYER_AT_OTHER });
    expect(services.session.pendingInvitation.get()).toBeNull();
  });

  it('signs out on the server and forgets the session even offline', async () => {
    const online = await signedInWith([COACH_AT_ORC]);
    online.api.on('POST /v1/auth/sign-out', { status: 204 });
    await online.services.session.signOut();
    expect(online.api.last('POST /v1/auth/sign-out')?.headers.authorization).toBe(
      `Bearer ${SESSION_TOKEN}`,
    );
    expect(online.services.session.getState()).toEqual({ status: 'signedOut', notice: null });
    expect(online.secure.entries.has(SESSION_TOKEN_KEY)).toBe(false);

    const offline = await signedInWith([COACH_AT_ORC]);
    offline.api.setOffline(true);
    await offline.services.session.signOut();
    expect(offline.services.session.getState()).toEqual({ status: 'signedOut', notice: null });
    expect(offline.secure.entries.has(SESSION_TOKEN_KEY)).toBe(false);
    expect(offline.secure.entries.has(SESSION_SNAPSHOT_KEY)).toBe(false);
    expect(offline.errors).toEqual([]);
  });
});
