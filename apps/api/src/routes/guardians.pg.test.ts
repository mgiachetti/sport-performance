/**
 * Guardians and accounts of minors end to end (B-310, ADR 0042) against
 * Postgres 16, through the real connection roles (ADR 0026): guardian links,
 * a guardian's children, the invitation of a child by email and the access of
 * a child without email by a single-use code or link, with the permission
 * matrix in the handlers (ADR 0025), RLS behind it and the endpoint
 * conventions (ADR 0032).
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCategory,
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

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface LinkBody {
  id: string;
  playerId: string;
  guardian: { userId: string; name: string | null; email: string | null };
  relationship: string;
  validFrom: string;
  validTo: string | null;
  current: boolean;
  version: string;
}

interface ChildBody {
  playerId: string;
  firstName: string;
  ofAge: boolean;
  guardianId: string;
  relationship: string;
  hasAccount: boolean;
  canManageAccess: boolean;
}

interface IssuedBody {
  accessCode: { id: string; status: string; expiresAt: string; issuedBy: { userId: string } };
  code: string;
  links: { app: string; web: string };
}

interface SignedInBody {
  user: { id: string; email: string; name: string };
  session: { token: string; expiresAt: string };
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const errorOf = (response: LightMyRequestResponse) => response.json<Envelope>().error;
const tokenOf = (link: string) => link.slice(link.lastIndexOf('/') + 1);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const ROUTE_LIMITS = {
  auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
  write: {
    perIp: { name: 'api_write_ip', max: 10_000, windowS: 60 },
    perUser: { name: 'api_write_user', max: 10_000, windowS: 60 },
  },
};

describeWithPostgres('guardians and accounts of minors (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let clubA: ClubId;
  let clubB: ClubId;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachA: SignedIn;
  let motherA: SignedIn;
  let fatherA: SignedIn;
  let motherMembership: string;
  let fatherMembership: string;
  let coachMembership: string;
  /** Minor without email. */
  let sofia: string;
  /** Minor invited by email. */
  let tomas: string;
  /** Of age. */
  let martin: string;
  /** Club B. */
  let lucia: string;
  let motherLink: LinkBody;

  async function insertPlayer(clubId: ClubId, firstName: string, birthDate: string) {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Gómez', $3, 'female', 'rugby', '2024-03-01') returning id`,
      [clubId, firstName, birthDate],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('player not created');
    return id;
  }

  const get = (url: string, caller: { headers: Record<string, string> }) =>
    t.app.inject({ url, headers: caller.headers });
  const post = (url: string, caller: { headers: Record<string, string> }, payload?: object) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: caller.headers,
      ...(payload !== undefined && { payload }),
    });
  const issue = (caller: SignedIn, playerId: string) =>
    post(`/v1/players/${playerId}/access-codes`, caller);
  const redeem = (payload: object, app = t) =>
    app.app.inject({ method: 'POST', url: '/v1/auth/player-access', payload });

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, { routeClassLimits: ROUTE_LIMITS });
    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    const m15 = await createCategory(database.admin, clubA, 'M15');
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    motherA = await signIn(t, 'mama@example.com');
    fatherA = await signIn(t, 'papa@example.com');
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    motherMembership = await createMembership(database.admin, motherA.userId, clubA, 'parent');
    fatherMembership = await createMembership(database.admin, fatherA.userId, clubA, 'parent');
    sofia = await insertPlayer(clubA, 'Sofía', '2013-08-10');
    tomas = await insertPlayer(clubA, 'Tomás', '2012-02-02');
    martin = await insertPlayer(clubA, 'Martín', '2000-01-01');
    lucia = await insertPlayer(clubB, 'Lucía', '2013-01-01');
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2024-03-01')`,
      [clubA, sofia, m15],
    );
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2024-03-01')`,
      [clubA, coachMembership, m15],
    );
    // The father of Tomás and Martín (the adult), linked as the owner.
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $4, 'father', '2024-03-01'), ($1, $3, $4, 'father', '2024-03-01')`,
      [clubA, tomas, martin, fatherA.userId],
    );
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('guardian links', () => {
    const linkUuid = randomUUID();

    it('the administration links a parent membership, idempotently by clientUuid', async () => {
      const payload = {
        clientUuid: linkUuid,
        membershipId: motherMembership,
        relationship: 'mother',
      };
      const created = await post(`/v1/players/${sofia}/guardians`, adminA, payload);
      expect(created.statusCode, created.body).toBe(201);
      motherLink = created.json<LinkBody>();
      expect(motherLink).toMatchObject({
        playerId: sofia,
        guardian: { userId: motherA.userId, email: 'mama@example.com' },
        relationship: 'mother',
        validTo: null,
        current: true,
      });
      const replay = await post(`/v1/players/${sofia}/guardians`, adminA, payload);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<LinkBody>().id).toBe(motherLink.id);
      // The same open link again (another create): conflict.
      const again = await post(`/v1/players/${sofia}/guardians`, adminA, {
        membershipId: motherMembership,
        relationship: 'mother',
      });
      expect(again.statusCode).toBe(409);
    });

    it('only links active parent memberships, and only the administration does', async () => {
      const notParent = await post(`/v1/players/${sofia}/guardians`, adminA, {
        membershipId: coachMembership,
        relationship: 'other',
      });
      expect(notParent.statusCode).toBe(400);
      expect(errorOf(notParent).details?.[0]?.path).toEqual(['body', 'membershipId']);
      for (const caller of [motherA, coachA]) {
        const denied = await post(`/v1/players/${sofia}/guardians`, caller, {
          membershipId: fatherMembership,
          relationship: 'father',
        });
        expect(denied.statusCode).toBe(403);
        expect(errorOf(denied).message).not.toMatch(/scope|role_denied|out_of_scope/);
      }
    });

    it('a player of another club does not exist for the caller', async () => {
      expect((await get(`/v1/players/${sofia}/guardians`, adminB)).statusCode).toBe(404);
      const create = await post(`/v1/players/${lucia}/guardians`, adminA, {
        membershipId: motherMembership,
        relationship: 'mother',
      });
      expect(create.statusCode).toBe(404);
      expect((await post(`/v1/guardians/${motherLink.id}/end`, adminB)).statusCode).toBe(404);
    });

    it('lists the links: emails only for the administration, never for the staff', async () => {
      const admin = await get(`/v1/players/${sofia}/guardians`, adminA);
      expect(admin.statusCode).toBe(200);
      expect(admin.json<Page<LinkBody>>().items.map((l) => l.guardian.email)).toEqual([
        'mama@example.com',
      ]);
      const mother = await get(`/v1/players/${sofia}/guardians`, motherA);
      expect(mother.statusCode).toBe(200);
      const own = mother.json<Page<LinkBody>>().items;
      expect(own.map((l) => [l.id, l.guardian.email])).toEqual([[motherLink.id, null]]);
      expect(own[0]?.guardian.name).toEqual(expect.any(String) as unknown);
      // The coach sees Sofía (assigned category) but not her guardians.
      expect((await get(`/v1/players/${sofia}/guardians`, coachA)).statusCode).toBe(403);
      // A guardian of another child: Sofía is out of reach (RLS) → 404.
      expect((await get(`/v1/players/${sofia}/guardians`, fatherA)).statusCode).toBe(404);
    });

    it('edits the relationship with the version, and answers conflict when stale', async () => {
      const edited = await t.app.inject({
        method: 'PATCH',
        url: `/v1/guardians/${motherLink.id}`,
        headers: adminA.headers,
        payload: { version: motherLink.version, relationship: 'legal_guardian' },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      const stale = await t.app.inject({
        method: 'PATCH',
        url: `/v1/guardians/${motherLink.id}`,
        headers: adminA.headers,
        payload: { version: motherLink.version, relationship: 'mother' },
      });
      expect(stale.statusCode).toBe(409);
      const back = await t.app.inject({
        method: 'PATCH',
        url: `/v1/guardians/${motherLink.id}`,
        headers: adminA.headers,
        payload: { version: edited.json<LinkBody>().version, relationship: 'mother' },
      });
      expect(back.statusCode).toBe(200);
    });
  });

  describe('a guardian and their children', () => {
    it('lists the current children of the guardian, with what they may do', async () => {
      const father = await get('/v1/me/children', fatherA);
      expect(father.statusCode, father.body).toBe(200);
      const children = father.json<Page<ChildBody>>().items;
      expect(children.map((c) => [c.firstName, c.ofAge, c.canManageAccess])).toEqual([
        ['Martín', true, false],
        ['Tomás', false, true],
      ]);
      const mother = await get('/v1/me/children', motherA);
      expect(mother.json<Page<ChildBody>>().items).toMatchObject([
        { playerId: sofia, relationship: 'mother', hasAccount: false, canManageAccess: true },
      ]);
      // Paginates by cursor like every list.
      const first = await get('/v1/me/children?limit=1', fatherA);
      const cursor = first.json<Page<ChildBody>>().nextCursor;
      expect(cursor).not.toBeNull();
      const second = await get(`/v1/me/children?limit=1&cursor=${cursor ?? ''}`, fatherA);
      expect(second.json<Page<ChildBody>>().items.map((c) => c.firstName)).toEqual(['Tomás']);
    });

    it('is only for guardians', async () => {
      expect((await get('/v1/me/children', coachA)).statusCode).toBe(403);
      expect((await get('/v1/me/children', adminA)).statusCode).toBe(403);
    });
  });

  describe('access of a child without email: code or link', () => {
    let firstCode: IssuedBody;
    let sofiaAccount: SignedInBody;

    it('the guardian issues a short code and a link, once, never cached', async () => {
      const response = await issue(motherA, sofia);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      firstCode = response.json<IssuedBody>();
      expect(firstCode.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
      expect(firstCode.links.app).toMatch(
        /^sportperformance:\/\/player-access\/[A-Za-z0-9_-]{43}$/,
      );
      expect(firstCode.links.web).toBe(
        `https://app.example.com/player-access/${tokenOf(firstCode.links.app)}`,
      );
      expect(firstCode.accessCode).toMatchObject({
        status: 'pending',
        issuedBy: { userId: motherA.userId },
      });
      const ttlMs = Date.parse(firstCode.accessCode.expiresAt) - Date.now();
      expect(ttlMs).toBeGreaterThan(14 * 60_000);
      expect(ttlMs).toBeLessThanOrEqual(15 * 60_000 + 5_000);
      // Only hashes at rest: neither the code nor the token is stored.
      const stored = await database.admin.query<{ code_hash: string; token_hash: string }>(
        'select code_hash, token_hash from player_access_code where id = $1',
        [firstCode.accessCode.id],
      );
      const row = stored.rows[0];
      expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(firstCode.code.replace('-', ''));
      expect(JSON.stringify(row)).not.toContain(tokenOf(firstCode.links.app));
    });

    it('nobody else issues codes for the child', async () => {
      expect((await issue(coachA, sofia)).statusCode).toBe(403);
      expect((await issue(fatherA, sofia)).statusCode).toBe(404);
      expect((await issue(adminB, sofia)).statusCode).toBe(404);
      // A guardian of an adult who did not keep the link no longer sees them (B-311).
      expect((await issue(fatherA, martin)).statusCode).toBe(404);
    });

    it('the code opens a bearer session of a new account without email, in the club', async () => {
      const typed = firstCode.code.replace('-', '').toLowerCase();
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/player-access',
        payload: { code: typed, deviceId: randomUUID() },
        headers: { 'user-agent': 'SportPerformance/1.0 (ios; 18.0)' },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      sofiaAccount = response.json<SignedInBody>();
      expect(sofiaAccount.user).toMatchObject({
        email: `player.${sofia}@no-email.invalid`,
        name: 'Sofía Gómez',
      });
      expect(sofiaAccount.session.token.length).toBeGreaterThan(10);
      const memberships = await get('/v1/me/memberships', {
        headers: bearer(sofiaAccount.session.token),
      });
      expect(
        memberships
          .json<{ items: { club: { id: string }; role: string }[] }>()
          .items.map((m) => [m.club.id, m.role]),
      ).toEqual([[clubA, 'player']]);
      // The player reads their own guardians (guardian_link.read: self).
      const own = await get(`/v1/players/${sofia}/guardians`, {
        headers: bearer(sofiaAccount.session.token),
      });
      expect(own.statusCode).toBe(200);
      // The mobile session is listed like any other (ADR 0033).
      const sessions = await database.admin.query<{ client_type: string; device_os: string }>(
        'select client_type, device_os from session where user_id = $1',
        [sofiaAccount.user.id],
      );
      expect(sessions.rows).toEqual([{ client_type: 'mobile', device_os: 'ios' }]);
      // No new-device email: there is nowhere to send it.
      expect(t.emails.lastTo(sofiaAccount.user.email)).toBeUndefined();
    });

    it('is single use: neither the code nor its link works again', async () => {
      expect((await redeem({ code: firstCode.code })).statusCode).toBe(409);
      expect((await redeem({ token: tokenOf(firstCode.links.web) })).statusCode).toBe(409);
      expect((await redeem({ code: 'ZZZZ-ZZZZ' })).statusCode).toBe(404);
    });

    it('the next link signs in the same account, and the guardian sees each use', async () => {
      const next = (await issue(motherA, sofia)).json<IssuedBody>();
      const response = await redeem({ token: tokenOf(next.links.app) });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<SignedInBody>().user.id).toBe(sofiaAccount.user.id);
      const list = await get(`/v1/players/${sofia}/access-codes`, motherA);
      expect(list.statusCode).toBe(200);
      expect(list.json<Page<{ id: string; status: string }>>().items).toEqual([
        expect.objectContaining({ id: next.accessCode.id, status: 'used' }),
        expect.objectContaining({ id: firstCode.accessCode.id, status: 'used' }),
      ]);
      expect((await get(`/v1/players/${sofia}/access-codes`, coachA)).statusCode).toBe(403);
      // The child, now with an account, shows it to the guardian.
      const children = await get('/v1/me/children', motherA);
      expect(children.json<Page<ChildBody>>().items[0]?.hasAccount).toBe(true);
    });

    it('issuing again revokes the open code; a revoked code does not work', async () => {
      const old = (await issue(motherA, sofia)).json<IssuedBody>();
      const fresh = (await issue(motherA, sofia)).json<IssuedBody>();
      expect((await redeem({ code: old.code })).statusCode).toBe(409);
      const url = `/v1/players/${sofia}/access-codes/${fresh.accessCode.id}`;
      const revoked = await t.app.inject({ method: 'DELETE', url, headers: motherA.headers });
      expect(revoked.statusCode).toBe(204);
      expect(
        (await t.app.inject({ method: 'DELETE', url, headers: motherA.headers })).statusCode,
      ).toBe(204);
      expect((await redeem({ code: fresh.code })).statusCode).toBe(409);
      const used = `/v1/players/${sofia}/access-codes/${firstCode.accessCode.id}`;
      expect(
        (await t.app.inject({ method: 'DELETE', url: used, headers: motherA.headers })).statusCode,
      ).toBe(409);
      expect(
        (await t.app.inject({ method: 'DELETE', url, headers: adminB.headers })).statusCode,
      ).toBe(404);
    });

    it('expires', async () => {
      const issued = (await issue(motherA, sofia)).json<IssuedBody>();
      await database.admin.query(
        `update player_access_code set created_at = now() - interval '20 minutes',
                expires_at = now() - interval '5 minutes' where id = $1`,
        [issued.accessCode.id],
      );
      expect((await redeem({ code: issued.code })).statusCode).toBe(409);
    });

    it('ending the link revokes what the former guardian left open', async () => {
      const issued = (await issue(motherA, sofia)).json<IssuedBody>();
      const ended = await post(`/v1/guardians/${motherLink.id}/end`, adminA);
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json<LinkBody>().current).toBe(false);
      // Idempotent.
      expect((await post(`/v1/guardians/${motherLink.id}/end`, adminA)).statusCode).toBe(200);
      expect((await redeem({ code: issued.code })).statusCode).toBe(409);
      // The former guardian no longer reaches the child.
      expect((await issue(motherA, sofia)).statusCode).toBe(404);
      expect((await get('/v1/me/children', motherA)).json<Page<ChildBody>>().items).toEqual([]);
    });

    it('never sends a sign-in code to an account without email', async () => {
      const before = t.emails.sent.length;
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/email-otp',
        payload: { email: sofiaAccount.user.email },
      });
      expect(response.statusCode).toBe(202);
      expect(t.emails.sent.length).toBe(before);
    });

    it('limits the codes tried per IP, with Retry-After; the link keeps its own budget', async () => {
      const limited = await startIdentityApp(database, {
        routeClassLimits: ROUTE_LIMITS,
        limits: {
          playerAccessCodeByIp: { name: 'player_access_code_ip_test', max: 2, windowS: 900 },
        },
      });
      try {
        for (let i = 0; i < 2; i += 1) {
          expect((await redeem({ code: 'ZZZZ-ZZZZ' }, limited)).statusCode).toBe(404);
        }
        const refused = await redeem({ code: 'ZZZZ-ZZZZ' }, limited);
        expect(refused.statusCode).toBe(429);
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
        expect((await redeem({ token: 'a'.repeat(43) }, limited)).statusCode).toBe(404);
      } finally {
        await limited.close();
      }
    });
  });

  describe('invitation of a child by email', () => {
    it('the guardian invites; accepting with that email makes the account the child own', async () => {
      const invited = await post(`/v1/players/${tomas}/invitations`, fatherA, {
        email: 'Tomas@Example.com',
      });
      expect(invited.statusCode, invited.body).toBe(201);
      const body = invited.json<{
        invitation: { role: string; playerId: string; email: string };
        links: { web: string };
      }>();
      expect(body.invitation).toMatchObject({
        role: 'player',
        playerId: tomas,
        email: 'tomas@example.com',
      });
      expect(t.emails.lastTo('tomas@example.com')?.kind).toBe('invitation');
      const tomasUser = await signIn(t, 'tomas@example.com', 'bearer');
      const accepted = await t.app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: tomasUser.headers,
        payload: { token: tokenOf(body.links.web) },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      const linked = await database.admin.query<{ user_id: string }>(
        'select user_id from player where id = $1',
        [tomas],
      );
      expect(linked.rows[0]?.user_id).toBe(tomasUser.userId);
      // Once the child has an account, neither a new invitation nor another account.
      expect(
        (await post(`/v1/players/${tomas}/invitations`, fatherA, { email: 'otro@example.com' }))
          .statusCode,
      ).toBe(409);
    });

    it('never issues nor redeems a code for a player whose account has an email', async () => {
      // Review of #159: a session is the user's in every club, so a code of club A must
      // never open an account with an email (Tomás now signs in with his).
      for (const caller of [fatherA, adminA]) {
        const refused = await issue(caller, tomas);
        expect(refused.statusCode, refused.body).toBe(409);
      }
      // A code issued while the player had no account, which then got one with an email
      // (here the admin of club B): it does not open that account.
      const open = await issue(adminA, martin);
      expect(open.statusCode, open.body).toBe(201);
      await database.admin.query('update player set user_id = $1 where id = $2', [
        adminB.userId,
        martin,
      ]);
      try {
        const refused = await redeem({ code: open.json<IssuedBody>().code });
        expect(refused.statusCode, refused.body).toBe(409);
        const memberships = await database.admin.query<{ id: string }>(
          'select id from membership where club_id = $1 and user_id = $2',
          [clubA, adminB.userId],
        );
        expect(memberships.rows).toEqual([]);
      } finally {
        await database.admin.query('update player set user_id = null where id = $1', [martin]);
        await database.admin.query(
          'update player_access_code set revoked_at = now() where player_id = $1 and consumed_at is null',
          [martin],
        );
      }
    });

    it('refuses the guardian of an adult, the staff and other clubs', async () => {
      const payload = { email: 'martin@example.com' };
      // The adult did not keep the link: out of reach (B-311).
      expect((await post(`/v1/players/${martin}/invitations`, fatherA, payload)).statusCode).toBe(
        404,
      );
      expect((await post(`/v1/players/${sofia}/invitations`, coachA, payload)).statusCode).toBe(
        403,
      );
      expect((await post(`/v1/players/${sofia}/invitations`, adminB, payload)).statusCode).toBe(
        404,
      );
    });

    it('the administration invites a parent about a player: accepting opens the link', async () => {
      const invited = await post('/v1/invitations', adminA, {
        email: 'abuela@example.com',
        role: 'parent',
        playerId: sofia,
        relationship: 'legal_guardian',
      });
      expect(invited.statusCode, invited.body).toBe(201);
      const { links } = invited.json<{ links: { web: string } }>();
      const grandma = await signIn(t, 'abuela@example.com');
      const accepted = await t.app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: grandma.headers,
        payload: { token: tokenOf(links.web) },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      const links2 = await get(`/v1/players/${sofia}/guardians`, adminA);
      expect(
        links2.json<Page<LinkBody>>().items.map((l) => [l.guardian.email, l.relationship]),
      ).toEqual([['abuela@example.com', 'legal_guardian']]);
      // A parent invitation about a player needs the relationship; staff ones take no player.
      for (const payload of [
        { email: 'x@example.com', role: 'parent', playerId: sofia },
        { email: 'x@example.com', role: 'coach', playerId: sofia },
        { email: 'x@example.com', role: 'parent', relationship: 'mother' },
      ]) {
        expect(
          (await post('/v1/invitations', adminA, payload)).statusCode,
          JSON.stringify(payload),
        ).toBe(400);
      }
      expect(
        (
          await post('/v1/invitations', adminA, {
            email: 'x@example.com',
            role: 'player',
            playerId: lucia,
          })
        ).statusCode,
      ).toBe(400);
    });
  });
});
