/**
 * Usage metrics (B-707, ADR 0093) against Postgres 16: the API records the use
 * of the marked surfaces by role and client (web or app) without failing the
 * request and never for a superadmin's support, and the administration reads
 * the club's adoption by week (wellness on session days, RPE, test days, use
 * of the surfaces and memberships), counts only, nothing of another club.
 */
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

interface Summary {
  timeZone: string;
  today: string;
  isDemo: boolean;
  weeks: { weekStart: string; weekEnd: string }[];
  usageRetainedFrom: string;
  categories: { id: string; name: string; sport: string; sex: string }[];
  training: {
    weekStart: string;
    categoryId: string | null;
    sessions: number;
    attendedPlayerDays: number;
    attendedPlayerDaysWithWellness: number;
    attendedParticipations: number;
    participationsWithRpe: number;
    rpeViaKiosk: number;
    wellnessOnSessionDaysRate: number | null;
    rpeRate: number | null;
  }[];
  wellness: {
    weekStart: string;
    categoryId: string | null;
    rosterPlayers: number;
    responses: number;
    respondents: number;
    viaKiosk: number;
  }[];
  tests: {
    weekStart: string;
    categoryId: string | null;
    testDays: number;
    results: number;
    playersTested: number;
    importedResults: number;
  }[];
  surfaces: {
    weekStart: string;
    surface: string;
    client: string;
    role: string;
    activeMembers: number;
    memberDays: number;
    events: number;
  }[];
  members: { weekStart: string; role: string; members: number }[];
}

const SUPPORT_REASON = encodeURIComponent('Revisión de las métricas de uso del piloto (B-709)');
const APP_HEADERS = { 'x-client-platform': 'ios', 'x-client-version': '1.0.0' };

vi.setConfig({ testTimeout: 30_000 });

