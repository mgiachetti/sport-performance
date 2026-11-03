/**
 * Anthropometry end to end (B-412) against Postgres 16, through the real
 * connection roles (ADR 0026): the batch of a measurement day, the stage
 * rules of its values, the permission matrix in the handlers (ADR 0025)
 * with RLS behind it, corrections with a reason (ADR 0030) and the preview
 * of the maturation, which must equal the worker's domain function.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MATURATION_PARAMS,
  KHAMIS_ROCHE_1994_TABLE,
  deriveMaturation,
  parseLocalDate,
  type ClubId,
} from '@sport-performance/domain';
import { khamisRocheCoefficientSeeds, khamisRocheTableSeed } from '@sport-performance/db/seeds';
import { refreshClub } from '@sport-performance/worker';
import type { LightMyRequestResponse } from 'fastify';
import { pino } from 'pino';
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

interface MeasurementBody {
  id: string;
  playerId: string;
  measuredOn: string;
  heightCm: number | null;
  sittingHeightCm: number | null;
  weightKg: number | null;
  skinfoldsSumMm: number | null;
  method: string;
  testSessionId: string | null;
  evaluatorId: string | null;
  conditions: Record<string, unknown>;
  maturation: { phvOffsetYears: number | null; derivedAt: string | null };
  version: string;
}

interface PreviewItem {
  playerId: string;
  blockedBy: string | null;
  ageYears: number | null;
  stage: string | null;
  phvOffsetYears: number | null;
  maturityOffsetEquation: string | null;
  maturityOffsetVerification: string | null;
  predictedAdultHeightCm: number | null;
  adultHeightPct: number | null;
  growthVelocityCmYear: number | null;
  gaps: { phvOffset: string[]; adultHeight: string[] };
  plausibility: { field: string; status: string; suggestedValues: number[] }[];
}

interface PreviewBody {
  reference: { code: string; verification: string } | null;
  items: PreviewItem[];
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function paths(response: LightMyRequestResponse): string[] {
  return (errorOf(response).details ?? []).map((d) => d.path.join('.'));
}

describeWithPostgres('anthropometry (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scM15: SignedIn;
  let scM17: SignedIn;
  let coachM15: SignedIn;
  let player15: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  let p15: string;
  let p15NoConsent: string;
  let p15NoParents: string;
  let p17: string;
  let pB: string;
  let m17: string;
  let today: string;
  const birth15 = '2011-06-01';

  async function addDays(date: string, days: number): Promise<string> {
    const { rows } = await database.admin.query<{ day: string }>(
      `select ($1::date + $2::int)::text as day`,
      [date, days],
    );
    return rows[0]?.day ?? '';
  }

  async function insertCategory(clubId: ClubId, band: string, stage: string): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')
       on conflict (club_id, sport, sex) do nothing`,
      [clubId],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, 'rugby', 'male', $2, upper($2), $3) returning id`,
      [clubId, band, stage],
    );
    return rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    user: SignedIn | null,
    birthDate: string,
    categoryId: string,
    consentSigner: SignedIn | null,
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', $3, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, user?.userId ?? null, birthDate],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    if (consentSigner !== null) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubId, playerId, consentSigner.userId],
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

  async function seedKhamisRoche(clubId: ClubId): Promise<void> {
    const header = khamisRocheTableSeed(KHAMIS_ROCHE_1994_TABLE);
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into khamis_roche_table (club_id, code, citation, doi, errata, verification, verification_notes)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        clubId,
        header.code,
        header.citation,
        header.doi ?? null,
        header.errata ?? [],
        header.verification,
        header.verificationNotes,
      ],
    );
    const tableId = rows[0]?.id ?? '';
    for (const row of khamisRocheCoefficientSeeds(KHAMIS_ROCHE_1994_TABLE)) {
      await database.admin.query(
        `insert into khamis_roche_coefficient
           (club_id, table_id, sex, age_years, intercept_in, height_in_coef, weight_lb_coef, midparent_height_in_coef)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          clubId,
          tableId,
          row.sex,
          row.ageYears,
          row.interceptIn,
          row.heightInCoef,
          row.weightLbCoef,
          row.midparentHeightInCoef,
        ],
      );
    }
  }

  async function insertTestDay(values: {
    sport?: string;
    categoryId?: string | null;
    scheduledOn: string;
    status?: string;
    evaluatorId?: string | null;
    conditions?: Record<string, unknown>;
  }): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into test_session (club_id, sport, category_id, scheduled_on, status, evaluator_id, conditions)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        clubA,
        values.sport ?? 'rugby',
        values.categoryId === undefined ? m15 : values.categoryId,
        values.scheduledOn,
        values.status ?? 'scheduled',
        values.evaluatorId ?? null,
        JSON.stringify(values.conditions ?? {}),
      ],
    );
    return rows[0]?.id ?? '';
  }

  function record(caller: SignedIn, measurements: unknown[]) {
    return t.app.inject({
      method: 'POST',
      url: '/v1/anthro-measurements',
      headers: caller.headers,
      payload: { measurements },
    });
  }

  function preview(caller: SignedIn, measurements: unknown[]) {
    return t.app.inject({
      method: 'POST',
      url: '/v1/anthro-measurements/preview',
      headers: caller.headers,
      payload: { measurements },
    });
  }

  async function list(caller: SignedIn, query = ''): Promise<MeasurementBody[]> {
    const response = await t.app.inject({
      url: `/v1/anthro-measurements${query}`,
      headers: caller.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ items: MeasurementBody[] }>().items;
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
    adminB = await signIn(t, 'admin@club-b.example.com');
    scM15 = await signIn(t, 'sc15@club-a.example.com');
    scM17 = await signIn(t, 'sc17@club-a.example.com');
    coachM15 = await signIn(t, 'coach15@club-a.example.com');
    player15 = await signIn(t, 'player15@club-a.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    const { rows } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = rows[0]?.today ?? '';
    await seedKhamisRoche(clubA);

    m15 = await insertCategory(clubA, 'm15', 'development');
    m17 = await insertCategory(clubA, 'm17', 'performance');
    p15 = await insertPlayer(clubA, player15, birth15, m15, adminA);
    p15NoConsent = await insertPlayer(clubA, null, '2011-08-01', m15, null);
    p15NoParents = await insertPlayer(clubA, null, '2011-09-01', m15, adminA);
    p17 = await insertPlayer(clubA, null, '2009-03-01', m17, adminA);
    for (const [parent, heightCm] of [
      ['mother', 165],
      ['father', 182],
    ] as const) {
      await database.admin.query(
        `insert into player_parent_height (club_id, player_id, parent, height_cm, source)
         values ($1, $2, $3, $4, 'measured')`,
        [clubA, p15, parent, heightCm],
      );
    }

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await assign(await createMembership(database.admin, scM15.userId, clubA, 'sc'), clubA, m15);
    await assign(await createMembership(database.admin, scM17.userId, clubA, 'sc'), clubA, m17);
    await assign(
      await createMembership(database.admin, coachM15.userId, clubA, 'coach'),
      clubA,
      m15,
    );
    await createMembership(database.admin, player15.userId, clubA, 'player');

    const mB = await insertCategory(clubB, 'm15', 'development');
    pB = await insertPlayer(clubB, null, '2011-01-01', mB, adminB);
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('batch of a measurement day', () => {
    const rowUuid = randomUUID();
    let recorded: MeasurementBody;

    it('records the batch with the defaults and replays it by clientUuid', async () => {
      const batch = [
        {
          clientUuid: rowUuid,
          playerId: p15,
          measuredOn: today,
          heightCm: 165.4,
          sittingHeightCm: 84.2,
          weightKg: 55.1,
        },
        { playerId: p15NoParents, measuredOn: today, weightKg: 50 },
      ];
      const first = await record(scM15, batch);
      expect(first.statusCode, first.body).toBe(201);
      const body = first.json<{
        measurements: { measurement: MeasurementBody; replayed: boolean }[];
      }>();
      expect(body.measurements.map((m) => m.replayed)).toEqual([false, false]);
      const [own] = body.measurements;
      if (own === undefined) throw new Error('no measurement');
      recorded = own.measurement;
      expect(recorded).toMatchObject({
        playerId: p15,
        heightCm: 165.4,
        sittingHeightCm: 84.2,
        weightKg: 55.1,
        skinfoldsSumMm: null,
        method: 'manual',
        evaluatorId: scM15.userId,
      });
      // The worker has not run: the outbox has the recalculation pending.
      expect(recorded.maturation.derivedAt).toBeNull();

      const again = await record(scM15, [batch[0]]);
      expect(again.statusCode, again.body).toBe(201);
      const replayed = again.json<{
        measurements: { measurement: MeasurementBody; replayed: boolean }[];
      }>().measurements;
      expect(replayed.map((m) => [m.measurement.id, m.replayed])).toEqual([[recorded.id, true]]);
      const { rows } = await database.admin.query<{ n: string }>(
        `select count(*)::text as n from anthro_measurement where club_id = $1`,
        [clubA],
      );
      expect(rows[0]?.n).toBe('2');
    });

    it('checks every row and answers all the issues at once, writing nothing', async () => {
      const response = await record(scM15, [
        { playerId: p15, measuredOn: today, heightCm: 140, sittingHeightCm: 140 },
        { playerId: p15, measuredOn: today, heightCm: 160, skinfoldsSumMm: 60 },
        { playerId: p15, measuredOn: await addDays(today, 1), weightKg: 50 },
        { playerId: p15, measuredOn: today },
        { playerId: pB, measuredOn: today, weightKg: 50 },
      ]);
      expect(response.statusCode, response.body).toBe(400);
      expect(paths(response), response.body).toEqual([
        'body.measurements.0.sittingHeightCm',
        'body.measurements.1.skinfoldsSumMm',
        'body.measurements.2.measuredOn',
        'body.measurements.3.heightCm',
        'body.measurements.4.playerId',
      ]);
      expect((await list(adminA)).length).toBe(2);
    });

    it('takes skinfolds in the performance stage', async () => {
      const response = await record(scM17, [
        { playerId: p17, measuredOn: today, heightCm: 178, weightKg: 72, skinfoldsSumMm: 58.5 },
      ]);
      expect(response.statusCode, response.body).toBe(201);
    });

    it('applies the permission matrix: S&C of the category with a data consent', async () => {
      const row = { playerId: p15, measuredOn: today, weightKg: 55 };
      expect((await record(coachM15, [row])).statusCode).toBe(403);
      // Outside the assignments the player is not even visible (RLS): not found, by field.
      const outside = await record(scM17, [row]);
      expect(outside.statusCode).toBe(400);
      expect(paths(outside)).toEqual(['body.measurements.0.playerId']);
      expect((await record(player15, [row])).statusCode).toBe(403);
      // A missing data consent is the problem of its row, never a silent skip.
      const noConsent = await record(scM15, [
        row,
        { playerId: p15NoConsent, measuredOn: today, weightKg: 50 },
      ]);
      expect(noConsent.statusCode).toBe(400);
      expect(errorOf(noConsent).details).toEqual([
        expect.objectContaining({
          path: ['body', 'measurements', 1, 'playerId'],
          code: 'consent_required',
        }),
      ]);
      expect((await record(adminA, [row])).statusCode).toBe(201);
    });

    it('lists by the scope of the reader', async () => {
      const ofM15 = await list(scM15);
      expect(new Set(ofM15.map((m) => m.playerId))).toEqual(new Set([p15, p15NoParents]));
      expect((await list(scM17)).map((m) => m.playerId)).toEqual([p17]);
      // The coach reads anthropometry (not medical): it is staff data of the category.
      expect((await list(coachM15)).length).toBe(ofM15.length);
      expect(new Set((await list(player15)).map((m) => m.playerId))).toEqual(new Set([p15]));
      expect(await list(adminB)).toEqual([]);
      expect((await list(adminA, `?categoryId=${m15}&limit=1`)).length).toBe(1);
      const other = await t.app.inject({
        url: `/v1/anthro-measurements/${recorded.id}`,
        headers: adminB.headers,
      });
      expect(other.statusCode).toBe(404);
      const fromScM17 = await t.app.inject({
        url: `/v1/anthro-measurements/${recorded.id}`,
        headers: scM17.headers,
      });
      expect(fromScM17.statusCode).toBe(404);
    });

    it('shows the maturation once the worker derived it', async () => {
      await database.admin.query(
        `update anthro_measurement set phv_offset_years = -0.4, maturity_offset_equation = 'moore_2015',
           derived_at = now() where id = $1`,
        [recorded.id],
      );
      await database.admin.query(`delete from derived_refresh where club_id = $1`, [clubA]);
      const response = await t.app.inject({
        url: `/v1/anthro-measurements/${recorded.id}`,
        headers: scM15.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<MeasurementBody>();
      expect(body.maturation.phvOffsetYears).toBe(-0.4);
      expect(body.maturation.derivedAt).not.toBeNull();
      recorded = body;
    });

    it('corrects with a reason and the version read', async () => {
      const url = `/v1/anthro-measurements/${recorded.id}`;
      const noReason = await t.app.inject({
        method: 'PATCH',
        url,
        headers: scM15.headers,
        payload: { version: recorded.version, heightCm: 166.4 },
      });
      expect(noReason.statusCode).toBe(400);
      const stale = await t.app.inject({
        method: 'PATCH',
        url,
        headers: scM15.headers,
        payload: { version: '1', heightCm: 166.4, changeReason: 'Error de tipeo' },
      });
      expect(stale.statusCode).toBe(409);
      const coach = await t.app.inject({
        method: 'PATCH',
        url,
        headers: coachM15.headers,
        payload: { version: recorded.version, heightCm: 166.4, changeReason: 'Error de tipeo' },
      });
      expect(coach.statusCode).toBe(403);
      const badSitting = await t.app.inject({
        method: 'PATCH',
        url,
        headers: scM15.headers,
        payload: { version: recorded.version, sittingHeightCm: 170, changeReason: 'Error' },
      });
      expect(badSitting.statusCode).toBe(400);
      expect(paths(badSitting)).toEqual(['body.sittingHeightCm']);

      const fixed = await t.app.inject({
        method: 'PATCH',
        url,
        headers: { ...scM15.headers, 'x-request-id': 'req-anthro-fix' },
        payload: { version: recorded.version, heightCm: 166.4, changeReason: 'Error de tipeo' },
      });
      expect(fixed.statusCode, fixed.body).toBe(200);
      const body = fixed.json<MeasurementBody>();
      expect(body.heightCm).toBe(166.4);
      expect(body.version).not.toBe(recorded.version);
      // The trigger marked the recalculation: the stored maturation is from before the fix.
      expect(body.maturation.derivedAt).toBeNull();
      const history = await database.admin.query<{ reason: string; request_id: string }>(
        `select reason, request_id from change_history
          where table_name = 'anthro_measurement' and record_id = $1 and reason is not null`,
        [recorded.id],
      );
      expect(history.rows).toEqual([{ reason: 'Error de tipeo', request_id: 'req-anthro-fix' }]);
    });
  });

  describe('test days', () => {
    let yesterday: string;
    let day: string;
    let onTheDay: MeasurementBody;

    beforeAll(async () => {
      yesterday = await addDays(today, -1);
      day = await insertTestDay({
        scheduledOn: yesterday,
        evaluatorId: adminA.userId,
        conditions: { surface: 'grass', standardizedWarmUp: true },
      });
    });

    it('takes the date, the evaluator and the conditions of the day by default', async () => {
      const response = await record(scM15, [{ playerId: p15, testSessionId: day, weightKg: 55.4 }]);
      expect(response.statusCode, response.body).toBe(201);
      const [first] = response.json<{ measurements: { measurement: MeasurementBody }[] }>()
        .measurements;
      if (first === undefined) throw new Error('no measurement');
      onTheDay = first.measurement;
      expect(onTheDay).toMatchObject({
        testSessionId: day,
        measuredOn: yesterday,
        evaluatorId: adminA.userId,
        conditions: { surface: 'grass', standardizedWarmUp: true },
      });
    });

    it('records on the date of the day only', async () => {
      const response = await record(scM15, [
        { playerId: p15, testSessionId: day, measuredOn: today, weightKg: 55.4 },
      ]);
      expect(response.statusCode, response.body).toBe(400);
      expect(paths(response)).toEqual(['body.measurements.0.measuredOn']);
    });

    it('keeps a correction on the date of its day', async () => {
      const url = `/v1/anthro-measurements/${onTheDay.id}`;
      const moved = await t.app.inject({
        method: 'PATCH',
        url,
        headers: scM15.headers,
        payload: { version: onTheDay.version, measuredOn: today, changeReason: 'Fecha' },
      });
      expect(moved.statusCode, moved.body).toBe(400);
      expect(paths(moved)).toEqual(['body.measuredOn']);
      const fixed = await t.app.inject({
        method: 'PATCH',
        url,
        headers: scM15.headers,
        payload: { version: onTheDay.version, weightKg: 55.6, changeReason: 'Error de tipeo' },
      });
      expect(fixed.statusCode, fixed.body).toBe(200);
      expect(fixed.json<MeasurementBody>()).toMatchObject({
        measuredOn: yesterday,
        weightKg: 55.6,
      });
    });

    it('takes no measurement on a cancelled day', async () => {
      const cancelled = await insertTestDay({ scheduledOn: yesterday, status: 'cancelled' });
      const response = await record(scM15, [
        { playerId: p15, testSessionId: cancelled, weightKg: 55 },
      ]);
      expect(response.statusCode, response.body).toBe(409);
      expect(errorOf(response).code).toBe('conflict');
    });

    it('takes only players of the category and the sport of the day', async () => {
      const ofM17 = await insertTestDay({ scheduledOn: yesterday, categoryId: m17 });
      const ofHockey = await insertTestDay({
        scheduledOn: yesterday,
        sport: 'hockey',
        categoryId: null,
      });
      const response = await record(adminA, [
        { playerId: p15, testSessionId: ofM17, weightKg: 55 },
        { playerId: p15, testSessionId: ofHockey, weightKg: 55 },
      ]);
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).details).toEqual([
        expect.objectContaining({
          path: ['body', 'measurements', 0, 'playerId'],
          message: 'The player is not in the category of the test day',
        }),
        expect.objectContaining({
          path: ['body', 'measurements', 1, 'playerId'],
          message: 'The player is not in the sport of the test day',
        }),
      ]);
    });

    it('takes an evaluator of the staff of the club only', async () => {
      const response = await record(scM15, [
        { playerId: p15, testSessionId: day, weightKg: 55, evaluatorId: player15.userId },
      ]);
      expect(response.statusCode, response.body).toBe(400);
      expect(paths(response)).toEqual(['body.measurements.0.evaluatorId']);
    });
  });

  describe('preview', () => {
    it('computes the maturation with the club table and the history', async () => {
      const response = await preview(scM15, [
        { playerId: p15, measuredOn: today, heightCm: 167, sittingHeightCm: 85, weightKg: 56 },
      ]);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<PreviewBody>();
      expect(body.reference).toEqual({
        code: KHAMIS_ROCHE_1994_TABLE.code,
        verification: KHAMIS_ROCHE_1994_TABLE.provenance.verification,
      });
      const { rows } = await database.admin.query<{
        id: string;
        measured_on: string;
        height_cm: number | null;
        sitting_height_cm: number | null;
        weight_kg: number | null;
      }>(
        `select id, measured_on::text, height_cm, sitting_height_cm, weight_kg
           from anthro_measurement where player_id = $1 order by measured_on, created_at`,
        [p15],
      );
      const expected = deriveMaturation({
        sex: 'male',
        birthDate: parseLocalDate(birth15),
        motherHeightCm: 165,
        fatherHeightCm: 182,
        khamisRocheTable: KHAMIS_ROCHE_1994_TABLE,
        params: DEFAULT_MATURATION_PARAMS,
        measurements: [
          ...rows.map((row) => ({
            id: row.id,
            date: parseLocalDate(row.measured_on),
            heightCm: row.height_cm,
            sittingHeightCm: row.sitting_height_cm,
            weightKg: row.weight_kg,
          })),
          {
            id: 'preview',
            date: parseLocalDate(today),
            heightCm: 167,
            sittingHeightCm: 85,
            weightKg: 56,
          },
        ],
      }).at(-1);
      const [item] = body.items;
      expect(item).toMatchObject({
        playerId: p15,
        stage: 'development',
        phvOffsetYears: expected?.phvOffsetYears,
        maturityOffsetEquation: expected?.maturityOffsetEquation,
        // The seeded equations are not checked against their articles yet: the UI warns.
        maturityOffsetVerification: 'cross_checked_secondary_sources',
        predictedAdultHeightCm: expected?.predictedAdultHeightCm,
        adultHeightPct: expected?.adultHeightPct,
        growthVelocityCmYear: expected?.growthVelocityCmYear,
        gaps: { phvOffset: [], adultHeight: [] },
        plausibility: [],
      });
      expect(item?.adultHeightPct).not.toBeNull();
      // Nothing written.
      const count = await database.admin.query<{ n: string }>(
        `select count(*)::text as n from anthro_measurement where player_id = $1`,
        [p15],
      );
      expect(count.rows[0]?.n).toBe(String(rows.length));
    });

    it('equals what the worker stores for the same measurement', async () => {
      const pW = await insertPlayer(clubA, null, '2011-04-15', m15, adminA);
      for (const [parent, heightCm] of [
        ['mother', 162],
        ['father', 185],
      ] as const) {
        await database.admin.query(
          `insert into player_parent_height (club_id, player_id, parent, height_cm, source)
           values ($1, $2, $3, $4, 'reported')`,
          [clubA, pW, parent, heightCm],
        );
      }
      const earlier = await addDays(today, -200);
      const values = { heightCm: 166.2, sittingHeightCm: 84.6, weightKg: 55.3 };
      const recorded = await record(scM15, [
        { playerId: pW, measuredOn: earlier, heightCm: 160.1, sittingHeightCm: 81.9, weightKg: 50 },
        { playerId: pW, measuredOn: today, ...values },
      ]);
      expect(recorded.statusCode, recorded.body).toBe(201);

      const login = await database.temporary.login('worker');
      const pool = database.temporary.pool({ connectionString: login.connectionString, max: 2 });
      await refreshClub({ pool, logger: pino({ level: 'silent' }) }, clubA);
      const { rows } = await database.admin.query<{
        phv_offset_years: number | null;
        maturity_offset_equation: string | null;
        predicted_adult_height_cm: number | null;
        adult_height_pct: number | null;
        growth_velocity_cm_year: number | null;
        derived_at: Date | null;
      }>(
        `select phv_offset_years, maturity_offset_equation, predicted_adult_height_cm,
                adult_height_pct, growth_velocity_cm_year, derived_at
           from anthro_measurement where player_id = $1 and measured_on = $2`,
        [pW, today],
      );
      const [stored] = rows;
      expect(stored?.derived_at).not.toBeNull();
      expect(stored?.adult_height_pct).not.toBeNull();
      expect(stored?.growth_velocity_cm_year).not.toBeNull();

      // The day already stored, previewed again with the same values: the same numbers.
      const response = await preview(scM15, [{ playerId: pW, measuredOn: today, ...values }]);
      expect(response.statusCode, response.body).toBe(200);
      const [item] = response.json<PreviewBody>().items;
      expect(item).toMatchObject({
        phvOffsetYears: stored?.phv_offset_years,
        maturityOffsetEquation: stored?.maturity_offset_equation,
        predictedAdultHeightCm: stored?.predicted_adult_height_cm,
        adultHeightPct: stored?.adult_height_pct,
        growthVelocityCmYear: stored?.growth_velocity_cm_year,
      });
    });

    it('says why a value is missing and which values look like a typo', async () => {
      const response = await preview(scM15, [
        { playerId: p15NoParents, measuredOn: today, heightCm: 160, weightKg: 5.2 },
      ]);
      expect(response.statusCode, response.body).toBe(200);
      const [item] = response.json<PreviewBody>().items;
      expect(item?.phvOffsetYears).not.toBeNull();
      expect(item?.adultHeightPct).toBeNull();
      expect(item?.gaps.adultHeight).toEqual(['parent_heights_missing']);
      expect(item?.plausibility).toEqual([
        expect.objectContaining({ field: 'weightKg', status: 'below', suggestedValues: [52] }),
      ]);
    });

    it('has no reference without the seeded table', async () => {
      const response = await preview(adminB, [
        { playerId: pB, measuredOn: today, heightCm: 160, weightKg: 52 },
      ]);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<PreviewBody>();
      expect(body.reference).toBeNull();
      expect(body.items[0]?.gaps.adultHeight).toEqual([
        'parent_heights_missing',
        'no_reference_table',
      ]);
    });

    it('previews the whole squad, blocking only who has no data consent', async () => {
      const response = await preview(scM15, [
        { playerId: p15, measuredOn: today },
        { playerId: p15NoConsent, measuredOn: today, heightCm: 160 },
      ]);
      expect(response.statusCode, response.body).toBe(200);
      const [empty, blocked] = response.json<PreviewBody>().items;
      expect(empty).toMatchObject({
        blockedBy: null,
        phvOffsetYears: null,
        gaps: { phvOffset: ['height_missing'], adultHeight: ['height_missing', 'weight_missing'] },
      });
      expect(blocked).toMatchObject({
        blockedBy: 'consent_required',
        ageYears: null,
        phvOffsetYears: null,
        gaps: { phvOffset: [], adultHeight: [] },
      });
    });

    it('is for who records', async () => {
      const row = { playerId: p15, measuredOn: today, heightCm: 160 };
      expect((await preview(coachM15, [row])).statusCode).toBe(403);
      expect((await preview(scM17, [row])).statusCode).toBe(400);
      const unknown = await preview(scM15, [{ ...row, playerId: pB }]);
      expect(unknown.statusCode).toBe(400);
      expect(paths(unknown)).toEqual(['body.measurements.0.playerId']);
    });
  });
});
