/**
 * The player app's own reads (B-503, ADR 0071) against Postgres 16, through
 * the real connection roles: only the `player` role about themselves, the
 * wellness item set and the permissions of today's stage, and the upcoming
 * test days of their categories with the tests the seeded battery schedules
 * for them.
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

interface MyPlayerBody {
  player: { id: string; firstName: string; sport: string; sex: string };
  today: string;
  timeZone: string;
  ofAge: boolean;
  categoryId: string | null;
  stage: string | null;
  wellness: { itemCount: number; items: string[] } | null;
  permissions: { submitWellness: boolean; submitRpe: boolean; readPercentiles: boolean };
}

interface TestDaysBody {
  today: string;
  items: {
    id: string;
    scheduledOn: string;
    status: string;
    location: string | null;
    testWindow: { number: number; label: string } | null;
    testCodes: string[];
  }[];
}

const SUPPORT_REASON = encodeURIComponent('Alta del club para la app del jugador de B-503');

vi.setConfig({ testTimeout: 30_000 });

describeWithPostgres('player app reads (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let coachA: SignedIn;
  let player13: SignedIn;
  let player15: SignedIn;
  let playerNoConsent: SignedIn;
  let clubA: ClubId;
  const categories: Record<string, string> = {};
  let p13 = '';
  let p15 = '';
  let today = '';
  let upcoming = '';
  let m17Day = '';
  let cancelled = '';
  let past = '';

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });
  const post = (caller: SignedIn, url: string, payload: unknown) =>
    t.app.inject({ method: 'POST', url, headers: caller.headers, payload: payload as never });
  const get = (caller: SignedIn, url: string) => t.app.inject({ url, headers: caller.headers });

  async function addDays(date: string, days: number): Promise<string> {
    const { rows } = await database.admin.query<{ day: string }>(
      `select ($1::date + $2::int)::text as day`,
      [date, days],
    );
    return rows[0]?.day ?? '';
  }

  async function insertPlayer(
    user: SignedIn,
    birthDate: string,
    categoryId: string,
    consent: boolean,
  ): Promise<string> {
    const created = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', $3, 'male', 'rugby', '2020-01-01') returning id`,
      [clubA, user.userId, birthDate],
    );
    const id = created.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, id, categoryId],
    );
    if (consent) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubA, id, adminA.userId],
      );
    }
    await createMembership(database.admin, user.userId, clubA, 'player');
    return id;
  }

  async function scheduleDay(
    categoryId: string,
    scheduledOn: string,
    testWindowId: string | null,
  ): Promise<string> {
    const response = await post(adminA, '/v1/test-sessions', {
      categoryId,
      scheduledOn,
      ...(testWindowId !== null && { testWindowId }),
      location: 'Cancha 2',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ id: string }>().id;
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
    adminA = await signIn(t, 'admin@app-a.example.com');
    coachA = await signIn(t, 'coach@app-a.example.com');
    player13 = await signIn(t, 'player13@app-a.example.com');
    player15 = await signIn(t, 'player15@app-a.example.com');
    playerNoConsent = await signIn(t, 'player-nc@app-a.example.com');

    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: {
        slug: 'app-a',
        name: 'Club app-a',
        shortName: 'APPA',
        branches: [{ sport: 'rugby', sex: 'male' }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    clubA = created.json<{ club: { id: ClubId } }>().club.id;
    const rows = await database.admin.query<{ id: string; age_band_code: string }>(
      `select id, age_band_code from category where club_id = $1`,
      [clubA],
    );
    for (const row of rows.rows) categories[row.age_band_code] = row.id;
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, coachA.userId, clubA, 'coach');

    const { rows: day } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = day[0]?.today ?? '';
    p13 = await insertPlayer(player13, '2013-05-04', categories.m13 ?? '', true);
    p15 = await insertPlayer(player15, '2011-05-04', categories.m15 ?? '', true);
    await insertPlayer(playerNoConsent, '2011-08-01', categories.m15 ?? '', false);

    const season = await post(adminA, '/v1/seasons', {
      sport: 'rugby',
      name: 'Temporada de prueba',
      startsOn: await addDays(today, -30),
      endsOn: await addDays(today, 200),
    });
    expect(season.statusCode, season.body).toBe(201);
    const seasonId = season.json<{ id: string }>().id;
    const window = await post(adminA, `/v1/seasons/${seasonId}/test-windows`, {
      number: 4,
      startsOn: await addDays(today, -5),
      endsOn: await addDays(today, 60),
    });
    expect(window.statusCode, window.body).toBe(201);
    const windowId = window.json<{ id: string }>().id;

    upcoming = await scheduleDay(categories.m15 ?? '', await addDays(today, 7), windowId);
    m17Day = await scheduleDay(categories.m17 ?? '', await addDays(today, 8), windowId);
    cancelled = await scheduleDay(categories.m15 ?? '', await addDays(today, 9), windowId);
    const cancel = await post(adminA, `/v1/test-sessions/${cancelled}/cancel`, {});
    expect(cancel.statusCode, cancel.body).toBe(200);
    past = await scheduleDay(categories.m15 ?? '', await addDays(today, -2), windowId);
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('gives a M13/M14 player 3 items and no percentiles', async () => {
    const response = await get(player13, '/v1/me/player');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<MyPlayerBody>();
    expect(body.player.id).toBe(p13);
    expect(body.today).toBe(today);
    expect(body.timeZone).toBe('America/Argentina/Buenos_Aires');
    expect(body.ofAge).toBe(false);
    expect(body.stage).toBe('foundation');
    expect(body.wellness).toEqual({ itemCount: 3, items: ['sleep', 'fatigue', 'soreness'] });
    expect(body.permissions).toEqual({
      submitWellness: true,
      submitRpe: true,
      readPercentiles: false,
    });
  });

  it('gives a M15 player 5 items and their percentiles', async () => {
    const body = (await get(player15, '/v1/me/player')).json<MyPlayerBody>();
    expect(body.player.id).toBe(p15);
    expect(body.categoryId).toBe(categories.m15);
    expect(body.stage).toBe('development');
    expect(body.wellness?.itemCount).toBe(5);
    expect(body.permissions.readPercentiles).toBe(true);
  });

  it('says a player without a data consent cannot load wellness nor RPE', async () => {
    const body = (await get(playerNoConsent, '/v1/me/player')).json<MyPlayerBody>();
    expect(body.permissions.submitWellness).toBe(false);
    expect(body.permissions.submitRpe).toBe(false);
  });

  it('is only for the player role', async () => {
    expect((await get(coachA, '/v1/me/player')).statusCode).toBe(403);
    expect((await get(adminA, '/v1/me/test-days')).statusCode).toBe(403);
  });

  it('lists the upcoming test days of the player with their tests', async () => {
    const response = await get(player15, '/v1/me/test-days');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<TestDaysBody>();
    expect(body.today).toBe(today);
    // Not the day of another category, a cancelled one or one already past.
    expect(body.items.map((item) => item.id)).toEqual([upcoming]);
    const [item] = body.items;
    expect(item?.status).toBe('scheduled');
    expect(item?.location).toBe('Cancha 2');
    expect(item?.testWindow).toMatchObject({ number: 4, label: 'V4' });
    expect(item?.testCodes).toContain('sprint_40');
    expect(item?.testCodes).not.toContain('anthro');
    expect([m17Day, cancelled, past]).not.toContain(item?.id);
  });

  it('has nothing for a player of a category without test days', async () => {
    const body = (await get(player13, '/v1/me/test-days')).json<TestDaysBody>();
    expect(body.items).toEqual([]);
  });
});
