/**
 * Notifications from the API (B-328, ADR 0054) against Postgres 16: the push
 * token of the device bound to the sign-in session (moved when someone else
 * signs in on the same phone, gone with the session) and each user's own
 * preferences per club and role.
 */
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClub,
  createMembership,
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type SignedIn,
  type TestDatabase,
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface PreferenceBody {
  kind: string;
  push: boolean;
  email: boolean;
  isDefault: boolean;
}

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

function errorOf(response: LightMyRequestResponse) {
  return response.json<{ error: { code: string; details?: { path: unknown[] }[] } }>().error;
}

describeWithPostgres('notifications (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let clubA: ClubId;
  let clubB: ClubId;
  let coach: SignedIn;
  let coachInB: string;
  let player: SignedIn;
  let parent: SignedIn;

  const tokensOf = async (userId: string) =>
    (
      await database.admin.query<{ token: string; platform: string }>(
        'select token, platform from push_token where user_id = $1',
        [userId],
      )
    ).rows;

  const register = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'PUT', url: '/v1/me/push-token', headers, payload });
  const preferences = (headers: Record<string, string>) =>
    t.app.inject({ url: '/v1/me/notification-preferences', headers });
  const update = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    t.app.inject({
      method: 'PATCH',
      url: '/v1/me/notification-preferences',
      headers,
      payload,
    });

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
        write: {
          perIp: { name: 'api_write_ip', max: 10_000, windowS: 60 },
          perUser: { name: 'api_write_user', max: 10_000, windowS: 60 },
        },
      },
    });
    clubA = await createClub(database.admin, 'notif-a');
    clubB = await createClub(database.admin, 'notif-b');
    coach = await signIn(t, 'coach@notif.example.com', 'bearer');
    player = await signIn(t, 'jugador@notif.example.com', 'bearer');
    parent = await signIn(t, 'madre@notif.example.com', 'bearer');
    await createMembership(database.admin, coach.userId, clubA, 'coach');
    coachInB = await createMembership(database.admin, coach.userId, clubB, 'sc');
    await createMembership(database.admin, player.userId, clubA, 'player');
    await createMembership(database.admin, parent.userId, clubA, 'parent');
  }, 120_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('push token', () => {
    it('registers the token of this session, idempotently, without a club', async () => {
      // The coach has two memberships and sends none: the endpoint needs no club.
      const first = await register(coach.headers, { token: TOKEN, platform: 'ios' });
      expect(first.statusCode, first.body).toBe(204);
      const again = await register(coach.headers, { token: TOKEN, platform: 'ios' });
      expect(again.statusCode).toBe(204);
      expect(await tokensOf(coach.userId)).toEqual([{ token: TOKEN, platform: 'ios' }]);
    });

    it('rejects what is not an Expo push token', async () => {
      for (const token of [
        'fcm-token',
        'ExponentPushToken[]',
        `ExponentPushToken[${'a'.repeat(300)}]`,
      ]) {
        const response = await register(coach.headers, { token, platform: 'ios' });
        expect(response.statusCode, token).toBe(400);
        expect(errorOf(response).code).toBe('validation_failed');
      }
      const platform = await register(coach.headers, { token: TOKEN, platform: 'web' });
      expect(platform.statusCode).toBe(400);
    });

    it('moves the token to whoever signs in on the same device last', async () => {
      const response = await register(player.headers, { token: TOKEN, platform: 'android' });
      expect(response.statusCode).toBe(204);
      expect(await tokensOf(coach.userId)).toEqual([]);
      expect(await tokensOf(player.userId)).toEqual([{ token: TOKEN, platform: 'android' }]);
    });

    it('removes it on request, idempotently', async () => {
      const removed = await t.app.inject({
        method: 'DELETE',
        url: '/v1/me/push-token',
        headers: player.headers,
      });
      expect(removed.statusCode).toBe(204);
      expect(await tokensOf(player.userId)).toEqual([]);
      const again = await t.app.inject({
        method: 'DELETE',
        url: '/v1/me/push-token',
        headers: player.headers,
      });
      expect(again.statusCode).toBe(204);
    });

    it('goes with the session on sign out', async () => {
      const session = await signIn(t, 'jugador@notif.example.com', 'bearer');
      expect((await register(session.headers, { token: TOKEN, platform: 'ios' })).statusCode).toBe(
        204,
      );
      const out = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/sign-out',
        headers: session.headers,
      });
      expect(out.statusCode).toBeLessThan(300);
      expect(await tokensOf(player.userId)).toEqual([]);
    });

    it('needs a session', async () => {
      const response = await register({}, { token: TOKEN, platform: 'ios' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('preferences', () => {
    const inB = () => ({ ...coach.headers, 'x-membership-id': coachInB });

    it('starts at the defaults of the role', async () => {
      const response = await preferences(player.headers);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<{ items: PreferenceBody[] }>().items).toEqual([
        { kind: 'rpe_request', push: true, email: false, isDefault: true },
        { kind: 'rpe_reminder', push: true, email: false, isDefault: true },
      ]);
      const staff = await preferences(inB());
      expect(staff.json<{ items: PreferenceBody[] }>().items.map((p) => p.kind)).toEqual([
        'critical_alert',
        'pre_training_summary',
      ]);
      const guardian = await preferences(parent.headers);
      expect(guardian.json<{ items: PreferenceBody[] }>().items).toEqual([]);
    });

    it('changes only what is sent, per club, and goes back to following the default', async () => {
      const changed = await update(inB(), {
        preferences: [{ kind: 'critical_alert', email: false }],
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json<{ items: PreferenceBody[] }>().items[0]).toEqual({
        kind: 'critical_alert',
        push: true,
        email: false,
        isDefault: false,
      });
      const push = await update(inB(), { preferences: [{ kind: 'critical_alert', push: false }] });
      expect(push.json<{ items: PreferenceBody[] }>().items[0]).toMatchObject({
        push: false,
        email: false,
      });
      // The other club of the same user is untouched.
      const membershipA = (
        await database.admin.query<{ id: string }>(
          `select id from membership where user_id = $1 and club_id = $2`,
          [coach.userId, clubA],
        )
      ).rows[0]?.id;
      const inA = await preferences({ ...coach.headers, 'x-membership-id': membershipA ?? '' });
      expect(inA.json<{ items: PreferenceBody[] }>().items[0]?.isDefault).toBe(true);
      // Back to the defaults: stored as NULL.
      const back = await update(inB(), {
        preferences: [{ kind: 'critical_alert', push: true, email: true }],
      });
      expect(back.json<{ items: PreferenceBody[] }>().items[0]?.isDefault).toBe(true);
      const { rows } = await database.admin.query<{ push: boolean | null; email: boolean | null }>(
        `select push, email from notification_preference where user_id = $1 and club_id = $2`,
        [coach.userId, clubB],
      );
      expect(rows).toEqual([{ push: null, email: null }]);
    });

    it('rejects a kind the role does not receive, and repeated kinds', async () => {
      const response = await update(player.headers, {
        preferences: [{ kind: 'critical_alert', push: false }],
      });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).details?.[0]?.path).toEqual(['body', 'preferences', 0, 'kind']);
      const repeated = await update(player.headers, {
        preferences: [
          { kind: 'rpe_request', push: false },
          { kind: 'rpe_request', push: true },
        ],
      });
      expect(repeated.statusCode).toBe(400);
      const guardian = await update(parent.headers, {
        preferences: [{ kind: 'rpe_request', push: false }],
      });
      expect(guardian.statusCode).toBe(400);
    });

    it('needs a club', async () => {
      // Two memberships and no header: no club selected.
      const response = await preferences(coach.headers);
      expect(response.statusCode).toBe(403);
    });

    it('is not for a superadmin supporting the club: they are not a member', async () => {
      const superadmin = await signIn(t, 'soporte@notif.example.com', 'bearer');
      await database.admin.query('update "user" set is_superadmin = true where id = $1', [
        superadmin.userId,
      ]);
      const supporting = {
        ...superadmin.headers,
        'x-support-club-id': clubA,
        'x-support-reason': 'Revisión de un reclamo de notificaciones',
      };
      const read = await preferences(supporting);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json<{ items: PreferenceBody[] }>().items).toEqual([]);
      const response = await update(supporting, {
        preferences: [{ kind: 'critical_alert', push: false }],
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(errorOf(response).code).toBe('forbidden');
    });
  });
});
