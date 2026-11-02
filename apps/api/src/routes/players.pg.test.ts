/**
 * Players and roster end to end (B-315, ADR 0035) against Postgres 16,
 * through the real connection roles (ADR 0026): the permission matrix in
 * the handlers (ADR 0025), RLS behind it and the endpoint conventions (ADR
 * 0032): idempotent creates, versions, archive, cursors, support access.
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
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface PlayerBody {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: string;
  sport: string;
  dominantSide: string | null;
  positionIds: string[];
  currentCategoryIds: string[];
  joinedOn: string;
  leftOn: string | null;
  leftReason: string | null;
  leftNote: string | null;
  hasAccount: boolean;
  archivedAt: string | null;
  version: string;
}

interface MembershipBody {
  id: string;
  playerId: string;
  categoryId: string;
  validFrom: string;
  validTo: string | null;
  version: string;
}

interface HeightBody {
  parent: string;
  heightCm: number;
  source: string;
  version: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// Dozens of requests per test through the real roles: slow when CI runs every package at once.
vi.setConfig({ testTimeout: 30_000 });

const SUPPORT_REASON = encodeURIComponent('Alta de jugadores pedida por el club');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

/** The club's day (America/Argentina/Buenos_Aires), as `app.club_today()` computes it. */
function clubToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

