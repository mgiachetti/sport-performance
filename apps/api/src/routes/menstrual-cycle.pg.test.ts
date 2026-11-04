/**
 * Menstrual cycle tracking end to end (B-806, ADR 0087) against Postgres 16
 * through the real connection roles: three keys (the club's module, the
 * consents and the player's own opt-in), only the player writes, she reads all
 * of hers and authorizes, one by one, the assigned medical or S&C members that
 * may read it; the coach, the administration and the guardian never do. Every
 * access lands in the medical log.
 */
import { randomUUID } from 'node:crypto';
import { formatHlc, type ClubId } from '@sport-performance/domain';
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

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface Viewer {
  id: string;
  membershipId: string;
  role: string;
  name: string;
}

interface StatusBody {
  playerId: string;
  localDate: string;
  available: boolean;
  unavailableReason: string | null;
  tracking: boolean;
  trackingSince: string | null;
  viewers: Viewer[];
  candidates: { membershipId: string; role: string; authorized: boolean }[];
}

interface DayBody {
  id: string;
  clientUuid: string;
  localDate: string;
  flow: string;
  symptoms: string[];
  note: string | null;
}

interface DaysBody {
  playerId: string;
  days: DayBody[];
  summary: { periodStarts: string[]; cycleDay: number | null; daysLogged: number };
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('menstrual cycle (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let adminA: SignedIn;
  let coachA: SignedIn;
  let scA: SignedIn;
  let medicalA: SignedIn;
  let medicalM17: SignedIn;
  let playerA: SignedIn;
  let playerMale: SignedIn;
  let parentA: SignedIn;
  let clubA: ClubId;
  let pA: string;
  let medicalMembership: string;
  let scMembership: string;
  let coachMembership: string;
  let today: string;

  async function insertCategory(clubId: ClubId, band: string): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, 'hockey', 'female')
       on conflict (club_id, sport, sex) do nothing`,
      [clubId],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, 'hockey', 'female', $2, upper($2), 'development') returning id`,
      [clubId, band],
    );
    return rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    user: SignedIn,
    categoryId: string,
    sex: 'female' | 'male',
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Sofía', 'Gómez', '2011-05-04', $3, 'hockey', '2020-01-01') returning id`,
      [clubId, user.userId, sex],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    return playerId;
  }

  async function sign(clubId: ClubId, playerId: string, type: string) {
    await database.admin.query(
      `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
       values ($1, $2, $3::consent_type, 'v1', 'guardian', $4)`,
      [clubId, playerId, type, parentA.userId],
    );
  }

  async function assign(membershipId: string, clubId: ClubId, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, membershipId, categoryId],
    );
  }

  async function setModule(clubId: ClubId, on: boolean): Promise<void> {
    await database.admin.query(
      `update club set settings = jsonb_set(settings, '{modules}',
         jsonb_build_object('menstrual_cycle', $2::boolean)) where id = $1`,
      [clubId, on],
    );
  }

  const status = (caller: SignedIn) =>
    t.app.inject({ url: '/v1/menstrual-cycle/me', headers: caller.headers });
  const post = (caller: SignedIn, url: string, payload: unknown = {}) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: caller.headers,
      payload: payload as Record<string, unknown>,
    });
  const days = (caller: SignedIn, playerId = pA, query = '') =>
    t.app.inject({
      url: `/v1/menstrual-cycle/players/${playerId}/days${query}`,
      headers: caller.headers,
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
    adminA = await signIn(t, 'admin@ciclo-a.example.com');
    coachA = await signIn(t, 'coach@ciclo-a.example.com');
    scA = await signIn(t, 'sc@ciclo-a.example.com');
    medicalA = await signIn(t, 'medica@ciclo-a.example.com');
    medicalM17 = await signIn(t, 'medica17@ciclo-a.example.com');
    playerA = await signIn(t, 'jugadora@ciclo-a.example.com');
    playerMale = await signIn(t, 'jugador@ciclo-a.example.com');
    parentA = await signIn(t, 'madre@ciclo-a.example.com');

    clubA = await createClub(database.admin, 'ciclo-a');
    const { rows } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = rows[0]?.today ?? '';
    const m15 = await insertCategory(clubA, 'm15');
    const m17 = await insertCategory(clubA, 'm17');
    pA = await insertPlayer(clubA, playerA, m15, 'female');
    const pMale = await insertPlayer(clubA, playerMale, m15, 'male');
    for (const playerId of [pA, pMale]) {
      for (const type of ['data', 'health', 'menstrual_cycle']) await sign(clubA, playerId, type);
    }
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, pA, parentA.userId],
    );
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await assign(coachMembership, clubA, m15);
    scMembership = await createMembership(database.admin, scA.userId, clubA, 'sc');
    await assign(scMembership, clubA, m15);
    medicalMembership = await createMembership(database.admin, medicalA.userId, clubA, 'medical');
    await assign(medicalMembership, clubA, m15);
    await assign(
      await createMembership(database.admin, medicalM17.userId, clubA, 'medical'),
      clubA,
      m17,
    );
    await createMembership(database.admin, playerA.userId, clubA, 'player');
    await createMembership(database.admin, playerMale.userId, clubA, 'player');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('opt-in', () => {
    it('is not offered with the module off (the default), nor to a male player', async () => {
      const off = await status(playerA);
      expect(off.statusCode, off.body).toBe(200);
      expect(off.json<StatusBody>()).toMatchObject({
        playerId: pA,
        localDate: today,
        available: false,
        unavailableReason: 'module_off',
        tracking: false,
        viewers: [],
        candidates: [],
      });
      expect((await post(playerA, '/v1/menstrual-cycle/me/enrollment')).statusCode).toBe(403);
      await setModule(clubA, true);
      expect((await status(playerMale)).json<StatusBody>().unavailableReason).toBe('not_female');
      expect((await post(playerMale, '/v1/menstrual-cycle/me/enrollment')).statusCode).toBe(403);
    });

    it('the player turns it on herself, starting with nobody authorized', async () => {
      const response = await post(playerA, '/v1/menstrual-cycle/me/enrollment', {
        clientUuid: randomUUID(),
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<StatusBody>();
      expect(body).toMatchObject({ available: true, tracking: true, viewers: [] });
      expect(body.candidates.map((c) => [c.membershipId, c.authorized]).sort()).toEqual(
        [
          [medicalMembership, false],
          [scMembership, false],
        ].sort(),
      );
      // Again: no change.
      const again = await post(playerA, '/v1/menstrual-cycle/me/enrollment');
      expect(again.json<StatusBody>().trackingSince).toBe(body.trackingSince);
    });

    it('nobody else turns it on or reads the status: not the guardian, not the staff', async () => {
      for (const caller of [parentA, coachA, scA, medicalA, adminA]) {
        expect((await post(caller, '/v1/menstrual-cycle/me/enrollment')).statusCode).toBe(403);
        expect((await status(caller)).statusCode).toBe(403);
      }
    });
  });

  describe('days', () => {
    it('the player logs a day; the latest of each day counts', async () => {
      const first = await post(playerA, '/v1/menstrual-cycle/days', {
        flow: 'moderate',
        symptoms: ['fatigue', 'cramps'],
        note: 'Molestia en la entrada en calor',
      });
      expect(first.statusCode, first.body).toBe(201);
      expect(first.json<DayBody>()).toMatchObject({
        localDate: today,
        flow: 'moderate',
        symptoms: ['cramps', 'fatigue'],
      });
      const fix = await post(playerA, '/v1/menstrual-cycle/days', { flow: 'heavy' });
      expect(fix.statusCode).toBe(201);
      const read = await days(playerA);
      expect(read.statusCode, read.body).toBe(200);
      const body = read.json<DaysBody>();
      expect(body.days).toHaveLength(1);
      expect(body.days[0]).toMatchObject({ flow: 'heavy', symptoms: [] });
      expect(body.summary).toMatchObject({ periodStarts: [today], cycleDay: 1, daysLogged: 1 });
    });

    it('checks the day and its window', async () => {
      const twice = await post(playerA, '/v1/menstrual-cycle/days', {
        flow: 'light',
        symptoms: ['cramps', 'cramps'],
      });
      expect(twice.statusCode).toBe(400);
      expect(errorOf(twice).code).toBe('validation_failed');
      const old = await post(playerA, '/v1/menstrual-cycle/days', {
        flow: 'light',
        localDate: '2000-01-01',
      });
      expect(old.statusCode).toBe(400);
      const future = await post(playerA, '/v1/menstrual-cycle/days', {
        flow: 'light',
        localDate: '2999-01-01',
      });
      expect(future.statusCode).toBe(400);
    });

    it('goes through the offline queue, and a resend is a replay', async () => {
      const clientUuid = randomUUID();
      const mutation = {
        mutationId: randomUUID(),
        hlc: formatHlc({ physicalMs: Date.now() - 60_000, counter: 0, node: '0123456789abcdef' }),
        op: 'menstrual_cycle.log',
        body: { clientUuid, flow: 'light', symptoms: ['headache'] },
      };
      const push = () =>
        t.app.inject({
          method: 'POST',
          url: '/v1/sync/push',
          headers: playerA.headers,
          payload: { mutations: [mutation] },
        });
      const first = await push();
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json<{ results: { status: string }[] }>().results[0]?.status).toBe('applied');
      const again = await push();
      expect(again.json<{ results: { status: string }[] }>().results[0]?.status).toBe('replayed');
      const { rows } = await database.admin.query<{ n: number }>(
        'select count(*)::int as n from medical.menstrual_cycle_log where client_uuid = $1',
        [clientUuid],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it('nobody else logs a day', async () => {
      for (const caller of [parentA, coachA, scA, medicalA, adminA]) {
        expect((await post(caller, '/v1/menstrual-cycle/days', { flow: 'none' })).statusCode).toBe(
          403,
        );
      }
    });
  });

  describe('who reads it', () => {
    it('the coach, the administration and the guardian never; the staff nothing unauthorized', async () => {
      for (const caller of [coachA, adminA, parentA]) {
        expect((await days(caller)).statusCode).toBe(403);
      }
      for (const caller of [medicalA, scA]) {
        const response = await days(caller);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json<DaysBody>().days).toEqual([]);
      }
      // The medical staff of another category does not see the player at all.
      expect((await days(medicalM17)).statusCode).toBe(404);
    });

    it('authorizes only an assigned medical or S&C member', async () => {
      const coach = await post(playerA, '/v1/menstrual-cycle/me/viewers', {
        membershipId: coachMembership,
      });
      expect(coach.statusCode).toBe(400);
      expect(
        (await post(parentA, '/v1/menstrual-cycle/me/viewers', { membershipId: medicalMembership }))
          .statusCode,
      ).toBe(403);
    });

    it('the authorized member reads, with the access logged; revoking cuts it', async () => {
      const response = await post(playerA, '/v1/menstrual-cycle/me/viewers', {
        membershipId: medicalMembership,
      });
      expect(response.statusCode, response.body).toBe(201);
      const viewer = response.json<Viewer>();
      expect(viewer).toMatchObject({ membershipId: medicalMembership, role: 'medical' });
      const read = await days(medicalA);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json<DaysBody>().days.length).toBeGreaterThan(0);
      const { rows } = await database.admin.query<{ resource: string; actor_role: string }>(
        `select resource, actor_role from medical.access_log
          where actor_user_id = $1 and resource = 'menstrual_cycle_log' and action = 'read'`,
        [medicalA.userId],
      );
      expect(rows.length).toBeGreaterThan(0);
      // Still nothing for the S&C member she did not authorize.
      expect((await days(scA)).json<DaysBody>().days).toEqual([]);
      const shared = await t.app.inject({
        url: '/v1/menstrual-cycle/shared-with-me',
        headers: medicalA.headers,
      });
      expect(shared.statusCode, shared.body).toBe(200);
      expect(shared.json<{ items: { playerId: string }[] }>().items).toEqual([
        expect.objectContaining({ playerId: pA, firstName: 'Sofía' }),
      ]);
      for (const caller of [coachA, adminA, parentA, playerA]) {
        const denied = await t.app.inject({
          url: '/v1/menstrual-cycle/shared-with-me',
          headers: caller.headers,
        });
        expect(denied.statusCode).toBe(403);
      }

      const revoked = await post(playerA, `/v1/menstrual-cycle/me/viewers/${viewer.id}/revoke`);
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect(revoked.json<StatusBody>().viewers).toEqual([]);
      expect((await days(medicalA)).json<DaysBody>().days).toEqual([]);
      expect(
        (await post(playerA, `/v1/menstrual-cycle/me/viewers/${viewer.id}/revoke`)).statusCode,
      ).toBe(404);
    });

    it('turning it off revokes every authorization and stops the logging', async () => {
      await post(playerA, '/v1/menstrual-cycle/me/viewers', { membershipId: scMembership });
      expect((await days(scA)).json<DaysBody>().days.length).toBeGreaterThan(0);
      const off = await post(playerA, '/v1/menstrual-cycle/me/enrollment/end');
      expect(off.statusCode, off.body).toBe(200);
      expect(off.json<StatusBody>()).toMatchObject({ tracking: false, viewers: [] });
      expect((await days(scA)).json<DaysBody>().days).toEqual([]);
      expect((await post(playerA, '/v1/menstrual-cycle/days', { flow: 'none' })).statusCode).toBe(
        403,
      );
      // Hers stay hers.
      expect((await days(playerA)).json<DaysBody>().days.length).toBeGreaterThan(0);
    });

    it('a revoked consent asks for it again before anything is logged', async () => {
      await post(playerA, '/v1/menstrual-cycle/me/enrollment');
      await database.admin.query(
        `update consent set revoked_at = now(), revoked_by = $3
          where club_id = $1 and player_id = $2 and type::text = 'menstrual_cycle'`,
        [clubA, pA, parentA.userId],
      );
      const response = await post(playerA, '/v1/menstrual-cycle/days', { flow: 'none' });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe('consent_required');
      expect((await status(playerA)).json<StatusBody>().unavailableReason).toBe('missing_consent');
    });
  });
});
