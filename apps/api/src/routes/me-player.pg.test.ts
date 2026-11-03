/**
 * The player app's own reads (B-503, ADR 0071) against Postgres 16, through
 * the real connection roles: only the `player` role about themselves, the
 * wellness item set and the permissions of today's stage, and the upcoming
 * test days of their categories with the tests the seeded battery schedules
 * for them; nothing of another club.
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
  let adminB: SignedIn;
  let playerB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  const categories: Record<string, string> = {};
  const categoriesB: Record<string, string> = {};
  let p13 = '';
  let p15 = '';
  let today = '';
  let upcoming = '';
  let m17Day = '';
  let cancelled = '';
  let past = '';
  let pB = '';
  let dayB = '';

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

  /**
   * A birth date `years` old today (the stage comes from the category here,
   * but the ages stay those of the category if it ever depends on age).
   */
  function bornYearsAgo(years: number, monthDay: string): string {
    return `${String(Number(today.slice(0, 4)) - years)}-${monthDay}`;
  }

  async function createClub(
    slug: string,
  ): Promise<{ id: ClubId; categories: Record<string, string> }> {
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
    const rows = await database.admin.query<{ id: string; age_band_code: string }>(
      `select id, age_band_code from category where club_id = $1`,
      [id],
    );
    const byBand: Record<string, string> = {};
    for (const row of rows.rows) byBand[row.age_band_code] = row.id;
    return { id, categories: byBand };
  }

  async function insertPlayer(
    user: SignedIn,
    birthDate: string,
    categoryId: string,
    consent: boolean,
    clubId: ClubId = clubA,
    signer: SignedIn = adminA,
  ): Promise<string> {
    const created = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', $3, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, user.userId, birthDate],
    );
    const id = created.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    if (consent) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubId, id, signer.userId],
      );
    }
    await createMembership(database.admin, user.userId, clubId, 'player');
    return id;
  }

  async function scheduleDay(
    categoryId: string,
    scheduledOn: string,
    testWindowId: string | null,
    admin: SignedIn = adminA,
  ): Promise<string> {
    const response = await post(admin, '/v1/test-sessions', {
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

    adminB = await signIn(t, 'admin@app-b.example.com');
    playerB = await signIn(t, 'player@app-b.example.com');

    const a = await createClub('app-a');
    clubA = a.id;
    Object.assign(categories, a.categories);
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, coachA.userId, clubA, 'coach');

    const { rows: day } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = day[0]?.today ?? '';
    p13 = await insertPlayer(player13, bornYearsAgo(13, '01-04'), categories.m13 ?? '', true);
    p15 = await insertPlayer(player15, bornYearsAgo(15, '01-04'), categories.m15 ?? '', true);
    await insertPlayer(playerNoConsent, bornYearsAgo(15, '02-01'), categories.m15 ?? '', false);

    // Another club, with a player of the same category and a test day of its own.
    const b = await createClub('app-b');
    clubB = b.id;
    Object.assign(categoriesB, b.categories);
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    pB = await insertPlayer(
      playerB,
      bornYearsAgo(15, '01-04'),
      categoriesB.m15 ?? '',
      true,
      clubB,
      adminB,
    );

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
    dayB = await scheduleDay(categoriesB.m15 ?? '', await addDays(today, 7), null, adminB);
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

  it('never answers with another club', async () => {
    // The club A player never sees the day of club B's M15, the same category and date.
    const days = (await get(player15, '/v1/me/test-days')).json<TestDaysBody>();
    expect(days.items.map((item) => item.id)).not.toContain(dayB);
    // The club B player gets their own profile and their own day, nothing of club A.
    const response = await get(playerB, '/v1/me/player');
    expect(response.statusCode, response.body).toBe(200);
    const me = response.json<MyPlayerBody>();
    expect(me.player.id).toBe(pB);
    expect(me.categoryId).toBe(categoriesB.m15);
    const own = (await get(playerB, '/v1/me/test-days')).json<TestDaysBody>();
    expect(own.items.map((item) => item.id)).toEqual([dayB]);
  });
});
