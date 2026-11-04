/**
 * Menarche of a girl end to end (B-805, ADR 0087) against Postgres 16
 * through the real connection roles: the player, her guardian while she is a
 * minor and the assigned medical staff tell it and read it, all of them with
 * a health consent; it lands in the `medical` schema with every access
 * logged; the coach, the S&C staff and the administration never see it; it
 * is only for girls and needs the `maturation` module to be told; and the
 * readers of the anthropometry get the somatic offset checked against it.
 */
import { randomUUID } from 'node:crypto';
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

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface ReportBody {
  id: string;
  clientUuid: string;
  playerId: string;
  status: string;
  occurredOn: string | null;
  precision: string | null;
  reportedOn: string;
  reportedBy: string;
  reportedByUserId: string | null;
  reportedAt: string;
  ageAtMenarcheYears: number | null;
}

interface RecordBody {
  playerId: string;
  canReport: boolean;
  latest: ReportBody | null;
  history: ReportBody[];
  offsetCheck: {
    measuredOn: string;
    phvOffsetYears: number;
    maturityOffsetEquation: string;
    impliedPhvOffsetYears: number | null;
    impliedMinPhvOffsetYears: number | null;
    impliedMaxPhvOffsetYears: number | null;
    verdict: string;
    referenceVerification: string;
  } | null;
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function paths(response: LightMyRequestResponse): string[] {
  return (errorOf(response).details ?? []).map((d) => d.path.join('.'));
}

describeWithPostgres('menarche (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let adminA: SignedIn;
  let coachA: SignedIn;
  let scA: SignedIn;
  let medicalA: SignedIn;
  let medicalOther: SignedIn;
  let girl: SignedIn;
  let girlNoHealth: SignedIn;
  let boy: SignedIn;
  let parent: SignedIn;
  let girlB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let pGirl: string;
  let pGirlNoHealth: string;
  let pBoy: string;
  let pGirlB: string;
  let today: string;

  async function insertCategory(
    clubId: ClubId,
    sport: 'rugby' | 'hockey',
    sex: 'male' | 'female',
    band: string,
  ): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, $2, $3)
       on conflict (club_id, sport, sex) do nothing`,
      [clubId, sport, sex],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, $2, $3, $4, $5, 'development') returning id`,
      [clubId, sport, sex, band, `${band.toUpperCase()} ${sport}`],
    );
    return rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    user: SignedIn | null,
    categoryId: string,
    sex: 'male' | 'female',
    consents: ('data' | 'health')[],
    signer: SignedIn,
  ): Promise<string> {
    const sport = sex === 'female' ? 'hockey' : 'rugby';
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Ana', 'Gómez', '2011-05-04', $3, $4, '2020-01-01') returning id`,
      [clubId, user?.userId ?? null, sex, sport],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    for (const type of consents) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, $3, 'v1', 'guardian', $4)`,
        [clubId, playerId, type, signer.userId],
      );
    }
    return playerId;
  }

  async function assign(membershipId: string, clubId: ClubId, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, membershipId, categoryId],
    );
  }

  function get(caller: SignedIn, playerId: string, extra: Record<string, string> = {}) {
    return t.app.inject({
      url: `/v1/players/${playerId}/menarche`,
      headers: { ...caller.headers, ...extra },
    });
  }

  function post(
    caller: SignedIn,
    playerId: string,
    payload: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) {
    return t.app.inject({
      method: 'POST',
      url: `/v1/players/${playerId}/menarche`,
      headers: { ...caller.headers, ...extra },
      payload,
    });
  }

  async function logOf(requestId: string) {
    const { rows } = await database.admin.query<{ action: string; resource: string }>(
      `select action::text, resource from medical.access_log
        where request_id = $1 order by occurred_at, resource`,
      [requestId],
    );
    return rows.map((row) => `${row.action}:${row.resource}`);
  }

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
    adminA = await signIn(t, 'admin@club-a.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    scA = await signIn(t, 'sc@club-a.example.com');
    medicalA = await signIn(t, 'medico@club-a.example.com');
    medicalOther = await signIn(t, 'medico-m17@club-a.example.com');
    girl = await signIn(t, 'jugadora@club-a.example.com');
    girlNoHealth = await signIn(t, 'jugadora-sin-salud@club-a.example.com');
    boy = await signIn(t, 'jugador@club-a.example.com');
    parent = await signIn(t, 'madre@club-a.example.com');
    girlB = await signIn(t, 'jugadora@club-b.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    // Club B has the maturation module off.
    await database.admin.query(
      `update club set settings = jsonb_set(settings, '{modules}', '{"maturation": false}'::jsonb)
        where id = $1`,
      [clubB],
    );
    const { rows } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = rows[0]?.today ?? '';

    const hockey = await insertCategory(clubA, 'hockey', 'female', 'm15');
    const rugby = await insertCategory(clubA, 'rugby', 'male', 'm15');
    const m17 = await insertCategory(clubA, 'hockey', 'female', 'm17');
    pGirl = await insertPlayer(clubA, girl, hockey, 'female', ['data', 'health'], parent);
    pGirlNoHealth = await insertPlayer(clubA, girlNoHealth, hockey, 'female', ['data'], parent);
    pBoy = await insertPlayer(clubA, boy, rugby, 'male', ['data', 'health'], parent);
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, pGirl, parent.userId],
    );

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await assign(coachMembership, clubA, hockey);
    await assign(await createMembership(database.admin, scA.userId, clubA, 'sc'), clubA, hockey);
    const medicalMembership = await createMembership(
      database.admin,
      medicalA.userId,
      clubA,
      'medical',
    );
    await assign(medicalMembership, clubA, hockey);
    await assign(medicalMembership, clubA, rugby);
    await assign(
      await createMembership(database.admin, medicalOther.userId, clubA, 'medical'),
      clubA,
      m17,
    );
    for (const user of [girl, girlNoHealth, boy]) {
      await createMembership(database.admin, user.userId, clubA, 'player');
    }
    await createMembership(database.admin, parent.userId, clubA, 'parent');

    const hockeyB = await insertCategory(clubB, 'hockey', 'female', 'm15');
    pGirlB = await insertPlayer(clubB, girlB, hockeyB, 'female', ['data', 'health'], parent);
    await createMembership(database.admin, girlB.userId, clubB, 'player');
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('the record', () => {
    it('starts empty and says who may tell it', async () => {
      const response = await get(girl, pGirl);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<RecordBody>()).toEqual({
        playerId: pGirl,
        canReport: true,
        latest: null,
        history: [],
        offsetCheck: null,
      });
    });

    it('the player tells "not yet" herself, on the club day, and every access is logged', async () => {
      const requestId = `req-menarche-${randomUUID().slice(0, 8)}`;
      const response = await post(
        girl,
        pGirl,
        { clientUuid: randomUUID(), status: 'not_yet' },
        { 'x-request-id': requestId },
      );
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json<ReportBody>()).toMatchObject({
        playerId: pGirl,
        status: 'not_yet',
        occurredOn: null,
        precision: null,
        reportedOn: today,
        reportedBy: 'player',
        reportedByUserId: girl.userId,
        ageAtMenarcheYears: null,
      });
      // The replay lookup, the write and the read-back; column names, never values.
      expect(await logOf(requestId)).toEqual([
        'read:menarche_report',
        'insert:menarche_report',
        'read:menarche_report',
      ]);
    });

    it('her guardian tells it occurred, the date truncated to its precision', async () => {
      const response = await post(parent, pGirl, {
        status: 'occurred',
        occurredOn: '2024-03-17',
        precision: 'month',
      });
      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<ReportBody>();
      expect(body).toMatchObject({
        status: 'occurred',
        occurredOn: '2024-03-01',
        precision: 'month',
        reportedBy: 'parent',
      });
      // Born on 2011-05-04: about 12.9 years old in the middle of March 2024.
      expect(body.ageAtMenarcheYears).toBeGreaterThan(12.8);
      expect(body.ageAtMenarcheYears).toBeLessThan(12.95);
      const record = (await get(girl, pGirl)).json<RecordBody>();
      expect(record.latest?.id).toBe(body.id);
      expect(record.history.map((r) => r.status)).toEqual(['occurred', 'not_yet']);
    });

    it('a repeated send answers the first report', async () => {
      const clientUuid = randomUUID();
      const payload = {
        clientUuid,
        status: 'occurred',
        occurredOn: '2024-03-01',
        precision: 'month',
      };
      const first = await post(parent, pGirl, payload);
      expect(first.statusCode, first.body).toBe(201);
      const again = await post(parent, pGirl, payload);
      expect(again.headers['x-idempotent-replay']).toBe('true');
      expect(again.json<ReportBody>().id).toBe(first.json<ReportBody>().id);
    });

    it('validates the report', async () => {
      const cases: [Record<string, unknown>, string[]][] = [
        [{ status: 'occurred' }, ['body.occurredOn', 'body.precision']],
        [
          { status: 'not_yet', occurredOn: '2024-03-01', precision: 'month' },
          ['body.occurredOn', 'body.precision'],
        ],
        [{ status: 'occurred', occurredOn: '2999-01-01', precision: 'day' }, ['body.occurredOn']],
        // Three years old: a typo.
        [{ status: 'occurred', occurredOn: '2014-06-01', precision: 'month' }, ['body.occurredOn']],
      ];
      for (const [payload, expected] of cases) {
        const response = await post(girl, pGirl, payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorOf(response).code).toBe('validation_failed');
        expect(paths(response), JSON.stringify(payload)).toEqual(expected);
      }
    });
  });

  describe('the offset check', () => {
    it('the medical staff tells it and sees the last offset against it', async () => {
      await database.admin.query(
        `insert into anthro_measurement
           (club_id, player_id, measured_on, height_cm, phv_offset_years, maturity_offset_equation)
         values ($1, $2, '2025-03-16', 158, -1.5, 'moore_2015')`,
        [clubA, pGirl],
      );
      const told = await post(medicalA, pGirl, {
        status: 'occurred',
        occurredOn: '2024-03-16',
        precision: 'day',
      });
      expect(told.statusCode, told.body).toBe(201);
      expect(told.json<ReportBody>().reportedBy).toBe('medical');

      const record = (await get(medicalA, pGirl)).json<RecordBody>();
      // A year after menarche the offset is at least ≈ 1 year: −1.5 is clearly too low.
      expect(record.offsetCheck).toMatchObject({
        measuredOn: '2025-03-16',
        phvOffsetYears: -1.5,
        maturityOffsetEquation: 'moore_2015',
        verdict: 'offset_below_reference',
        referenceVerification: 'unverified',
      });
      expect(record.offsetCheck?.impliedPhvOffsetYears).toBeCloseTo(365 / 365.25 + 1.3, 6);
      expect(record.offsetCheck?.impliedMinPhvOffsetYears).toBeCloseTo(365 / 365.25, 6);

      // The player reads her anthropometry too; her guardian does not, so no check for her.
      expect((await get(girl, pGirl)).json<RecordBody>().offsetCheck?.verdict).toBe(
        'offset_below_reference',
      );
      const byParent = (await get(parent, pGirl)).json<RecordBody>();
      expect(byParent.latest?.reportedBy).toBe('medical');
      expect(byParent.offsetCheck).toBeNull();

      // The offset the rest of the staff sees does not change.
      const { rows } = await database.admin.query<{ offset: number }>(
        'select phv_offset_years as offset from anthro_measurement where player_id = $1',
        [pGirl],
      );
      expect(rows.map((r) => r.offset)).toEqual([-1.5]);
    });
  });

  describe('who', () => {
    it('the coach, the S&C staff and the administration never read or tell it', async () => {
      for (const caller of [coachA, scA, adminA]) {
        const read = await get(caller, pGirl);
        expect(read.statusCode, read.body).toBe(403);
        const told = await post(caller, pGirl, { status: 'not_yet' });
        expect(told.statusCode, told.body).toBe(403);
      }
    });

    it('a medical staff member without the assignment does not see the player', async () => {
      expect((await get(medicalOther, pGirl)).statusCode).toBe(404);
      expect((await post(medicalOther, pGirl, { status: 'not_yet' })).statusCode).toBe(404);
    });

    it('needs a health consent', async () => {
      const read = await get(girlNoHealth, pGirlNoHealth);
      expect(read.statusCode, read.body).toBe(403);
      expect(errorOf(read).code).toBe('consent_required');
      const told = await post(girlNoHealth, pGirlNoHealth, { status: 'not_yet' });
      expect(errorOf(told).code).toBe('consent_required');
      expect(errorOf(await get(medicalA, pGirlNoHealth)).code).toBe('consent_required');
    });

    it('is only for girls', async () => {
      const read = await get(medicalA, pBoy);
      expect(read.statusCode, read.body).toBe(409);
      expect(errorOf(read).code).toBe('conflict');
      expect((await post(boy, pBoy, { status: 'not_yet' })).statusCode).toBe(409);
    });

    it('is told only with the maturation module on, and read anyway', async () => {
      const told = await post(girlB, pGirlB, { status: 'not_yet' });
      expect(told.statusCode, told.body).toBe(403);
      const read = await get(girlB, pGirlB);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json<RecordBody>()).toMatchObject({ canReport: false, latest: null });
    });

    it('another club does not see the player', async () => {
      expect((await get(girlB, pGirl)).statusCode).toBe(404);
    });
  });
});
