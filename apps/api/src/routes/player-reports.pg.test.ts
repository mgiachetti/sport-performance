/**
 * Player reports end to end (B-602, ADR 0069) against Postgres 16, through
 * the real connection roles: who asks and who reads (permission matrix and
 * RLS), the window rules, idempotency, and the snapshot — the player's own
 * values, the category's average only with the window over and at least
 * five players, the first team's reference, the maturation, and never the
 * name or value of another player nor the cause of an unavailability.
 */
import { randomUUID } from 'node:crypto';
import type { PlayerReport, PlayerReportContent } from '@sport-performance/contracts';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
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

const SUPPORT_REASON = encodeURIComponent('Alta del club para los tests de informes');

vi.setConfig({ testTimeout: 30_000 });

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('player reports (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let sc17: SignedIn;
  let playerUser: SignedIn;
  let parentUser: SignedIn;
  let clubA: ClubId;
  const categories: Record<string, string> = {};
  let subject: string;
  const peers: string[] = [];
  let v1: string;
  let v2: string;
  let future: string;
  let hockeyWindow: string;

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });
  const get = (caller: SignedIn, url: string) => t.app.inject({ url, headers: caller.headers });
  const ask = (caller: SignedIn, playerId: string, payload: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/players/${playerId}/reports`,
      headers: caller.headers,
      payload,
    });

  async function createClub(slug: string): Promise<ClubId> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: {
        slug,
        name: `Club ${slug}`,
        shortName: slug.toUpperCase(),
        branches: [
          { sport: 'rugby', sex: 'male' },
          { sport: 'hockey', sex: 'female' },
        ],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  async function insertPlayer(
    categoryId: string,
    birthDate: string,
    options: { userId?: string | null; lastName?: string } = {},
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', $3, $4, 'male', 'rugby', '2020-01-01') returning id`,
      [
        clubA,
        options.userId ?? null,
        options.lastName ?? `P${randomUUID().slice(0, 6)}`,
        birthDate,
      ],
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

  async function contentOf(reportId: string): Promise<PlayerReportContent> {
    const { rows } = await database.admin.query<{ content: PlayerReportContent }>(
      'select content from player_report where id = $1',
      [reportId],
    );
    const content = rows[0]?.content;
    if (content === undefined) throw new Error('No report');
    return content;
  }

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
    adminA = await signIn(t, 'admin@informe-a.example.com');
    adminB = await signIn(t, 'admin@informe-b.example.com');
    scA = await signIn(t, 'sc@informe-a.example.com');
    coachA = await signIn(t, 'coach@informe-a.example.com');
    sc17 = await signIn(t, 'sc17@informe-a.example.com');
    playerUser = await signIn(t, 'player@informe-a.example.com');
    parentUser = await signIn(t, 'parent@informe-a.example.com');

    clubA = await createClub('informe-a');
    const clubB = await createClub('informe-b');
    const { rows } = await database.admin.query<{
      id: string;
      age_band_code: string;
      sport: string;
    }>(`select id, age_band_code, sport from category where club_id = $1`, [clubA]);
    for (const row of rows) categories[`${row.sport}:${row.age_band_code}`] = row.id;

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const sc = await createMembership(database.admin, scA.userId, clubA, 'sc');
    const coach = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    const s17 = await createMembership(database.admin, sc17.userId, clubA, 'sc');
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    await createMembership(database.admin, parentUser.userId, clubA, 'parent');
    const m15 = categories['rugby:m15'] ?? '';
    await assign(sc, m15);
    await assign(coach, m15);
    await assign(s17, categories['rugby:m17'] ?? '');

    subject = await insertPlayer(m15, '2011-05-01', {
      userId: playerUser.userId,
      lastName: 'Sujeto',
    });
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, subject, parentUser.userId],
    );
    for (let i = 0; i < 6; i += 1) {
      peers.push(await insertPlayer(m15, '2011-08-01', { lastName: `Companero${String(i)}` }));
    }

    const seasonRow = await database.admin.query<{ id: string }>(
      `insert into season (club_id, sport, name, starts_on, ends_on)
       values ($1, 'rugby', 'Temporada 2026', '2026-02-01', '2026-11-30') returning id`,
      [clubA],
    );
    const seasonId = seasonRow.rows[0]?.id ?? '';
    const windows = await database.admin.query<{ id: string; number: number }>(
      `insert into test_window (club_id, season_id, number, starts_on, ends_on)
       values ($1, $2, 1, '2026-02-01', '2026-02-28'), ($1, $2, 2, '2026-04-01', '2026-04-30'),
              ($1, $2, 4, '2099-11-01', '2099-11-30')
       returning id, number`,
      [clubA, seasonId],
    );
    v1 = windows.rows.find((w) => w.number === 1)?.id ?? '';
    v2 = windows.rows.find((w) => w.number === 2)?.id ?? '';
    future = windows.rows.find((w) => w.number === 4)?.id ?? '';
    const hockey = await database.admin.query<{ id: string }>(
      `with s as (insert into season (club_id, sport, name, starts_on, ends_on)
                  values ($1, 'hockey', 'Hockey 2026', '2026-02-01', '2026-11-30') returning id)
       insert into test_window (club_id, season_id, number, starts_on, ends_on)
       select $1, s.id, 1, '2026-02-01', '2026-02-28' from s returning id`,
      [clubA],
    );
    hockeyWindow = hockey.rows[0]?.id ?? '';

    // CMJ: subject 40 in V1 and 42 in V2; six peers 30..35 in V1, two in V2 (below the minimum).
    await result(subject, 'cmj', '2026-02-10', { cmj_height_cm: [38, 40, 39.5] });
    await result(subject, 'cmj', '2026-04-10', { cmj_height_cm: [42, 41] }, 'video');
    for (const [index, peer] of peers.entries()) {
      await result(peer, 'cmj', '2026-02-10', { cmj_height_cm: [30 + index] });
      if (index < 2) await result(peer, 'cmj', '2026-04-10', { cmj_height_cm: [33 + index] });
    }
    // The subject was injured for the 505 of V2: the family reads "not available".
    await database.admin.query(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, not_done_reason)
       select $1, $2, d.id, '2026-04-12', 'not_done', 'injured' from test_definition d
        where d.club_id = $1 and d.code = 'cod_505' order by d.version desc limit 1`,
      [clubA, subject],
    );
    // First-team reference of the CMJ.
    await database.admin.query(
      `insert into reference_value
         (club_id, metric_definition_id, sport, sex, value, unit, method, valid_from, source)
       select $1, d.id, 'rugby', 'male', 52, d.unit, 'video', '2025-01-01', 'Primera 2025'
         from metric_definition d where d.club_id = $1 and d.code = 'cmj_height_cm'`,
      [clubA],
    );
    await database.admin.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, sitting_height_cm,
         weight_kg, phv_offset_years, maturity_offset_equation, growth_velocity_cm_year)
       values ($1, $2, '2026-02-05', 165, 84, 55, -0.2, 'moore_2015', 9.1),
              ($1, $2, '2026-04-05', 168, 86, 58, 0.1, 'moore_2015', 8.4),
              ($1, $2, '2026-09-05', 171, 87, 60, 0.5, 'moore_2015', 7)`,
      [clubA, subject],
    );
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('is asked for by the test staff and the administration only', async () => {
    for (const caller of [playerUser, parentUser, coachA]) {
      const response = await ask(caller, subject, { testWindowId: v1 });
      expect(response.statusCode, response.body).toBe(403);
    }
    // An sc of another category does not see the player: as if it did not exist.
    expect((await ask(sc17, subject, { testWindowId: v1 })).statusCode).toBe(404);
    expect((await ask(adminB, subject, { testWindowId: v1 })).statusCode).toBe(404);
    const byAdmin = await ask(adminA, subject, { testWindowId: v1 });
    expect(byAdmin.statusCode, byAdmin.body).toBe(202);
  });

  it('freezes the window with the profile rules and never other players', async () => {
    const clientUuid = randomUUID();
    const response = await ask(scA, subject, { clientUuid, testWindowId: v2 });
    expect(response.statusCode, response.body).toBe(202);
    const report = response.json<PlayerReport>();
    expect(report).toMatchObject({
      playerId: subject,
      testWindowId: v2,
      status: 'pending',
      fileId: null,
      requestedBy: scA.userId,
      window: { seasonName: 'Temporada 2026', number: 2, startsOn: '2026-04-01' },
    });

    const content = await contentOf(report.id);
    expect(content.formatVersion).toBe(1);
    expect(content.player).toMatchObject({
      lastName: 'Sujeto',
      birthDate: '2011-05-01',
      ageYears: 14,
      sport: 'rugby',
    });
    expect(content.window).toMatchObject({ number: 2, closed: true });
    const cmj = content.tests.find((test) => test.metricCode === 'cmj_height_cm');
    expect(cmj).toMatchObject({
      value: 42,
      methods: ['video'],
      protocolVersion: 1,
      previous: { number: 1, value: 40, methods: ['manual'], protocolVersion: 1 },
      // Two peers in V2 plus the subject: below the minimum of five, no average nor size.
      categoryAverage: null,
      firstTeam: { value: 52, unit: 'cm', scope: 'squad' },
      warnings: ['mixed_methods'],
    });
    // V1 had seven players: its average is there, in the evolution.
    const series = content.evolution.metrics.find((m) => m.metricCode === 'cmj_height_cm');
    expect(series?.points.map((p) => p.categoryAverage)).toEqual([
      (40 + 30 + 31 + 32 + 33 + 34 + 35) / 7,
      null,
    ]);
    expect(content.evolution.columns.map((c) => c.number)).toEqual([1, 2]);
    // An injury is only "not available".
    expect(content.notDone).toEqual([
      { testCode: 'cod_505', measuredOn: '2026-04-12', reason: 'unavailable' },
    ]);
    // The latest measurement until the end of the window, not the later one.
    expect(content.maturation).toMatchObject({
      measuredOn: '2026-04-05',
      heightCm: 168,
      phvOffsetYears: 0.1,
      inPeakZone: true,
    });
    // Nothing of the other players: neither names nor ids.
    const text = JSON.stringify(content);
    expect(text).not.toMatch(/Companero/);
    for (const peer of peers) expect(text).not.toContain(peer);
    expect(text).not.toMatch(/injured/);

    // A retry is the same report; the same clientUuid for another window is not.
    const replay = await ask(scA, subject, { clientUuid, testWindowId: v2 });
    expect(replay.statusCode).toBe(202);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.json<PlayerReport>().id).toBe(report.id);
    expect((await ask(scA, subject, { clientUuid, testWindowId: v1 })).statusCode).toBe(409);
  });

  it('only takes a started window of the player sport', async () => {
    const notStarted = await ask(scA, subject, { testWindowId: future });
    expect(notStarted.statusCode).toBe(409);
    const otherSport = await ask(scA, subject, { testWindowId: hockeyWindow });
    expect(otherSport.statusCode).toBe(400);
    const missing = await ask(scA, subject, { testWindowId: randomUUID() });
    expect(missing.statusCode).toBe(404);
    expect(errorOf(missing).code).toBe('not_found');
  });

  it('is read by the player, the guardian, the assigned staff and the administration', async () => {
    const created = (await ask(scA, subject, { testWindowId: v1 })).json<PlayerReport>();
    for (const caller of [playerUser, parentUser, coachA, scA, adminA]) {
      const list = await get(caller, `/v1/players/${subject}/reports?testWindowId=${v1}`);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json<{ items: PlayerReport[] }>().items.map((r) => r.id)).toContain(created.id);
      const one = await get(caller, `/v1/player-reports/${created.id}`);
      expect(one.statusCode, one.body).toBe(200);
    }
    for (const caller of [sc17, adminB]) {
      expect((await get(caller, `/v1/player-reports/${created.id}`)).statusCode).toBe(404);
      expect((await get(caller, `/v1/players/${subject}/reports`)).statusCode).toBe(404);
    }
    // Newest first, by cursor.
    const page = await get(adminA, `/v1/players/${subject}/reports?limit=1`);
    const body = page.json<{ items: PlayerReport[]; nextCursor: string | null }>();
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });
});