describeWithPostgres('players and roster (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachA: SignedIn;
  let idleCoach: SignedIn;
  let scA: SignedIn;
  let playerUser: SignedIn;
  let parentA: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  const category: Record<string, string> = {};
  const positions: Record<string, string> = {};
  let juan: PlayerBody;
  let pedro: PlayerBody;
  let lucia: PlayerBody;
  const createUuid = randomUUID();
  const today = clubToday();

  const supporting = (clubId: string, extra: Record<string, string> = {}) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
    ...extra,
  });

  async function inject(
    caller: SignedIn | Record<string, string>,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    const headers = 'headers' in caller ? (caller as SignedIn).headers : caller;
    return t.app.inject({
      method,
      url,
      headers: headers,
      ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
    });
  }

  async function listOf(caller: SignedIn, query = ''): Promise<PlayerBody[]> {
    const response = await inject(caller, 'GET', `/v1/players${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<PlayerBody>>().items;
  }

  async function read(caller: SignedIn, playerId: string): Promise<PlayerBody> {
    const response = await inject(caller, 'GET', `/v1/players/${playerId}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PlayerBody>();
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
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    idleCoach = await signIn(t, 'coach-sin-asignacion@club-a.example.com');
    scA = await signIn(t, 'pf@club-a.example.com');
    playerUser = await signIn(t, 'juan@club-a.example.com');
    parentA = await signIn(t, 'madre@club-a.example.com');

    // Clubs through the registry: branches, categories M13-M19 and positions seeded.
    for (const [slug, branches] of [
      [
        'club-a',
        [
          { sport: 'rugby', sex: 'male' },
          { sport: 'hockey', sex: 'female' },
        ],
      ],
      ['club-b', [{ sport: 'rugby', sex: 'male' }]],
    ] as const) {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/clubs',
        headers: { ...superadmin.headers, 'x-support-reason': SUPPORT_REASON },
        payload: { slug, name: `Club ${slug}`, shortName: slug.toUpperCase(), branches },
      });
      expect(response.statusCode, response.body).toBe(201);
      const id = response.json<{ club: { id: ClubId } }>().club.id;
      if (slug === 'club-a') clubA = id;
      else clubB = id;
    }
    const categories = await database.admin.query<{ id: string; key: string }>(
      `select id, sport || ':' || age_band_code as key from category where club_id = $1`,
      [clubA],
    );
    for (const row of categories.rows) category[row.key] = row.id;
    const seeded = await database.admin.query<{ id: string; key: string }>(
      `select id, sport || ':' || code as key from position where club_id = $1`,
      [clubA],
    );
    for (const row of seeded.rows) positions[row.key] = row.id;

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const coach = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, idleCoach.userId, clubA, 'coach');
    const sc = await createMembership(database.admin, scA.userId, clubA, 'sc');
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coach, category['rugby:m15']],
    );
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, sport, valid_from)
       values ($1, $2, 'rugby', '2020-01-01')`,
      [clubA, sc],
    );
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  const juanPayload = (clientUuid?: string) => ({
    ...(clientUuid !== undefined && { clientUuid }),
    firstName: 'Juan',
    lastName: 'Pérez',
    birthDate: '2011-05-04',
    sex: 'male',
    sport: 'rugby',
    dominantSide: 'right',
    positionIds: [positions['rugby:hooker'], positions['rugby:prop']],
    joinedOn: '2024-03-01',
    categoryId: category['rugby:m15'],
  });

  describe('sign-up (alta)', () => {
    it('lets the admin create a player with positions and an initial category', async () => {
      const response = await inject(adminA, 'POST', '/v1/players', juanPayload(createUuid));
      expect(response.statusCode, response.body).toBe(201);
      juan = response.json<PlayerBody>();
      expect(juan).toMatchObject({
        firstName: 'Juan',
        lastName: 'Pérez',
        sport: 'rugby',
        sex: 'male',
        dominantSide: 'right',
        joinedOn: '2024-03-01',
        currentCategoryIds: [category['rugby:m15']],
        leftOn: null,
        archivedAt: null,
        hasAccount: false,
      });
      expect(juan.positionIds).toEqual(juanPayload().positionIds);
      expect(juan.positionIds.length).toBeGreaterThan(0);
    });

    it('replays the same create by clientUuid without duplicating', async () => {
      const response = await inject(adminA, 'POST', '/v1/players', juanPayload(createUuid));
      expect(response.statusCode, response.body).toBe(201);
      expect(response.headers['x-idempotent-replay']).toBe('true');
      expect(response.json<PlayerBody>().id).toBe(juan.id);
      const count = await database.admin.query<{ players: string; categories: string }>(
        `select (select count(*) from player where club_id = $1) as players,
                (select count(*) from player_category where club_id = $1) as categories`,
        [clubA],
      );
      expect(count.rows[0]).toEqual({ players: '1', categories: '1' });
    });

    it('creates the rest of the roster', async () => {
      const second = await inject(adminA, 'POST', '/v1/players', {
        firstName: 'Pedro',
        lastName: 'Álvarez',
        birthDate: '2009-02-10',
        sex: 'male',
        sport: 'rugby',
        joinedOn: '2023-03-01',
        categoryId: category['rugby:m17'],
      });
      expect(second.statusCode, second.body).toBe(201);
      pedro = second.json<PlayerBody>();
      expect(pedro.positionIds).toEqual([]);
      const third = await inject(adminA, 'POST', '/v1/players', {
        firstName: 'Lucía',
        lastName: 'Gómez',
        birthDate: '2012-08-20',
        sex: 'female',
        sport: 'hockey',
        categoryId: category['hockey:m14'],
      });
      expect(third.statusCode, third.body).toBe(201);
      lucia = third.json<PlayerBody>();
      expect(lucia.joinedOn).toBe(today);
      // The player user is Juan; the parent is Juan's mother.
      await database.admin.query('update player set user_id = $1 where id = $2', [
        playerUser.userId,
        juan.id,
      ]);
      await database.admin.query(
        `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
         values ($1, $2, $3, 'mother', '2020-01-01')`,
        [clubA, juan.id, parentA.userId],
      );
    });

    it('validates the branch, the sport of positions and category, and the dates', async () => {
      const base = { ...juanPayload(), positionIds: [], categoryId: undefined };
      const cases: [Record<string, unknown>, (string | number)[]][] = [
        [{ ...base, sex: 'female' }, ['body', 'sport']],
        [{ ...base, positionIds: [positions['hockey:goalkeeper']] }, ['body', 'positionIds']],
        [{ ...base, categoryId: category['hockey:m15'] }, ['body', 'categoryId']],
        [{ ...base, birthDate: addDays(today, 1) }, ['body', 'birthDate']],
        [{ ...base, joinedOn: '2010-01-01' }, ['body', 'joinedOn']],
      ];
      for (const [payload, path] of cases) {
        const response = await inject(adminA, 'POST', '/v1/players', payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorOf(response).code).toBe('validation_failed');
        expect(errorOf(response).details?.[0]?.path).toEqual(path);
      }
      const padded = await inject(adminA, 'POST', '/v1/players', { ...base, firstName: ' Juan' });
      expect(padded.statusCode).toBe(400);
    });

    it('is the administration’s: staff, player and parent get 403', async () => {
      for (const caller of [coachA, scA, playerUser, parentA]) {
        const response = await inject(caller, 'POST', '/v1/players', juanPayload());
        expect(response.statusCode).toBe(403);
        expect(errorOf(response)).toMatchObject({
          code: 'forbidden',
          message: 'You are not allowed to do this',
        });
      }
    });
  });

  describe('reading the roster', () => {
    it('scopes the list by role', async () => {
      const names = (items: PlayerBody[]) => items.map((p) => p.firstName);
      expect(names(await listOf(adminA))).toEqual(['Pedro', 'Lucía', 'Juan']);
      expect(names(await listOf(coachA))).toEqual(['Juan']);
      expect(names(await listOf(scA))).toEqual(['Pedro', 'Juan']);
      expect(await listOf(idleCoach)).toEqual([]);
      expect(names(await listOf(playerUser))).toEqual(['Juan']);
      expect(names(await listOf(parentA))).toEqual(['Juan']);
      expect(await listOf(adminB)).toEqual([]);
    });

    it('filters by category, sport, sex and name, sorts and paginates', async () => {
      const names = (items: PlayerBody[]) => items.map((p) => p.firstName);
      expect(names(await listOf(adminA, `?categoryId=${category['rugby:m17'] ?? ''}`))).toEqual([
        'Pedro',
      ]);
      expect(names(await listOf(adminA, '?sport=hockey'))).toEqual(['Lucía']);
      expect(names(await listOf(adminA, '?sex=male'))).toEqual(['Pedro', 'Juan']);
      expect(names(await listOf(adminA, '?q=PÉR'))).toEqual(['Juan']);
      expect(names(await listOf(adminA, '?q=juan%20p'))).toEqual([]);
      expect(names(await listOf(adminA, '?q=p%C3%A9rez%20j'))).toEqual(['Juan']);
      expect(names(await listOf(adminA, '?sort=-birthDate'))).toEqual(['Lucía', 'Juan', 'Pedro']);

      const first = await inject(adminA, 'GET', '/v1/players?limit=2');
      const page1 = first.json<Page<PlayerBody>>();
      expect(names(page1.items)).toEqual(['Pedro', 'Lucía']);
      const second = await inject(
        adminA,
        'GET',
        `/v1/players?limit=2&cursor=${page1.nextCursor ?? ''}`,
      );
      const page2 = second.json<Page<PlayerBody>>();
      expect(names(page2.items)).toEqual(['Juan']);
      expect(page2.nextCursor).toBeNull();
      const reused = await inject(
        adminA,
        'GET',
        `/v1/players?limit=2&sport=rugby&cursor=${page1.nextCursor ?? ''}`,
      );
      expect(reused.statusCode).toBe(400);
      expect(errorOf(reused).code).toBe('bad_request');
    });

    it('reads one profile within the scope; other clubs and hidden players are 404', async () => {
      expect((await read(adminA, juan.id)).hasAccount).toBe(true);
      expect((await read(coachA, juan.id)).id).toBe(juan.id);
      expect((await read(playerUser, juan.id)).id).toBe(juan.id);
      expect((await read(parentA, juan.id)).id).toBe(juan.id);
      for (const [caller, playerId] of [
        [coachA, pedro.id],
        [idleCoach, juan.id],
        [playerUser, pedro.id],
        [parentA, lucia.id],
        [adminB, juan.id],
      ] as const) {
        const response = await inject(caller, 'GET', `/v1/players/${playerId}`);
        expect(response.statusCode).toBe(404);
        expect(errorOf(response).code).toBe('not_found');
      }
    });

    it('lets a superadmin read the roster with a support reason, audited', async () => {
      const response = await inject(
        supporting(clubA, { 'x-request-id': 'req-support-players' }),
        'GET',
        '/v1/players',
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<Page<PlayerBody>>().items).toHaveLength(3);
      const log = await database.admin.query<{ club_id: string }>(
        `select club_id from support.access_log where request_id = 'req-support-players'`,
      );
      expect(log.rows).toEqual([{ club_id: clubA }]);
      const withoutReason = await inject(
        { ...superadmin.headers, 'x-support-club-id': clubA },
        'GET',
        '/v1/players',
      );
      expect(withoutReason.statusCode).toBe(403);
    });
  });

  describe('editing the profile', () => {
    it('lets an assigned coach edit positions and side with the current version', async () => {
      const current = await read(coachA, juan.id);
      const flanker = positions['rugby:flanker'];
      const response = await inject(coachA, 'PATCH', `/v1/players/${juan.id}`, {
        version: current.version,
        dominantSide: 'left',
        positionIds: [flanker],
      });
      expect(response.statusCode, response.body).toBe(200);
      const updated = response.json<PlayerBody>();
      expect(updated).toMatchObject({ dominantSide: 'left', positionIds: [flanker] });
      expect(updated.version).not.toBe(current.version);

      const stale = await inject(coachA, 'PATCH', `/v1/players/${juan.id}`, {
        version: current.version,
        firstName: 'Juancito',
      });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).code).toBe('conflict');
      juan = updated;
    });

    it('validates positions and dates on edit, and never changes the sport', async () => {
      for (const [payload, status] of [
        [{ positionIds: [positions['hockey:goalkeeper']] }, 400],
        [{ joinedOn: '2010-01-01' }, 400],
        // Later than the start of the M15 membership (2024-03-01): correct it first.
        [{ joinedOn: '2024-06-01' }, 409],
        [{ birthDate: addDays(today, 3) }, 400],
        [{ sport: 'hockey' }, 400],
      ] as const) {
        const response = await inject(adminA, 'PATCH', `/v1/players/${juan.id}`, {
          version: juan.version,
          ...payload,
        });
        expect(response.statusCode, JSON.stringify(payload)).toBe(status);
      }
    });

    it('denies the player, the parent, other clubs and staff outside their scope', async () => {
      for (const [caller, playerId, status] of [
        [playerUser, juan.id, 403],
        [parentA, juan.id, 403],
        [coachA, pedro.id, 404],
        [adminB, juan.id, 404],
      ] as const) {
        const response = await inject(caller, 'PATCH', `/v1/players/${playerId}`, {
          version: juan.version,
          firstName: 'Hackeado',
        });
        expect(response.statusCode).toBe(status);
      }
    });
  });

  describe('category history', () => {
    let move: MembershipBody;
    const moveUuid = randomUUID();
    const moveDay = addDays(today, -10);

    it('moves a player to another category, closing the current one', async () => {
      const response = await inject(adminA, 'POST', `/v1/players/${pedro.id}/categories`, {
        clientUuid: moveUuid,
        categoryId: category['rugby:m19'],
        validFrom: moveDay,
      });
      expect(response.statusCode, response.body).toBe(201);
      move = response.json<MembershipBody>();
      expect(move).toMatchObject({ categoryId: category['rugby:m19'], validTo: null });
      const replay = await inject(adminA, 'POST', `/v1/players/${pedro.id}/categories`, {
        clientUuid: moveUuid,
        categoryId: category['rugby:m19'],
        validFrom: moveDay,
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<MembershipBody>().id).toBe(move.id);

      const history = await inject(adminA, 'GET', `/v1/players/${pedro.id}/categories`);
      expect(history.statusCode, history.body).toBe(200);
      const items = history.json<Page<MembershipBody>>().items;
      expect(items.map((m) => [m.categoryId, m.validFrom, m.validTo])).toEqual([
        [category['rugby:m19'], moveDay, null],
        [category['rugby:m17'], pedro.joinedOn, moveDay],
      ]);
      expect((await read(adminA, pedro.id)).currentCategoryIds).toEqual([category['rugby:m19']]);
    });

    it('keeps the current category when asked, and refuses overlaps and other sports', async () => {
      const dual = await inject(adminA, 'POST', `/v1/players/${juan.id}/categories`, {
        categoryId: category['rugby:m16'],
        validFrom: today,
        keepCurrent: true,
      });
      expect(dual.statusCode, dual.body).toBe(201);
      expect((await read(adminA, juan.id)).currentCategoryIds.sort()).toEqual(
        [category['rugby:m15'], category['rugby:m16']].sort(),
      );
      const overlap = await inject(adminA, 'POST', `/v1/players/${juan.id}/categories`, {
        categoryId: category['rugby:m16'],
        validFrom: addDays(today, 5),
        keepCurrent: true,
      });
      expect(overlap.statusCode).toBe(409);
      const sameDay = await inject(adminA, 'POST', `/v1/players/${juan.id}/categories`, {
        categoryId: category['rugby:m17'],
        validFrom: today,
      });
      expect(sameDay.statusCode).toBe(409);
      const hockey = await inject(adminA, 'POST', `/v1/players/${juan.id}/categories`, {
        categoryId: category['hockey:m15'],
        validFrom: today,
      });
      expect(hockey.statusCode).toBe(400);
      expect(errorOf(hockey).details?.[0]?.path).toEqual(['body', 'categoryId']);
    });

    it('refuses a category of the other branch (sex) of the same sport', async () => {
      // A women's rugby category, of a branch archived so the rest of the roster ignores it.
      await database.admin.query(
        `insert into club_branch (club_id, sport, sex, archived_at)
         values ($1, 'rugby', 'female', now())`,
        [clubA],
      );
      const { rows } = await database.admin.query<{ id: string }>(
        `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
         values ($1, 'rugby', 'female', 'm15', 'M15 rugby femenino', 'development')
         returning id`,
        [clubA],
      );
      const women = rows[0]?.id;
      if (women === undefined) throw new Error('the category was not created');
      const move = await inject(adminA, 'POST', `/v1/players/${juan.id}/categories`, {
        categoryId: women,
        validFrom: today,
        keepCurrent: true,
      });
      expect(move.statusCode, move.body).toBe(400);
      expect(errorOf(move).details?.[0]?.path).toEqual(['body', 'categoryId']);
      const signUp = await inject(adminA, 'POST', '/v1/players', {
        ...juanPayload(),
        positionIds: [],
        categoryId: women,
      });
      expect(signUp.statusCode, signUp.body).toBe(400);
      expect(errorOf(signUp).details?.[0]?.path).toEqual(['body', 'categoryId']);
    });

    it('corrects a membership with its version', async () => {
      const response = await inject(
        adminA,
        'PATCH',
        `/v1/players/${pedro.id}/categories/${move.id}`,
        { version: move.version, validFrom: addDays(moveDay, -1) },
      );
      // The M17 row ends on `moveDay`: starting M19 a day before overlaps nothing of M19.
      expect(response.statusCode, response.body).toBe(200);
      const corrected = response.json<MembershipBody>();
      expect(corrected.validFrom).toBe(addDays(moveDay, -1));
      const stale = await inject(adminA, 'PATCH', `/v1/players/${pedro.id}/categories/${move.id}`, {
        version: move.version,
        validTo: today,
      });
      expect(stale.statusCode).toBe(409);
      const empty = await inject(adminA, 'PATCH', `/v1/players/${pedro.id}/categories/${move.id}`, {
        version: corrected.version,
        validTo: corrected.validFrom,
      });
      expect(empty.statusCode).toBe(400);
      const otherPlayer = await inject(
        adminA,
        'PATCH',
        `/v1/players/${juan.id}/categories/${move.id}`,
        { version: corrected.version, validTo: today },
      );
      expect(otherPlayer.statusCode).toBe(404);
    });

    it('is managed by the administration only; the scope reads it', async () => {
      const coachMove = await inject(coachA, 'POST', `/v1/players/${juan.id}/categories`, {
        categoryId: category['rugby:m17'],
        validFrom: today,
      });
      expect(coachMove.statusCode).toBe(403);
      const own = await inject(playerUser, 'GET', `/v1/players/${juan.id}/categories`);
      expect(own.statusCode).toBe(200);
      const foreign = await inject(adminB, 'GET', `/v1/players/${juan.id}/categories`);
      expect(foreign.statusCode).toBe(404);
    });
  });

  describe('leave (baja) and restore', () => {
    it('records the leave with date and reason, closing the categories', async () => {
      const denied = await inject(coachA, 'POST', `/v1/players/${juan.id}/archive`, {
        leftOn: today,
        reason: 'quit',
      });
      expect(denied.statusCode).toBe(403);
      const future = await inject(adminA, 'POST', `/v1/players/${lucia.id}/archive`, {
        leftOn: addDays(today, 2),
        reason: 'quit',
      });
      expect(future.statusCode).toBe(400);

      const response = await inject(adminA, 'POST', `/v1/players/${lucia.id}/archive`, {
        leftOn: today,
        reason: 'transferred',
        note: 'Se fue a otro club',
      });
      expect(response.statusCode, response.body).toBe(200);
      const left = response.json<PlayerBody>();
      expect(left).toMatchObject({
        leftOn: today,
        leftReason: 'transferred',
        leftNote: 'Se fue a otro club',
        currentCategoryIds: [category['hockey:m14']],
      });
      expect(left.archivedAt).not.toBeNull();
      const closed = await database.admin.query<{ valid_to: string }>(
        `select valid_to::text from player_category where player_id = $1`,
        [lucia.id],
      );
      expect(closed.rows).toEqual([{ valid_to: addDays(today, 1) }]);

      const again = await inject(adminA, 'POST', `/v1/players/${lucia.id}/archive`, {
        leftOn: addDays(today, -1),
        reason: 'quit',
      });
      expect(again.statusCode).toBe(200);
      expect(again.json<PlayerBody>().leftReason).toBe('transferred');

      const names = (items: PlayerBody[]) => items.map((p) => p.firstName);
      expect(names(await listOf(adminA))).toEqual(['Pedro', 'Juan']);
      expect(names(await listOf(adminA, '?status=archived'))).toEqual(['Lucía']);
      expect(names(await listOf(adminA, '?status=all'))).toEqual(['Pedro', 'Lucía', 'Juan']);

      const move = await inject(adminA, 'POST', `/v1/players/${lucia.id}/categories`, {
        categoryId: category['hockey:m15'],
        validFrom: today,
      });
      expect(move.statusCode).toBe(409);

      // Nor can a closed membership be reopened while the player is archived.
      const history = await inject(adminA, 'GET', `/v1/players/${lucia.id}/categories`);
      expect(history.statusCode, history.body).toBe(200);
      const [membership] = history.json<Page<MembershipBody>>().items;
      if (membership === undefined) throw new Error('Lucía has no membership');
      for (const validTo of [null, addDays(today, 30)]) {
        const reopen = await inject(
          adminA,
          'PATCH',
          `/v1/players/${lucia.id}/categories/${membership.id}`,
          { version: membership.version, validTo },
        );
        expect(reopen.statusCode, reopen.body).toBe(409);
        expect(errorOf(reopen).code).toBe('conflict');
      }
      const still = await database.admin.query<{ valid_to: string }>(
        `select valid_to::text from player_category where player_id = $1`,
        [lucia.id],
      );
      expect(still.rows).toEqual([{ valid_to: addDays(today, 1) }]);
    });

    it('restores a player without reopening categories', async () => {
      const response = await inject(adminA, 'POST', `/v1/players/${lucia.id}/restore`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<PlayerBody>()).toMatchObject({
        leftOn: null,
        leftReason: null,
        leftNote: null,
        archivedAt: null,
      });
      const again = await inject(adminA, 'POST', `/v1/players/${lucia.id}/restore`);
      expect(again.statusCode).toBe(200);
      const parent = await inject(parentA, 'POST', `/v1/players/${juan.id}/restore`);
      expect(parent.statusCode).toBe(403);
    });
  });

  describe('parents’ heights', () => {
    const url = (playerId: string, parent: string) =>
      `/v1/players/${playerId}/parent-heights/${parent}`;

    it('needs a current data consent to be collected', async () => {
      const response = await inject(parentA, 'PUT', url(juan.id, 'mother'), {
        heightCm: 165,
        source: 'reported',
      });
      expect(response.statusCode).toBe(403);
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', '2026-01', 'guardian', $3)`,
        [clubA, juan.id, parentA.userId],
      );
    });

    it('lets the guardian report, never measure', async () => {
      const response = await inject(parentA, 'PUT', url(juan.id, 'mother'), {
        heightCm: 165.5,
        source: 'reported',
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<HeightBody>()).toMatchObject({
        parent: 'mother',
        heightCm: 165.5,
        source: 'reported',
      });
      const measured = await inject(parentA, 'PUT', url(juan.id, 'father'), {
        heightCm: 180,
        source: 'measured',
      });
      expect(measured.statusCode).toBe(403);
      const outOfRange = await inject(parentA, 'PUT', url(juan.id, 'father'), {
        heightCm: 18,
        source: 'reported',
      });
      expect(outOfRange.statusCode).toBe(400);
    });

    it('lets S&C measure, and a report never replaces a measure', async () => {
      const measured = await inject(scA, 'PUT', url(juan.id, 'father'), {
        heightCm: 182,
        source: 'measured',
      });
      expect(measured.statusCode, measured.body).toBe(200);
      const father = measured.json<HeightBody>();
      const report = await inject(parentA, 'PUT', url(juan.id, 'father'), {
        version: father.version,
        heightCm: 185,
        source: 'reported',
      });
      expect(report.statusCode).toBe(409);
    });

    it('replaces a height only with its current version', async () => {
      const heights = await inject(parentA, 'GET', `/v1/players/${juan.id}/parent-heights`);
      expect(heights.statusCode, heights.body).toBe(200);
      const body = heights.json<{ mother: HeightBody; father: HeightBody }>();
      expect(body.father).toMatchObject({ heightCm: 182, source: 'measured' });
      const withoutVersion = await inject(adminA, 'PUT', url(juan.id, 'mother'), {
        heightCm: 166,
        source: 'measured',
      });
      expect(withoutVersion.statusCode).toBe(409);
      const updated = await inject(adminA, 'PUT', url(juan.id, 'mother'), {
        version: body.mother.version,
        heightCm: 166,
        source: 'measured',
      });
      expect(updated.statusCode, updated.body).toBe(200);
      const stale = await inject(adminA, 'PUT', url(juan.id, 'mother'), {
        version: body.mother.version,
        heightCm: 167,
        source: 'measured',
      });
      expect(stale.statusCode).toBe(409);
    });

    it('are not for the coach or the player, nor for other clubs', async () => {
      for (const [caller, status] of [
        [coachA, 403],
        [playerUser, 403],
        [adminB, 404],
      ] as const) {
        const response = await inject(caller, 'GET', `/v1/players/${juan.id}/parent-heights`);
        expect(response.statusCode).toBe(status);
      }
      const noConsent = await inject(scA, 'PUT', url(pedro.id, 'mother'), {
        heightCm: 160,
        source: 'measured',
      });
      expect(noConsent.statusCode).toBe(403);
    });
  });
});
