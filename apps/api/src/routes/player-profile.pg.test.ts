/**
 * Reads of the player profile end to end (B-404, ADR 0060) against Postgres
 * 16, through the real connection roles: the permission matrix per block,
 * RLS behind it (another club or out of scope: `not_found`), the derived
 * series as the worker leaves them, the availability without the cause
 * (and its audit), and the comparison groups as aggregates only.
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
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
  error: { code: string; message: string };
}

const SUPPORT_REASON = encodeURIComponent('Alta del club para los tests de la ficha');

vi.setConfig({ testTimeout: 30_000 });

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('player profile reads (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let coach17: SignedIn;
  let playerUser: SignedIn;
  let parentUser: SignedIn;
  let clubA: ClubId;
  let today: string;
  const categories: Record<string, string> = {};
  /** The subject: M15, signed in as `playerUser`, guardian `parentUser`. */
  let subject: string;
  /** Nine more M15 players with a CMJ in V1 (ten with the subject). */
  const peers: string[] = [];
  let p17: string;
  let v1: string;
  let v2: string;

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });
  const get = (caller: SignedIn, url: string) => t.app.inject({ url, headers: caller.headers });

  async function createClub(slug: string): Promise<ClubId> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: {
        slug,
        name: `Club ${slug}`,
        shortName: slug.toUpperCase(),
        branches: [{ sport: 'rugby', sex: 'male' }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  async function insertPlayer(
    categoryId: string,
    birthDate: string,
    userId: string | null = null,
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', $3, $4, 'male', 'rugby', '2020-01-01') returning id`,
      [clubA, userId, `P${randomUUID().slice(0, 6)}`, birthDate],
    );
    const id = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, id, categoryId],
    );
    return id;
  }

  async function assign(membershipId: string, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, membershipId, categoryId],
    );
  }

  /** A done result with its attempts, as the API leaves it. */
  async function result(
    playerId: string,
    testCode: string,
    measuredOn: string,
    values: Record<string, number[]>,
    method = 'manual',
  ): Promise<void> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, method)
       select $1, $2, d.id, $4, 'done', $5 from test_definition d
        where d.club_id = $1 and d.code = $3 order by d.version desc limit 1
       returning id`,
      [clubA, playerId, testCode, measuredOn, method],
    );
    const resultId = rows[0]?.id;
    if (resultId === undefined) throw new Error(`No definition for ${testCode}`);
    for (const [metric, attempts] of Object.entries(values)) {
      for (const [index, value] of attempts.entries()) {
        await database.admin.query(
          `insert into test_result_value (club_id, test_result_id, metric_definition_id, attempt_number, value, unit)
           select $1, $2, m.id, $4, $5, m.unit from metric_definition m where m.club_id = $1 and m.code = $3`,
          [clubA, resultId, metric, attempts.length === 1 ? null : index + 1, value],
        );
      }
    }
  }

  const day = (offset: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
        read: {
          perIp: { name: 'api_read_ip', max: 10_000, windowS: 60 },
          perUser: { name: 'api_read_user', max: 10_000, windowS: 60 },
        },
        write: {
          perIp: { name: 'api_write_ip', max: 10_000, windowS: 60 },
          perUser: { name: 'api_write_user', max: 10_000, windowS: 60 },
        },
      },
    });
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@ficha-a.example.com');
    adminB = await signIn(t, 'admin@ficha-b.example.com');
    scA = await signIn(t, 'sc@ficha-a.example.com');
    coachA = await signIn(t, 'coach@ficha-a.example.com');
    coach17 = await signIn(t, 'coach17@ficha-a.example.com');
    playerUser = await signIn(t, 'player@ficha-a.example.com');
    parentUser = await signIn(t, 'parent@ficha-a.example.com');

    clubA = await createClub('ficha-a');
    const clubB = await createClub('ficha-b');
    const { rows } = await database.admin.query<{ id: string; age_band_code: string }>(
      `select id, age_band_code from category where club_id = $1`,
      [clubA],
    );
    for (const row of rows) categories[row.age_band_code] = row.id;
    const zone = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = zone.rows[0]?.today ?? '';

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const sc = await createMembership(database.admin, scA.userId, clubA, 'sc');
    const coach = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    const c17 = await createMembership(database.admin, coach17.userId, clubA, 'coach');
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    await createMembership(database.admin, parentUser.userId, clubA, 'parent');
    await assign(sc, categories.m15 ?? '');
    await assign(coach, categories.m15 ?? '');
    await assign(c17, categories.m17 ?? '');

    subject = await insertPlayer(categories.m15 ?? '', '2011-05-01', playerUser.userId);
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, subject, parentUser.userId],
    );
    for (let i = 0; i < 9; i += 1) {
      peers.push(await insertPlayer(categories.m15 ?? '', '2011-08-01'));
    }
    p17 = await insertPlayer(categories.m17 ?? '', '2009-03-01');

    // Season of 2026 with V1 (February) and V2 (April).
    const seasonRow = await database.admin.query<{ id: string }>(
      `insert into season (club_id, sport, name, starts_on, ends_on)
       values ($1, 'rugby', 'Temporada 2026', '2026-02-01', '2026-11-30') returning id`,
      [clubA],
    );
    const seasonId = seasonRow.rows[0]?.id ?? '';
    const windows = await database.admin.query<{ id: string; number: number }>(
      `insert into test_window (club_id, season_id, number, starts_on, ends_on)
       values ($1, $2, 1, '2026-02-01', '2026-02-28'), ($1, $2, 2, '2026-04-01', '2026-04-30')
       returning id, number`,
      [clubA, seasonId],
    );
    v1 = windows.rows.find((w) => w.number === 1)?.id ?? '';
    v2 = windows.rows.find((w) => w.number === 2)?.id ?? '';

    // CMJ: subject 40 cm (best of 3) in V1 and 42 in V2; peers 30..38 in V1; three peers in V2.
    await result(subject, 'cmj', '2026-02-10', { cmj_height_cm: [38, 40, 39.5] });
    await result(subject, 'cmj', '2026-04-10', { cmj_height_cm: [42, 41] });
    for (const [index, peer] of peers.entries()) {
      await result(peer, 'cmj', '2026-02-10', { cmj_height_cm: [30 + index] });
      if (index < 3) await result(peer, 'cmj', '2026-04-10', { cmj_height_cm: [33 + index] });
    }
    // Another category's value never enters the M15 group.
    await result(p17, 'cmj', '2026-02-10', { cmj_height_cm: [60] });
    // Only the subject has a 30-15 IFT: no percentile.
    await result(subject, 'ift_3015', '2026-02-12', { vift_kmh: [18.5] });

    // Derived series as the worker writes them.
    for (let offset = -30; offset <= 0; offset += 1) {
      await database.admin.query(
        `insert into player_load_daily (club_id, player_id, local_date, load_au, has_data, sessions_n,
           pending_rpe_n, history_days, acute_ewma_au, chronic_ewma_au, acwr, acwr_status,
           missing_days_acute, missing_days_chronic, window_load_au, monotony, strain_au, monotony_status)
         values ($1, $2, $3, $4, $5, $6, 0, $7, 300, 250, $8, $9, 0, 0, 1800, $10, $11, $12)`,
        [
          clubA,
          subject,
          day(offset),
          offset % 2 === 0 ? 400 : 0,
          offset % 2 === 0,
          offset % 2 === 0 ? 1 : 0,
          31 + offset,
          offset > -3 ? 1.2 : null,
          offset > -3 ? 'ok' : 'insufficient_history',
          offset > -3 ? 1.5 : null,
          offset > -3 ? 2700 : null,
          offset > -3 ? 'ok' : 'insufficient_history',
        ],
      );
    }
    await database.admin.query(
      `insert into player_wellness_daily (club_id, player_id, local_date, item_count, mean_score,
         baseline_samples, baseline_mean_score, baseline_sd_score, z_score)
       values ($1, $2, $3, 5, 3.4, 12, 4.0, 0.4, -1.5)`,
      [clubA, subject, day(-1)],
    );
    await database.admin.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, sitting_height_cm,
         weight_kg, phv_offset_years, maturity_offset_equation, predicted_adult_height_cm,
         adult_height_pct, khamis_roche_table_id, growth_velocity_cm_year, derived_at)
       values ($1, $2, '2026-03-01', 168, 86, 58, 0.4, 'moore_2015', 182, 92.3,
               (select id from khamis_roche_table where club_id = $1 limit 1), 8.5, now()),
              ($1, $2, '2025-09-01', 164, 84, 55, null, null, null, null, null, null, null)`,
      [clubA, subject],
    );
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('daily monitoring', () => {
    it('gives the last 28 days of load and the wellness to the assigned staff', async () => {
      const response = await get(scA, `/v1/players/${subject}/daily-monitoring`);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<{
        from: string;
        to: string;
        today: string;
        refreshPending: boolean;
        load: { date: string; loadAu: number; acwr: number | null; acwrStatus: string }[];
        wellness: { date: string; meanScore: number; zScore: number | null }[];
      }>();
      expect(body).toMatchObject({ from: day(-27), to: today, today, refreshPending: false });
      expect(body.load).toHaveLength(28);
      expect(body.load.at(-1)).toMatchObject({ date: today, acwr: 1.2, acwrStatus: 'ok' });
      expect(body.load[0]).toMatchObject({ acwr: null, acwrStatus: 'insufficient_history' });
      expect(body.wellness).toEqual([
        expect.objectContaining({ date: day(-1), meanScore: 3.4, zScore: -1.5 }),
      ]);
    });

    it('lets the player read their own, never the guardian', async () => {
      expect((await get(playerUser, `/v1/players/${subject}/daily-monitoring`)).statusCode).toBe(
        200,
      );
      const parent = await get(parentUser, `/v1/players/${subject}/daily-monitoring`);
      expect(parent.statusCode, parent.body).toBe(403);
    });

    it('answers not found out of scope and in another club', async () => {
      const outOfScope = await get(coach17, `/v1/players/${subject}/daily-monitoring`);
      expect(outOfScope.statusCode).toBe(404);
      expect(errorOf(outOfScope).code).toBe('not_found');
      expect((await get(adminB, `/v1/players/${subject}/daily-monitoring`)).statusCode).toBe(404);
    });

    it('rejects a reversed or too long range', async () => {
      const reversed = await get(
        scA,
        `/v1/players/${subject}/daily-monitoring?from=${today}&to=${day(-1)}`,
      );
      expect(reversed.statusCode).toBe(400);
      const long = await get(
        scA,
        `/v1/players/${subject}/daily-monitoring?from=${day(-400)}&to=${today}`,
      );
      expect(long.statusCode).toBe(400);
    });
  });

  describe('maturation', () => {
    it('gives the measurements with what the worker derived, newest first, and the stage', async () => {
      const response = await get(coachA, `/v1/players/${subject}/maturation`);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<{
        stage: { stage: string; basis: string; categoryId: string } | null;
        measurements: { measuredOn: string; phvOffsetYears: number | null }[];
      }>();
      expect(body.stage).toEqual({
        stage: 'development',
        basis: 'category',
        categoryId: categories.m15,
      });
      expect(body.measurements.map((m) => m.measuredOn)).toEqual(['2026-03-01', '2025-09-01']);
      expect(body.measurements[0]).toMatchObject({
        heightCm: 168,
        phvOffsetYears: 0.4,
        maturityOffsetEquation: 'moore_2015',
        adultHeightPct: 92.3,
        growthVelocityCmYear: 8.5,
      });
      expect(body.measurements[1]).toMatchObject({ phvOffsetYears: null, derivedAt: null });
    });
  });

  describe('availability', () => {
    beforeAll(async () => {
      const client = await database.admin.connect();
      try {
        await client.query('begin');
        await client.query(
          `select set_config('app.club_id', $1, true), set_config('app.request_id', 'seed', true)`,
          [clubA],
        );
        await client.query(
          `insert into medical.hold (club_id, player_id, training, match, valid_from, valid_to, staff_note)
           values ($1, $2, 'limited', 'unavailable', $3, $4, 'Sin contacto')`,
          [clubA, subject, day(-5), day(3)],
        );
        await client.query(
          `insert into medical.injury (club_id, player_id, onset_on, context, body_region, side, onset, mechanism, diagnosis)
           values ($1, $2, $3, 'match', 'knee', 'left', 'acute', 'contact', 'Esguince LCM')`,
          [clubA, subject, day(-5)],
        );
        await client.query('commit');
      } finally {
        client.release();
      }
    });

    it('gives the coach the status and its history, never the cause', async () => {
      const response = await get(coachA, `/v1/players/${subject}/availability`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body).not.toContain('Esguince');
      expect(response.body).not.toContain('knee');
      const body = response.json<{
        from: string;
        current: { training: string; match: string; overall: string; staffNotes: string[] };
        periods: { from: string; to: string; overall: string }[];
      }>();
      expect(body.from).toBe(day(-89));
      expect(body.current).toEqual({
        training: 'limited',
        match: 'unavailable',
        overall: 'unavailable',
        staffNotes: ['Sin contacto'],
      });
      expect(body.periods).toEqual([
        expect.objectContaining({ from: day(-89), to: day(-6), overall: 'available' }),
        expect.objectContaining({ from: day(-5), to: today, overall: 'unavailable' }),
      ]);
      const log = await database.admin.query<{ n: string }>(
        `select count(*)::text as n from medical.access_log
          where club_id = $1 and resource = 'availability' and player_id = $2 and actor_user_id = $3`,
        [clubA, subject, coachA.userId],
      );
      expect(Number(log.rows[0]?.n)).toBeGreaterThanOrEqual(2);
    });

    it('shows the guardian the status without the staff notes', async () => {
      const response = await get(parentUser, `/v1/players/${subject}/availability`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<{ current: { staffNotes: string[] } }>().current.staffNotes).toEqual([]);
    });

    it('answers not found out of scope', async () => {
      expect((await get(coach17, `/v1/players/${subject}/availability`)).statusCode).toBe(404);
    });
  });

  describe('percentiles', () => {
    interface Item {
      metricCode: string;
      status: string;
      percentile: number | null;
      sampleSize: number | null;
      median: number | null;
      value: number;
      grouping: { dimensions: string[]; seasonsAccumulated: number } | null;
    }

    it('places the latest value in the group with only aggregates of the others', async () => {
      const response = await get(scA, `/v1/players/${subject}/percentiles`);
      expect(response.statusCode, response.body).toBe(200);
      for (const peer of [...peers, p17]) expect(response.body).not.toContain(peer);
      const body = response.json<{ minSampleSize: number; items: Item[] }>();
      expect(body.minSampleSize).toBe(10);
      const cmj = body.items.find((i) => i.metricCode === 'cmj_height_cm');
      // Latest is 42 (V2); the peers count with their best (30–38): the best of ten.
      expect(cmj).toMatchObject({
        status: 'ok',
        value: 42,
        sampleSize: 10,
        percentile: 95,
        grouping: { dimensions: ['sex', 'category'], seasonsAccumulated: 3 },
      });
      expect(cmj?.median).toBeCloseTo(35, 5);
      expect(body.items.find((i) => i.metricCode === 'vift_kmh')).toMatchObject({
        status: 'insufficient_sample',
        percentile: null,
        sampleSize: null,
      });
    });

    it('lets an M15 player see their own, never the guardian', async () => {
      expect((await get(playerUser, `/v1/players/${subject}/percentiles`)).statusCode).toBe(200);
      expect((await get(parentUser, `/v1/players/${subject}/percentiles`)).statusCode).toBe(403);
    });
  });

  describe('test evolution', () => {
    it('gives the value by window and the category average from five players', async () => {
      const response = await get(coachA, `/v1/players/${subject}/test-evolution`);
      expect(response.statusCode, response.body).toBe(200);
      for (const peer of peers) expect(response.body).not.toContain(peer);
      const body = response.json<{
        columns: { key: string; testWindowId: string | null; number: number | null }[];
        metrics: {
          metricCode: string;
          warnings: string[];
          points: {
            columnKey: string;
            value: number;
            categoryAverage: number | null;
            categorySize: number | null;
          }[];
        }[];
      }>();
      expect(body.columns.map((c) => [c.testWindowId, c.number])).toEqual([
        [v1, 1],
        [v2, 2],
      ]);
      const cmj = body.metrics.find((m) => m.metricCode === 'cmj_height_cm');
      expect(cmj?.points).toEqual([
        expect.objectContaining({ columnKey: `w:${v1}`, value: 40, categorySize: 10 }),
        expect.objectContaining({
          columnKey: `w:${v2}`,
          value: 42,
          categorySize: null,
          categoryAverage: null,
        }),
      ]);
      // (40 + 30 + … + 38) / 10, without the M17 player.
      expect(cmj?.points[0]?.categoryAverage).toBeCloseTo(34.6, 5);
      expect(cmj?.warnings).toEqual([]);
    });

    it('answers not found out of scope and in another club', async () => {
      expect((await get(coach17, `/v1/players/${subject}/test-evolution`)).statusCode).toBe(404);
      expect((await get(adminB, `/v1/players/${subject}/test-evolution`)).statusCode).toBe(404);
    });
  });

  // Runs last: it adds a peer and a measurement the blocks above do not expect.
  describe('comparison groups that cannot be differenced (ADR 0060)', () => {
    beforeAll(async () => {
      // A new M15 player measured late in V1, after the subject's day.
      const late = await insertPlayer(categories.m15 ?? '', '2011-07-01');
      await result(late, 'cmj', '2026-02-20', { cmj_height_cm: [45] });
      await database.admin.query(
        `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, sitting_height_cm,
           weight_kg, phv_offset_years, maturity_offset_equation, growth_velocity_cm_year, derived_at)
         values ($1, $2, $3, 170, 87, 59, 0.6, 'moore_2015', 8.1, now())`,
        [clubA, subject, day(-10)],
      );
    });

    const v1Point = async (caller: SignedIn, query: string) => {
      const response = await get(caller, `/v1/players/${subject}/test-evolution${query}`);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<{
        metrics: {
          metricCode: string;
          points: {
            columnKey: string;
            categoryAverage: number | null;
            categorySize: number | null;
          }[];
        }[];
      }>();
      return body.metrics
        .find((m) => m.metricCode === 'cmj_height_cm')
        ?.points.find((p) => p.columnKey === `w:${v1}`);
    };

    it('gives the same window average for two ranges that split the window', async () => {
      const early = await v1Point(playerUser, '?to=2026-02-15');
      const whole = await v1Point(playerUser, '?to=2026-02-28');
      const subjectDay = await v1Point(playerUser, '?from=2026-02-10&to=2026-02-10');
      // (40 + 30 + … + 38 + 45) / 11: the late peer is in, whatever the range.
      expect(early?.categorySize).toBe(11);
      expect(early?.categoryAverage).toBeCloseTo((346 + 45) / 11, 5);
      expect(whole).toEqual(early);
      expect(subjectDay).toEqual(early);
      // A range without the subject's day in V1 has no V1 column at all.
      expect(await v1Point(playerUser, '?from=2026-02-15&to=2026-02-28')).toBeUndefined();
    });

    it('keeps `asOf` on today for the player and never after today', async () => {
      const own = await get(playerUser, `/v1/players/${subject}/percentiles?asOf=2026-02-15`);
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json<{ asOf: string }>().asOf).toBe(today);
      const future = await get(scA, `/v1/players/${subject}/percentiles?asOf=${day(30)}`);
      expect(future.json<{ asOf: string }>().asOf).toBe(today);
      const past = await get(scA, `/v1/players/${subject}/percentiles?asOf=2026-03-01`);
      expect(past.statusCode, past.body).toBe(200);
      expect(past.json<{ asOf: string }>().asOf).toBe('2026-03-01');
    });

    it('gives the peak zone with the maturation, without reading alerts', async () => {
      const response = await get(coachA, `/v1/players/${subject}/maturation`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<{ peakZone: unknown }>().peakZone).toEqual({
        inZone: true,
        offset: 'met',
        growthVelocity: 'disabled',
        measuredOn: day(-10),
      });
    });
  });
});