describeWithPostgres('usage metrics (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let coachA: SignedIn;
  let coach2A: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15 = '';
  let sessionDay = '';

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });
  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });
  const get = (headers: Record<string, string>, url: string) => t.app.inject({ url, headers });

  async function createClub(slug: string): Promise<{ id: ClubId; m15: string }> {
    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: {
        slug,
        name: `Club ${slug}`,
        shortName: slug.toUpperCase().replace('-', ''),
        branches: [{ sport: 'rugby', sex: 'male' }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ club: { id: ClubId } }>().club.id;
    const { rows } = await database.admin.query<{ id: string }>(
      `select id from category where club_id = $1 and age_band_code = 'm15'`,
      [id],
    );
    return { id, m15: rows[0]?.id ?? '' };
  }

  async function insertPlayer(clubId: ClubId, categoryId: string, name: string): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Uso', '2011-05-04', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, name],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    return playerId;
  }

  async function summary(headers: Record<string, string>, query = '') {
    const response = await get(headers, `/v1/usage/summary?weeks=2${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Summary>();
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
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@uso-a.example.com');
    coachA = await signIn(t, 'coach@uso-a.example.com');
    coach2A = await signIn(t, 'coach2@uso-a.example.com', 'bearer');
    adminB = await signIn(t, 'admin@uso-b.example.com');

    const a = await createClub('uso-a');
    clubA = a.id;
    m15 = a.m15;
    clubB = (await createClub('uso-b')).id;
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, coach2A.userId, clubA, 'coach');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');

    // Three M15 players; a session an hour ago that all three attended, two with RPE, one
    // of them by the kiosk; wellness that day from two of them (one by the kiosk).
    const players = [
      await insertPlayer(clubA, m15, 'Uno'),
      await insertPlayer(clubA, m15, 'Dos'),
      await insertPlayer(clubA, m15, 'Tres'),
    ];
    const { rows: sessions } = await database.admin.query<{ id: string; day: string }>(
      `insert into training_session
         (club_id, sport, kind, category_id, title, starts_at, local_date, planned_duration_min)
       select $1, 'rugby', 'training', $2, 'Entrenamiento', s.at,
              (s.at at time zone c.time_zone)::date, 80
         from club c, (select now() - interval '1 hour' as at) s
        where c.id = $1
       returning id, local_date::text as day`,
      [clubA, m15],
    );
    const session = sessions[0];
    if (session === undefined) throw new Error('session not created');
    sessionDay = session.day;
    for (const [i, playerId] of players.entries()) {
      await database.admin.query(
        `insert into participation (club_id, training_session_id, player_id, status, minutes, rpe,
                                    rpe_reported_at, rpe_via_kiosk)
         values ($1, $2, $3, 'full', 80, $4, $5, $6)`,
        [clubA, session.id, playerId, i < 2 ? 6 : null, i < 2 ? new Date() : null, i === 1],
      );
    }
    for (const [i, playerId] of players.slice(0, 2).entries()) {
      await database.admin.query(
        `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness,
                               via_kiosk)
         values ($1, $2, $3, 3, 4, 3, 3, $4)`,
        [clubA, playerId, sessionDay, i === 1],
      );
    }
    // A test day that day with one result (not done) and an imported historical result.
    const { rows: definitions } = await database.admin.query<{ id: string }>(
      `select id from test_definition where club_id = $1 and code = 'cmj' order by version limit 1`,
      [clubA],
    );
    const definitionId = definitions[0]?.id;
    const { rows: testDays } = await database.admin.query<{ id: string }>(
      `insert into test_session (club_id, sport, category_id, scheduled_on)
       values ($1, 'rugby', $2, $3) returning id`,
      [clubA, m15, sessionDay],
    );
    await database.admin.query(
      `insert into test_result (club_id, player_id, test_definition_id, test_session_id,
                                measured_on, status, not_done_reason)
       values ($1, $2, $3, $4, $5, 'not_done', 'absent')`,
      [clubA, players[0], definitionId, testDays[0]?.id, sessionDay],
    );

    // Use: the coach opens the panel twice on the web and once in the app; the second coach
    // once in the app; the admin's panel and the superadmin's support panel.
    for (const headers of [coachA.headers, coachA.headers, { ...coachA.headers, ...APP_HEADERS }]) {
      const response = await get(headers, '/v1/panel/weekly');
      expect(response.statusCode, response.body).toBe(200);
    }
    expect((await get({ ...coach2A.headers, ...APP_HEADERS }, '/v1/panel/weekly')).statusCode).toBe(
      200,
    );
    expect((await get(adminA.headers, '/v1/panel/weekly')).statusCode).toBe(200);
    expect((await get(supporting(clubA), '/v1/panel/weekly')).statusCode).toBe(200);
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('records the use per member, surface, client and role, not the support', async () => {
    const { rows } = await database.admin.query<{
      role: string;
      surface: string;
      client: string;
      events_n: number;
    }>(
      `select role::text, surface::text, client::text, events_n from usage_activity
        where club_id = $1 order by role, client, events_n`,
      [clubA],
    );
    expect(rows).toEqual([
      { role: 'admin', surface: 'panel', client: 'web', events_n: 1 },
      { role: 'coach', surface: 'panel', client: 'app', events_n: 1 },
      { role: 'coach', surface: 'panel', client: 'app', events_n: 1 },
      { role: 'coach', surface: 'panel', client: 'web', events_n: 2 },
    ]);
    const { rows: columns } = await database.admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'usage_activity'
        order by column_name`,
    );
    // Nothing about what was read, the IP or the device.
    expect(columns.map((c) => c.column_name)).not.toContain('player_id');
    expect(columns.map((c) => c.column_name)).not.toContain('ip');
  });

  it('answers the club’s adoption by week to the administration', async () => {
    const body = await summary(adminA.headers);
    expect(body.isDemo).toBe(false);
    expect(body.weeks).toHaveLength(2);
    const week = body.weeks.find(
      (w) => w.weekStart <= sessionDay && sessionDay <= w.weekEnd,
    )?.weekStart;
    expect(week).toBeDefined();
    expect(body.categories).toEqual([
      expect.objectContaining({ id: m15, sport: 'rugby', sex: 'male' }),
    ]);
    expect(body.training).toEqual([
      {
        weekStart: week,
        categoryId: m15,
        sessions: 1,
        attendedPlayerDays: 3,
        attendedPlayerDaysWithWellness: 2,
        attendedParticipations: 3,
        participationsWithRpe: 2,
        rpeViaKiosk: 1,
        wellnessOnSessionDaysRate: 2 / 3,
        rpeRate: 2 / 3,
      },
    ]);
    expect(body.wellness).toContainEqual({
      weekStart: week,
      categoryId: m15,
      rosterPlayers: 3,
      responses: 2,
      respondents: 2,
      viaKiosk: 1,
    });
    expect(body.tests).toEqual([
      {
        weekStart: week,
        categoryId: m15,
        testDays: 1,
        results: 1,
        playersTested: 1,
        importedResults: 0,
      },
    ]);
    const today = body.weeks.find((w) => w.weekStart <= body.today && body.today <= w.weekEnd);
    expect(body.surfaces).toEqual(
      expect.arrayContaining([
        {
          weekStart: today?.weekStart,
          surface: 'panel',
          client: 'web',
          role: 'coach',
          activeMembers: 1,
          memberDays: 1,
          events: 2,
        },
        {
          weekStart: today?.weekStart,
          surface: 'panel',
          client: 'app',
          role: 'coach',
          activeMembers: 2,
          memberDays: 2,
          events: 2,
        },
      ]),
    );
    expect(body.members).toContainEqual({ weekStart: today?.weekStart, role: 'coach', members: 2 });
  });

  it('the summary itself is not a recorded surface, and a superadmin reads it under support', async () => {
    const before = await database.admin.query<{ n: number }>(
      'select coalesce(sum(events_n), 0)::int as n from usage_activity',
    );
    const body = await summary(supporting(clubA));
    expect(body.training).toHaveLength(1);
    const after = await database.admin.query<{ n: number }>(
      'select coalesce(sum(events_n), 0)::int as n from usage_activity',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('is only for the administration', async () => {
    const response = await get(coachA.headers, `/v1/usage/summary`);
    expect(response.statusCode).toBe(403);
  });

  it('shows nothing of another club', async () => {
    const body = await summary(adminB.headers);
    expect(body.training).toEqual([]);
    expect(body.wellness).toEqual([]);
    expect(body.tests).toEqual([]);
    expect(body.surfaces).toEqual([]);
    expect(body.members.map((m) => m.role)).not.toContain('coach');
  });

  it('rejects a future week', async () => {
    const response = await get(adminA.headers, '/v1/usage/summary?weekOf=2999-01-04');
    expect(response.statusCode).toBe(400);
  });
});
