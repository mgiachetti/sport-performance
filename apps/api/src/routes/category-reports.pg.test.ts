/**
 * Category reports end to end (B-603, ADR 0073) against Postgres 16, through
 * the real connection roles: who asks and who reads (permission matrix and
 * RLS), the window rules, idempotency, and the snapshot — the battery done,
 * the group's evolution with the minimum of players, the change counted per
 * player, the first team's reference and the response rate — with no name,
 * id or value of any player, nor the cause of an unavailability.
 */
import { randomUUID } from 'node:crypto';
import type { CategoryReport, CategoryReportContent } from '@sport-performance/contracts';
import type { ClubId } from '@sport-performance/domain';
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

const SUPPORT_REASON = encodeURIComponent('Alta del club para los tests de informes');

vi.setConfig({ testTimeout: 30_000 });

describeWithPostgres('category reports (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let sc17: SignedIn;
  let playerUser: SignedIn;
  let clubA: ClubId;
  const categories: Record<string, string> = {};
  let m15: string;
  const players: string[] = [];
  let v1: string;
  let v2: string;
  let future: string;
  let hockeyWindow: string;

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });
  const get = (caller: SignedIn, url: string) => t.app.inject({ url, headers: caller.headers });
  const ask = (caller: SignedIn, categoryId: string, payload: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/categories/${categoryId}/reports`,
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

  async function insertPlayer(categoryId: string, lastName: string): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, 'Juan', $2, '2011-06-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubA, lastName],
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

  async function notDone(playerId: string, testCode: string, on: string, reason: string) {
    await database.admin.query(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, not_done_reason)
       select $1, $2, d.id, $4, 'not_done', $5 from test_definition d
        where d.club_id = $1 and d.code = $3 order by d.version desc limit 1`,
      [clubA, playerId, testCode, on, reason],
    );
  }

  async function session(localDate: string): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into training_session
         (club_id, sport, kind, category_id, title, starts_at, local_date, planned_duration_min)
       values ($1, 'rugby', 'training', $2, 'Entrenamiento',
               ($3::date + time '18:00') at time zone 'America/Argentina/Buenos_Aires', $3, 80)
       returning id`,
      [clubA, m15, localDate],
    );
    return rows[0]?.id ?? '';
  }

  async function contentOf(reportId: string): Promise<CategoryReportContent> {
    const { rows } = await database.admin.query<{ content: CategoryReportContent }>(
      'select content from category_report where id = $1',
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
    adminA = await signIn(t, 'admin@categoria-a.example.com');
    adminB = await signIn(t, 'admin@categoria-b.example.com');
    scA = await signIn(t, 'sc@categoria-a.example.com');
    coachA = await signIn(t, 'coach@categoria-a.example.com');
    sc17 = await signIn(t, 'sc17@categoria-a.example.com');
    playerUser = await signIn(t, 'player@categoria-a.example.com');

    clubA = await createClub('categoria-a');
    const clubB = await createClub('categoria-b');
    const { rows } = await database.admin.query<{
      id: string;
      age_band_code: string;
      sport: string;
    }>(`select id, age_band_code, sport from category where club_id = $1`, [clubA]);
    for (const row of rows) categories[`${row.sport}:${row.age_band_code}`] = row.id;
    m15 = categories['rugby:m15'] ?? '';

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const sc = await createMembership(database.admin, scA.userId, clubA, 'sc');
    const coach = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    const s17 = await createMembership(database.admin, sc17.userId, clubA, 'sc');
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    await assign(sc, m15);
    await assign(coach, m15);
    await assign(s17, categories['rugby:m17'] ?? '');

    for (let i = 0; i < 6; i += 1) players.push(await insertPlayer(m15, `Jugador${String(i)}`));
    await database.admin.query('update player set user_id = $2 where id = $1', [
      players[0],
      playerUser.userId,
    ]);

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

    // CMJ: six players 30..35 in V1. In V2 players 1..5 jump +2, +2, +2, −1 and +0 (the best
    // of their attempts); player 0 was injured.
    for (const [i, id] of players.entries()) {
      await result(id, 'cmj', '2026-02-10', { cmj_height_cm: [30 + i] });
    }
    const deltas = [2, 2, 2, -1, 0];
    for (const [k, delta] of deltas.entries()) {
      const i = k + 1;
      await result(players[i] ?? '', 'cmj', '2026-04-10', {
        cmj_height_cm: [30 + i + delta, 25],
      });
    }
    await notDone(players[0] ?? '', 'cmj', '2026-04-10', 'injured');
    // Sprint: only two players in V2 (below the minimum), one absent.
    await result(players[1] ?? '', 'sprint_40', '2026-04-11', { sprint_40_s: [5.6] }, 'photocell');
    await result(players[2] ?? '', 'sprint_40', '2026-04-11', { sprint_40_s: [5.7] }, 'photocell');
    await notDone(players[3] ?? '', 'sprint_40', '2026-04-11', 'absent');
    // First-team reference of the CMJ.
    await database.admin.query(
      `insert into reference_value
         (club_id, metric_definition_id, sport, sex, value, unit, method, valid_from, source)
       select $1, d.id, 'rugby', 'male', 52, d.unit, 'video', '2025-01-01', 'Primera 2025'
         from metric_definition d where d.club_id = $1 and d.code = 'cmj_height_cm'`,
      [clubA],
    );

    // Responses: Monday 2 and Wednesday 4 of March (after V1, before V2).
    const monday = await session('2026-03-02');
    const wednesday = await session('2026-03-04');
    for (const [i, id] of players.entries()) {
      await database.admin.query(
        `insert into participation (club_id, training_session_id, player_id, status, minutes, rpe, rpe_reported_at)
         values ($1, $2, $3, 'full', 80, $4, case when $4::smallint is null then null else now() end)`,
        [clubA, monday, id, i < 3 ? 6 : null],
      );
      if (i === 5) {
        await database.admin.query(
          `insert into participation (club_id, training_session_id, player_id, status)
           values ($1, $2, $3, 'absent')`,
          [clubA, wednesday, id],
        );
      } else {
        await database.admin.query(
          `insert into participation (club_id, training_session_id, player_id, status, minutes)
           values ($1, $2, $3, 'full', 80)`,
          [clubA, wednesday, id],
        );
      }
      if (i < 4) {
        await database.admin.query(
          `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
           values ($1, $2, '2026-03-02', 5, 4, 3, 3, 4, 5)`,
          [clubA, id],
        );
      }
    }
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('is asked for by the test staff and the administration only', async () => {
    for (const caller of [playerUser, coachA]) {
      const response = await ask(caller, m15, { testWindowId: v1 });
      expect(response.statusCode, response.body).toBe(403);
    }
    // An sc of another category may not ask for this one.
    expect((await ask(sc17, m15, { testWindowId: v1 })).statusCode).toBe(403);
    expect((await ask(adminB, m15, { testWindowId: v1 })).statusCode).toBe(404);
    const byAdmin = await ask(adminA, m15, { testWindowId: v1 });
    expect(byAdmin.statusCode, byAdmin.body).toBe(202);
  });

  it('freezes the battery, the evolution and the responses as aggregates only', async () => {
    const clientUuid = randomUUID();
    const response = await ask(scA, m15, { clientUuid, testWindowId: v2 });
    expect(response.statusCode, response.body).toBe(202);
    const report = response.json<CategoryReport>();
    expect(report).toMatchObject({
      categoryId: m15,
      testWindowId: v2,
      status: 'pending',
      fileId: null,
      requestedBy: scA.userId,
      window: { seasonName: 'Temporada 2026', number: 2, startsOn: '2026-04-01' },
    });

    const content = await contentOf(report.id);
    expect(content.formatVersion).toBe(1);
    expect(content.category).toMatchObject({ id: m15, sport: 'rugby', sex: 'male' });
    expect(content.window).toMatchObject({ number: 2, closed: true });
    expect(content.roster).toEqual({
      players: 6,
      byStage: [{ stage: 'development', players: 6 }],
    });

    // The battery of V2 for M15 (development): CMJ, sprint, 505, 30-15 and strength, never
    // what only V1 and V3 have.
    const battery = new Map(content.battery.map((test) => [test.testCode, test]));
    expect(battery.get('cmj')).toEqual({
      testCode: 'cmj',
      expected: 6,
      done: 5,
      notDone: { absent: 0, unavailable: 1, notApplicableToStage: 0, other: 0 },
      noRecord: 0,
    });
    expect(battery.get('sprint_40')).toEqual({
      testCode: 'sprint_40',
      expected: 6,
      done: 2,
      notDone: { absent: 1, unavailable: 0, notApplicableToStage: 0, other: 0 },
      noRecord: 3,
    });
    expect(battery.get('cod_505')?.noRecord).toBe(6);
    expect(battery.has('mobility')).toBe(false);
    expect(battery.has('anthro')).toBe(false);

    // The group's CMJ in V1 and V2, and how each player changed.
    expect(content.evolution.columns.map((c) => c.number)).toEqual([1, 2]);
    const cmj = content.evolution.metrics.find((m) => m.metricCode === 'cmj_height_cm');
    expect(cmj?.points.map((p) => [p.average, p.players])).toEqual([
      [(30 + 31 + 32 + 33 + 34 + 35) / 6, 6],
      [(33 + 34 + 35 + 33 + 35) / 5, 5],
    ]);
    expect(cmj?.points[1]?.methods).toEqual(['manual']);
    expect(cmj?.change).toEqual({
      fromColumnKey: `w:${v1}`,
      paired: 5,
      improved: 3,
      worsened: 1,
      unchanged: 1,
    });
    expect(cmj?.firstTeam).toEqual({ value: 52, unit: 'cm', scope: 'squad' });
    // Two sprinters in V2: neither the average nor how many.
    const sprint = content.evolution.metrics.find((m) => m.metricCode === 'sprint_40_s');
    expect(sprint?.points).toEqual([
      {
        columnKey: `w:${v2}`,
        average: null,
        players: null,
        methods: ['photocell'],
        protocolVersions: [1],
      },
    ]);

    // From the day after V1 to the end of V2: two session days.
    expect(content.responses).toMatchObject({
      from: '2026-03-01',
      to: '2026-04-30',
      sessionDays: 2,
      // Monday: 6 expected, 4 answered; Wednesday: 5 expected (one absent), none answered.
      wellness: { expected: 11, answered: 4 },
      // Monday: 6 participations, 3 with RPE; Wednesday: 5 participations, none.
      rpe: { expected: 11, answered: 3 },
      weeks: [
        {
          weekStart: '2026-03-02',
          wellness: { expected: 11, answered: 4 },
          rpe: { expected: 11, answered: 3 },
        },
      ],
    });

    // Nothing of any one player: neither names nor ids, nor the cause of an unavailability.
    const text = JSON.stringify(content);
    expect(text).not.toMatch(/Jugador/);
    for (const id of players) expect(text).not.toContain(id);
    expect(text).not.toMatch(/injured/);

    // A retry is the same report; the same clientUuid for another window is not.
    const replay = await ask(scA, m15, { clientUuid, testWindowId: v2 });
    expect(replay.statusCode).toBe(202);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.json<CategoryReport>().id).toBe(report.id);
    expect((await ask(scA, m15, { clientUuid, testWindowId: v1 })).statusCode).toBe(409);
  });

  it('only takes a started window of the category sport, for a category in use', async () => {
    expect((await ask(scA, m15, { testWindowId: future })).statusCode).toBe(409);
    expect((await ask(scA, m15, { testWindowId: hockeyWindow })).statusCode).toBe(400);
    expect((await ask(scA, m15, { testWindowId: randomUUID() })).statusCode).toBe(404);
    expect((await ask(scA, randomUUID(), { testWindowId: v2 })).statusCode).toBe(404);
    const archived = categories['rugby:m13'] ?? '';
    await database.admin.query('update category set archived_at = now() where id = $1', [archived]);
    expect((await ask(adminA, archived, { testWindowId: v2 })).statusCode).toBe(409);
  });

  it('is read by the staff of the category and the administration', async () => {
    const created = (await ask(scA, m15, { testWindowId: v1 })).json<CategoryReport>();
    for (const caller of [coachA, scA, adminA]) {
      const list = await get(caller, `/v1/categories/${m15}/reports?testWindowId=${v1}`);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json<{ items: CategoryReport[] }>().items.map((r) => r.id)).toContain(created.id);
      const one = await get(caller, `/v1/category-reports/${created.id}`);
      expect(one.statusCode, one.body).toBe(200);
    }
    // A player never; an sc of another category is not shown it (RLS: as if it did not exist).
    expect((await get(playerUser, `/v1/categories/${m15}/reports`)).statusCode).toBe(403);
    expect((await get(playerUser, `/v1/category-reports/${created.id}`)).statusCode).toBe(404);
    expect((await get(sc17, `/v1/categories/${m15}/reports`)).statusCode).toBe(403);
    expect((await get(sc17, `/v1/category-reports/${created.id}`)).statusCode).toBe(404);
    expect((await get(adminB, `/v1/category-reports/${created.id}`)).statusCode).toBe(404);
    // Newest first, by cursor.
    const page = await get(adminA, `/v1/categories/${m15}/reports?limit=1`);
    const body = page.json<{ items: CategoryReport[]; nextCursor: string | null }>();
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });
});
