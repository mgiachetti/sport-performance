/**
 * Active sessions per device (B-333, ADR 0033) end to end against Postgres 16,
 * through the real roles: Better Auth and the session store on a login of
 * `sport_performance_auth`, the API on one of `sport_performance_app`.
 * Listing and closing sessions, `last_seen_at`, the device cookie, the
 * "new sign-in" email and closing the sessions of a member whose membership
 * ends.
 */
import { randomUUID } from 'node:crypto';
import { parseUuid, type ClubId, type Role, type UserId } from '@sport-performance/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClubAuthContext } from '../http/endpoint.js';
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
import { describeWithPostgres, testAuthContext } from '../testing/support.js';
import { revokeSessionsOfEndedMembership } from './member-sessions.js';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const APP_ANDROID = 'SportPerformance/1.4.0 (android; 15)';

interface Envelope {
  error: { code: string };
}

interface SessionDto {
  id: string;
  clientType: 'web' | 'mobile';
  device: { os: string | null; browser: string | null };
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

interface SessionPage {
  items: SessionDto[];
  nextCursor: string | null;
}

describeWithPostgres('active sessions per device (Better Auth + Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let n = 0;
  let email: string;

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    // Many sign-ins from one test IP: the sign-in limits are tested in sign-in.pg.test.ts.
    const roomy = { max: 10_000, windowS: 60 };
    t = await startIdentityApp(database, {
      limits: {
        signInCodeByIp: { name: 'sign_in_code_ip', ...roomy },
        signInCodeByEmail: { name: 'sign_in_code_email', ...roomy },
        verifyByIp: { name: 'verify_ip', ...roomy },
        verifyByEmail: { name: 'verify_email', ...roomy },
      },
      routeClassLimits: { auth: { perIp: { name: 'api_auth_ip', ...roomy } } },
    });
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  beforeEach(() => {
    n += 1;
    email = `sesiones${String(n)}@example.com`;
  });

  const list = async (who: SignedIn, query = '') => {
    const response = await t.app.inject({ url: `/v1/me/sessions${query}`, headers: who.headers });
    expect(response.statusCode).toBe(200);
    return response.json<SessionPage>();
  };
  const me = (who: SignedIn) => t.app.inject({ url: '/v1/me', headers: who.headers });
  const revoke = (who: SignedIn, sessionId: string) =>
    t.app.inject({ method: 'DELETE', url: `/v1/me/sessions/${sessionId}`, headers: who.headers });
  const sessionIdOf = async (who: SignedIn) =>
    (await list(who)).items.find((s) => s.current)?.id ?? '';
  const newSignInEmails = (address: string) =>
    t.emails.sent.filter((m) => m.to === address && m.kind === 'new_sign_in');

  describe('listing', () => {
    it('lists web and mobile sessions with their device, newest first, without IP or user agent', async () => {
      const web = await signIn(t, email, 'cookie', { userAgent: CHROME_MAC });
      const mobile = await signIn(t, email, 'bearer', {
        userAgent: APP_ANDROID,
        deviceId: randomUUID(),
      });

      const page = await list(mobile);
      expect(page.nextCursor).toBeNull();
      expect(page.items).toHaveLength(2);
      const [first, second] = page.items;
      expect(first).toMatchObject({
        clientType: 'mobile',
        device: { os: 'android', browser: 'app' },
        current: true,
      });
      expect(second).toMatchObject({
        clientType: 'web',
        device: { os: 'macos', browser: 'chrome' },
        current: false,
      });
      expect(Object.keys(first ?? {}).sort()).toEqual(
        ['clientType', 'createdAt', 'current', 'device', 'expiresAt', 'id', 'lastUsedAt'].sort(),
      );
      expect((await list(web)).items.map((s) => s.current)).toEqual([false, true]);

      const stored = await database.admin.query<{
        ip_address: string | null;
        user_agent: string | null;
      }>('select ip_address, user_agent from session where user_id = $1', [web.userId]);
      expect(stored.rows).toHaveLength(2);
      for (const row of stored.rows) {
        expect(row.ip_address ?? '').toBe('');
        expect(row.user_agent ?? '').toBe('');
      }
    });

    it('pages with an opaque cursor and rejects a forged one', async () => {
      await signIn(t, email, 'bearer');
      await signIn(t, email, 'bearer');
      const who = await signIn(t, email, 'bearer');
      const first = await list(who, '?limit=2');
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await list(who, `?limit=2&cursor=${first.nextCursor ?? ''}`);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      const ids = [...first.items, ...second.items].map((s) => s.id);
      expect(new Set(ids).size).toBe(3);

      // Oldest first on request (ADR 0032), paged the same way; a cursor of the other order is rejected.
      const ascending = await list(who, '?limit=2&sort=createdAt');
      const rest = await list(who, `?limit=2&sort=createdAt&cursor=${ascending.nextCursor ?? ''}`);
      expect([...ascending.items, ...rest.items].map((s) => s.id)).toEqual([...ids].reverse());
      const mixed = await t.app.inject({
        url: `/v1/me/sessions?cursor=${first.nextCursor ?? ''}&sort=createdAt`,
        headers: who.headers,
      });
      expect(mixed.statusCode).toBe(400);

      const forged = await t.app.inject({
        url: '/v1/me/sessions?cursor=bm9wZQ',
        headers: who.headers,
      });
      expect(forged.statusCode).toBe(400);
      expect(forged.json<Envelope>().error.code).toBe('bad_request');
    });

    it('does not list expired sessions and needs a session', async () => {
      const old = await signIn(t, email, 'bearer');
      const current = await signIn(t, email, 'bearer');
      await database.admin.query(
        "update session set expires_at = now() - interval '1 second' where id = $1",
        [await sessionIdOf(old)],
      );
      expect((await list(current)).items).toHaveLength(1);
      expect((await t.app.inject({ url: '/v1/me/sessions' })).statusCode).toBe(401);
    });

    it('refreshes the last use at most every 5 minutes', async () => {
      const who = await signIn(t, email, 'bearer');
      const id = await sessionIdOf(who);
      const lastSeen = async () =>
        (
          await database.admin.query<{ last_seen_at: Date }>(
            'select last_seen_at from session where id = $1',
            [id],
          )
        ).rows[0]?.last_seen_at.getTime();

      await database.admin.query(
        "update session set last_seen_at = now() - interval '1 hour' where id = $1",
        [id],
      );
      const stale = await lastSeen();
      expect((await me(who)).statusCode).toBe(200);
      const refreshed = await lastSeen();
      expect(refreshed).toBeGreaterThan((stale ?? 0) + 50 * 60 * 1000);

      await database.admin.query(
        "update session set last_seen_at = now() - interval '1 minute' where id = $1",
        [id],
      );
      const recent = await lastSeen();
      expect((await me(who)).statusCode).toBe(200);
      expect(await lastSeen()).toBe(recent);
    });
  });

  describe('closing sessions', () => {
    it('closes another session of the user immediately', async () => {
      const lost = await signIn(t, email, 'bearer');
      const current = await signIn(t, email, 'cookie');
      const lostId = await sessionIdOf(lost);

      const response = await revoke(current, lostId);
      expect(response.statusCode).toBe(204);
      expect((await me(lost)).statusCode).toBe(401);
      expect((await me(current)).statusCode).toBe(200);
      expect((await revoke(current, lostId)).statusCode).toBe(404);
    });

    it('does not close the current session (sign-out does) nor another user’s', async () => {
      const mine = await signIn(t, email, 'bearer');
      const theirs = await signIn(t, `otro-${email}`, 'bearer');

      const current = await revoke(mine, await sessionIdOf(mine));
      expect(current.statusCode).toBe(409);
      expect(current.json<Envelope>().error.code).toBe('conflict');

      const other = await revoke(mine, await sessionIdOf(theirs));
      expect(other.statusCode).toBe(404);
      expect((await me(theirs)).statusCode).toBe(200);

      const unknown = await revoke(mine, randomUUID());
      expect(unknown.statusCode).toBe(404);
      const invalid = await revoke(mine, 'not-a-session');
      expect(invalid.statusCode).toBe(400);
    });

    it('closes every other session and keeps the current one', async () => {
      const a = await signIn(t, email, 'cookie');
      const b = await signIn(t, email, 'bearer');
      const current = await signIn(t, email, 'bearer');
      const someoneElse = await signIn(t, `otro-${email}`, 'bearer');

      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/me/sessions/revoke-others',
        headers: current.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ revoked: 2 });
      expect((await me(a)).statusCode).toBe(401);
      expect((await me(b)).statusCode).toBe(401);
      expect((await me(current)).statusCode).toBe(200);
      expect((await me(someoneElse)).statusCode).toBe(200);
      expect((await list(current)).items.map((s) => s.current)).toEqual([true]);
    });
  });

  describe('new sign-in notice', () => {
    it('does not notify the sign-in that creates the account', async () => {
      await signIn(t, email, 'cookie', { userAgent: CHROME_MAC });
      expect(newSignInEmails(email)).toEqual([]);
    });

    it('notifies a sign-in from a new browser, not from a known one', async () => {
      const first = await signIn(t, email, 'cookie', { userAgent: CHROME_MAC });
      const device = first.response.cookies.find((c) => c.name === 'sp.device_id');
      expect(device).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/v1/auth' });
      expect(device?.maxAge).toBe(400 * 24 * 60 * 60);

      // Same browser (it sends its device cookie): no notice.
      await signIn(t, email, 'cookie', {
        userAgent: CHROME_MAC,
        cookie: `sp.device_id=${device?.value ?? ''}`,
      });
      expect(newSignInEmails(email)).toEqual([]);

      // Another browser: notice, in Rioplatense Spanish, with the device and no link.
      await signIn(t, email, 'cookie', { userAgent: SAFARI_IPHONE });
      const [notice] = newSignInEmails(email);
      expect(notice?.subject).toBe('Ingreso nuevo a tu cuenta');
      expect(notice?.text).toContain('Safari en iOS');
      expect(notice?.text).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
      expect(notice?.text).toContain('Si fuiste vos, no tenés que hacer nada.');
      expect(notice?.html).toContain('lang="es-AR"');
      expect(notice?.html).not.toContain('href=');
    });

    it('recognizes the app by its device id, and notifies every sign-in without one', async () => {
      await signIn(t, email, 'cookie');
      const deviceId = randomUUID();
      await signIn(t, email, 'bearer', { userAgent: APP_ANDROID, deviceId });
      expect(newSignInEmails(email)).toHaveLength(1);
      expect(newSignInEmails(email)[0]?.text).toContain('la app en Android');
      await signIn(t, email, 'bearer', { userAgent: APP_ANDROID, deviceId });
      expect(newSignInEmails(email)).toHaveLength(1);
      await signIn(t, email, 'bearer');
      await signIn(t, email, 'bearer');
      expect(newSignInEmails(email)).toHaveLength(3);

      const stored = await database.admin.query<{ device_hash: string }>(
        'select device_hash from known_device kd join "user" u on u.id = kd.user_id where u.email = $1',
        [email],
      );
      expect(stored.rows.map((r) => r.device_hash)).not.toContain(deviceId);
      expect(stored.rows.every((r) => /^[0-9a-f]{64}$/.test(r.device_hash))).toBe(true);
    });

    it('treats a device unused for 400 days as new', async () => {
      await signIn(t, email, 'cookie');
      const deviceId = randomUUID();
      const who = await signIn(t, email, 'bearer', { deviceId });
      expect(newSignInEmails(email)).toHaveLength(1);
      await database.admin.query(
        "update known_device set last_seen_at = now() - interval '401 days' where user_id = $1",
        [who.userId],
      );
      await signIn(t, email, 'bearer', { deviceId });
      expect(newSignInEmails(email)).toHaveLength(2);
    });

    it('still signs in when the notice cannot be sent', async () => {
      await signIn(t, email, 'cookie');
      await t.app.inject({ method: 'POST', url: '/v1/auth/email-otp', payload: { email } });
      const message = t.emails.lastTo(email);
      const code = /\b(\d{6})\b/.exec(message?.subject ?? '')?.[1] ?? '';
      t.emails.failing = true;
      try {
        const response = await t.app.inject({
          method: 'POST',
          url: '/v1/auth/email-otp/verify',
          payload: { email, code, transport: 'bearer' },
        });
        expect(response.statusCode).toBe(200);
      } finally {
        t.emails.failing = false;
      }
    });
  });

  describe('ending a membership', () => {
    let clubA: ClubId;
    let clubB: ClubId;
    let admin: SignedIn;
    let adminMembershipId: string;

    const adminOf = (clubId: ClubId, userId: UserId, membershipId: string, role: Role = 'admin') =>
      testAuthContext(userId, { clubId, role, membershipId }) as ClubAuthContext;
    const endMembership = (membershipId: string) =>
      database.admin.query('update membership set ended_at = now() where id = $1', [membershipId]);

    beforeAll(async () => {
      clubA = await createClub(database.admin, 'club-baja-a');
      clubB = await createClub(database.admin, 'club-baja-b');
      admin = await signIn(t, 'admin-baja@example.com', 'bearer');
      adminMembershipId = await createMembership(database.admin, admin.userId, clubA, 'admin');
    });

    it('closes every session of a member who keeps no other membership', async () => {
      const web = await signIn(t, email, 'cookie');
      const mobile = await signIn(t, email, 'bearer');
      const membershipId = await createMembership(database.admin, web.userId, clubA, 'coach');
      await endMembership(membershipId);

      const result = await revokeSessionsOfEndedMembership(
        t.auth,
        adminOf(clubA, admin.userId, adminMembershipId),
        membershipId,
      );
      expect(result).toEqual({ outcome: 'revoked', revoked: 2 });
      expect((await me(web)).statusCode).toBe(401);
      expect((await me(mobile)).statusCode).toBe(401);
      expect((await me(admin)).statusCode).toBe(200);
    });

    it('works before the membership is ended too (same transaction as the end)', async () => {
      const member = await signIn(t, email, 'bearer');
      const membershipId = await createMembership(database.admin, member.userId, clubA, 'player');
      const result = await revokeSessionsOfEndedMembership(
        t.auth,
        adminOf(clubA, admin.userId, adminMembershipId),
        membershipId,
      );
      expect(result).toEqual({ outcome: 'revoked', revoked: 1 });
    });

    it('keeps the sessions of a member of another club', async () => {
      const member = await signIn(t, email, 'bearer');
      const membershipId = await createMembership(database.admin, member.userId, clubA, 'coach');
      await createMembership(database.admin, member.userId, clubB, 'parent');
      await endMembership(membershipId);

      const result = await revokeSessionsOfEndedMembership(
        t.auth,
        adminOf(clubA, admin.userId, adminMembershipId),
        membershipId,
      );
      expect(result).toEqual({ outcome: 'kept_other_memberships', revoked: 0 });
      const after = await me(member);
      expect(after.statusCode).toBe(200);
    });

    it('keeps the sessions of a superadmin', async () => {
      const member = await signIn(t, email, 'bearer');
      await database.admin.query('update "user" set is_superadmin = true where id = $1', [
        member.userId,
      ]);
      const membershipId = await createMembership(database.admin, member.userId, clubA, 'sc');
      await endMembership(membershipId);
      const result = await revokeSessionsOfEndedMembership(
        t.auth,
        adminOf(clubA, admin.userId, adminMembershipId),
        membershipId,
      );
      expect(result).toEqual({ outcome: 'kept_superadmin', revoked: 0 });
      expect((await me(member)).statusCode).toBe(200);
    });

    it('is only for an admin of the club, and only for memberships of that club', async () => {
      const member = await signIn(t, email, 'bearer');
      const coach = await signIn(t, `coach-${email}`, 'bearer');
      const coachMembershipId = await createMembership(
        database.admin,
        coach.userId,
        clubA,
        'coach',
      );
      const inA = await createMembership(database.admin, member.userId, clubA, 'player');
      const inB = await createMembership(database.admin, member.userId, clubB, 'player');

      await expect(
        revokeSessionsOfEndedMembership(
          t.auth,
          adminOf(clubA, coach.userId, coachMembershipId, 'coach'),
          inA,
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        revokeSessionsOfEndedMembership(
          t.auth,
          adminOf(clubA, admin.userId, adminMembershipId),
          inB,
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
      await expect(
        revokeSessionsOfEndedMembership(
          t.auth,
          adminOf(clubA, admin.userId, adminMembershipId),
          parseUuid(randomUUID()),
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect((await me(member)).statusCode).toBe(200);
    });
  });

  it('prunes expired sessions and forgotten devices', async () => {
    const who = await signIn(t, email, 'bearer', { deviceId: randomUUID() });
    await database.admin.query(
      "update session set expires_at = now() - interval '1 second' where user_id = $1",
      [who.userId],
    );
    await database.admin.query(
      "update known_device set last_seen_at = now() - interval '401 days' where user_id = $1",
      [who.userId],
    );
    const pruned = await t.auth.sessions.prune();
    expect(pruned.sessions).toBeGreaterThanOrEqual(1);
    expect(pruned.devices).toBeGreaterThanOrEqual(1);
    const left = await database.admin.query(
      'select 1 from session where user_id = $1 union all select 1 from known_device where user_id = $1',
      [who.userId],
    );
    expect(left.rows).toEqual([]);
  });
});
