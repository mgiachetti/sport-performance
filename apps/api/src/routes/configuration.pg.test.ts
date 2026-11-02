/**
 * Configuration of the club end to end (B-322) against Postgres 16, through
 * the real connection roles (ADR 0026): battery, speed zones, alert rules
 * and active modules, with the permission matrix in the handlers (ADR
 * 0025), RLS behind it and the endpoint conventions (ADR 0032): idempotent
 * creates, versions, archive, cursors, superadmin support.
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

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface BatteryBody {
  id: string;
  sport: string;
  sex: string | null;
  stage: string | null;
  categoryId: string | null;
  testCode: string;
  windows: number[];
  cadenceWeeks: { min: number; max: number } | null;
  validFrom: string;
  validTo: string | null;
  archivedAt: string | null;
  version: string;
}

interface ZoneBody {
  id: string;
  kind: string;
  sport: string | null;
  sex: string | null;
  playerId: string | null;
  zoneSet: { kind: string; zones: Record<string, unknown>[]; highSpeedZoneCode: string };
  validFrom: string;
  validTo: string | null;
  archivedAt: string | null;
  version: string;
}

interface RuleBody {
  id: string;
  code: string;
  kind: string;
  enabled: boolean;
  appliesTo: Record<string, string[]>;
  params: Record<string, number | null>;
  isDefault: boolean;
  version: string;
}

interface ModulesBody {
  modules: Record<string, boolean>;
  version: string;
}

// Many requests per test, against a real database: slow when CI runs every package at once.
vi.setConfig({ testTimeout: 60_000 });

const SUPPORT_REASON = encodeURIComponent('Ayuda con la configuración pedida por el club');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describeWithPostgres('club configuration (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let admin: SignedIn;
  let sc: SignedIn;
  let coach: SignedIn;
  let medical: SignedIn;
  let player: SignedIn;
  let parent: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let today: string;
  const categories: Record<string, string> = {};
  const players: Record<'m15' | 'm17', string> = { m15: '', m17: '' };

  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  const inject = (
    caller: SignedIn | Record<string, string>,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
  ) =>
    t.app.inject({
      method,
      url,
      headers: 'headers' in caller ? (caller.headers as Record<string, string>) : caller,
      ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
    });

  async function createClubAs(slug: string): Promise<ClubId> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: { ...superadmin.headers, 'x-support-reason': SUPPORT_REASON },
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

  async function insertPlayer(clubId: string, categoryId: string, name: string): Promise<string> {
    const inserted = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Test', '2010-05-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, name],
    );
    const id = inserted.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    return id;
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
    clubA = await createClubAs('club-a');
    clubB = await createClubAs('club-b');
    admin = await signIn(t, 'admin@club-a.example.com');
    sc = await signIn(t, 'sc@club-a.example.com');
    coach = await signIn(t, 'coach@club-a.example.com');
    medical = await signIn(t, 'medical@club-a.example.com');
    player = await signIn(t, 'player@club-a.example.com');
    parent = await signIn(t, 'parent@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    await createMembership(database.admin, admin.userId, clubA, 'admin');
    const scMembership = await createMembership(database.admin, sc.userId, clubA, 'sc');
    const coachMembership = await createMembership(database.admin, coach.userId, clubA, 'coach');
    await createMembership(database.admin, medical.userId, clubA, 'medical');
    await createMembership(database.admin, player.userId, clubA, 'player');
    await createMembership(database.admin, parent.userId, clubA, 'parent');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');

    const rows = await database.admin.query<{ id: string; sport: string; age_band_code: string }>(
      'select id, sport, age_band_code from category where club_id = $1',
      [clubA],
    );
    for (const row of rows.rows) categories[`${row.sport}:${row.age_band_code}`] = row.id;
    const m15 = categories['rugby:m15'] ?? '';
    // The S&C coach sees the whole sport; the coach, M15 only.
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, sport, valid_from)
       values ($1, $2, 'rugby', '2020-01-01')`,
      [clubA, scMembership],
    );
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coachMembership, m15],
    );
    players.m15 = await insertPlayer(clubA, m15, 'Quince');
    players.m17 = await insertPlayer(clubA, categories['rugby:m17'] ?? '', 'Diecisiete');
    const clubDay = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = clubDay.rows[0]?.today ?? '';
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('active modules', () => {
    it('are readable by every member, with the defaults', async () => {
      for (const caller of [admin, sc, coach, player, parent]) {
        const response = await inject(caller, 'GET', '/v1/configuration/modules');
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json<ModulesBody>().modules).toEqual({
          wellness: true,
          gym: true,
          gps: false,
          maturation: true,
          pain_report: false,
          menstrual_cycle: false,
        });
      }
    });

    it('lets the administration change them with the version', async () => {
      const read = (await inject(admin, 'GET', '/v1/configuration/modules')).json<ModulesBody>();
      const denied = await inject(sc, 'PATCH', '/v1/configuration/modules', {
        version: read.version,
        modules: { gym: false },
      });
      expect(denied.statusCode).toBe(403);
      const changed = await inject(admin, 'PATCH', '/v1/configuration/modules', {
        version: read.version,
        modules: { gym: false, gps: true },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const body = changed.json<ModulesBody>();
      expect(body.modules).toMatchObject({ gym: false, gps: true, wellness: true });
      expect(body.version).not.toBe(read.version);
      const stale = await inject(admin, 'PATCH', '/v1/configuration/modules', {
        version: read.version,
        modules: { gym: true },
      });
      expect(stale.statusCode).toBe(409);
      const unknown = await inject(admin, 'PATCH', '/v1/configuration/modules', {
        version: body.version,
        modules: { rankings: true },
      });
      expect(unknown.statusCode).toBe(400);
      // Every module stored explicitly, the rest of the settings kept.
      const stored = await database.admin.query<{ settings: { modules: Record<string, boolean> } }>(
        'select settings from club where id = $1',
        [clubA],
      );
      expect(Object.keys(stored.rows[0]?.settings.modules ?? {}).sort()).toEqual(
        Object.keys(body.modules).sort(),
      );
      const other = await inject(adminB, 'GET', '/v1/configuration/modules');
      expect(other.json<ModulesBody>().modules.gym).toBe(true);
    });

    it('lets a supporting superadmin change them', async () => {
      const read = (
        await inject(supporting(clubA), 'GET', '/v1/configuration/modules')
      ).json<ModulesBody>();
      const response = await inject(supporting(clubA), 'PATCH', '/v1/configuration/modules', {
        version: read.version,
        modules: { gym: true },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<ModulesBody>().modules.gym).toBe(true);
    });
  });

  describe('battery', () => {
    let m15Entry: BatteryBody;
    const createUuid = randomUUID();

    it('is readable by the staff, not by players and parents', async () => {
      for (const caller of [admin, sc, coach, medical]) {
        const response = await inject(caller, 'GET', '/v1/configuration/battery?sport=rugby');
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json<Page<BatteryBody>>().items.length).toBeGreaterThan(0);
      }
      for (const caller of [player, parent]) {
        const response = await inject(caller, 'GET', '/v1/configuration/battery');
        expect(response.statusCode).toBe(403);
        expect(errorOf(response).code).toBe('forbidden');
      }
    });

    it('filters and pages the seeded battery', async () => {
      const filtered = await inject(
        coach,
        'GET',
        '/v1/configuration/battery?sport=rugby&stage=performance&testCode=cmj',
      );
      const items = filtered.json<Page<BatteryBody>>().items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        testCode: 'cmj',
        stage: 'performance',
        windows: [1, 2, 3, 4],
        cadenceWeeks: { min: 1, max: 1 },
      });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query = `sport=hockey&limit=3${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page: Page<BatteryBody> = (
          await inject(sc, 'GET', `/v1/configuration/battery?${query}`)
        ).json();
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      const all = await database.admin.query<{ n: string }>(
        `select count(*) as n from battery_config where club_id = $1 and sport = 'hockey'`,
        [clubA],
      );
      expect(seen).toHaveLength(Number(all.rows[0]?.n));
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('creates an entry for a category idempotently, only for sc and admin', async () => {
      const payload = {
        clientUuid: createUuid,
        sport: 'rugby',
        categoryId: categories['rugby:m15'],
        testCode: 'cmj',
        windows: [3, 1],
      };
      const denied = await inject(coach, 'POST', '/v1/configuration/battery', payload);
      expect(denied.statusCode).toBe(403);
      const created = await inject(sc, 'POST', '/v1/configuration/battery', payload);
      expect(created.statusCode, created.body).toBe(201);
      m15Entry = created.json<BatteryBody>();
      expect(m15Entry).toMatchObject({
        sex: null,
        stage: null,
        windows: [1, 3],
        cadenceWeeks: null,
        validFrom: today,
        validTo: null,
      });
      const replay = await inject(sc, 'POST', '/v1/configuration/battery', payload);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<BatteryBody>().id).toBe(m15Entry.id);
    });

    it('resolves the effective battery of a group, most specific first', async () => {
      const withCategory = await inject(
        coach,
        'GET',
        `/v1/configuration/battery/effective?sport=rugby&sex=male&stage=development&categoryId=${categories['rugby:m15'] ?? ''}`,
      );
      expect(withCategory.statusCode, withCategory.body).toBe(200);
      const tests = withCategory.json<{
        tests: { testCode: string; windows: number[]; entry: { id: string } }[];
      }>().tests;
      expect(tests.find((x) => x.testCode === 'cmj')).toMatchObject({
        windows: [1, 3],
        entry: { id: m15Entry.id },
      });
      // The development stage does no bronco, and the sport filter keeps hockey's out.
      expect(tests.map((x) => x.testCode)).not.toContain('bronco');
      const clubWide = await inject(
        coach,
        'GET',
        '/v1/configuration/battery/effective?sport=rugby&sex=male&stage=development',
      );
      const clubTests = clubWide.json<{ tests: { testCode: string; windows: number[] }[] }>().tests;
      expect(clubTests.find((x) => x.testCode === 'cmj')?.windows).toEqual([1, 2, 3, 4]);
      const unknown = await inject(
        coach,
        'GET',
        `/v1/configuration/battery/effective?sport=rugby&sex=male&stage=development&categoryId=${randomUUID()}`,
      );
      expect(unknown.statusCode).toBe(404);
    });

    it('rejects an overlapping entry, or closes the previous one when asked', async () => {
      const base = {
        sport: 'rugby',
        categoryId: categories['rugby:m15'],
        testCode: 'cmj',
        windows: [2],
      };
      const overlapping = await inject(sc, 'POST', '/v1/configuration/battery', base);
      expect(overlapping.statusCode).toBe(409);
      // Same start as the one in force: closing it would leave it empty.
      const sameStart = await inject(sc, 'POST', '/v1/configuration/battery', {
        ...base,
        closePrevious: true,
      });
      expect(sameStart.statusCode).toBe(409);
      const from = addDays(today, 10);
      const next = await inject(sc, 'POST', '/v1/configuration/battery', {
        ...base,
        validFrom: from,
        closePrevious: true,
      });
      expect(next.statusCode, next.body).toBe(201);
      const closed = await inject(sc, 'GET', `/v1/configuration/battery/${m15Entry.id}`);
      expect(closed.json<BatteryBody>().validTo).toBe(from);
      m15Entry = closed.json<BatteryBody>();
    });

    it('keeps an entry in force unchanged but lets it be closed from today on', async () => {
      const content = await inject(sc, 'PATCH', `/v1/configuration/battery/${m15Entry.id}`, {
        version: m15Entry.version,
        windows: [1],
      });
      expect(content.statusCode).toBe(409);
      const past = await inject(sc, 'PATCH', `/v1/configuration/battery/${m15Entry.id}`, {
        version: m15Entry.version,
        validTo: addDays(today, -1),
      });
      expect(past.statusCode).toBe(400);
      expect(errorOf(past).details?.[0]?.path).toEqual(['body', 'validTo']);
      const extended = await inject(sc, 'PATCH', `/v1/configuration/battery/${m15Entry.id}`, {
        version: m15Entry.version,
        validTo: addDays(today, 20),
      });
      // It would overlap the next one, which starts in 10 days.
      expect(extended.statusCode).toBe(409);
      const archive = await inject(sc, 'POST', `/v1/configuration/battery/${m15Entry.id}/archive`);
      expect(archive.statusCode).toBe(409);
    });

    it('edits, archives and restores a planned entry, with the version', async () => {
      const planned = (
        await inject(
          sc,
          'GET',
          `/v1/configuration/battery?categoryId=${categories['rugby:m15'] ?? ''}&validOn=${addDays(today, 15)}`,
        )
      ).json<Page<BatteryBody>>().items[0];
      if (planned === undefined) throw new Error('planned entry missing');
      const edited = await inject(sc, 'PATCH', `/v1/configuration/battery/${planned.id}`, {
        version: planned.version,
        windows: [2, 4],
        cadenceWeeks: { min: 6, max: 8 },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json<BatteryBody>()).toMatchObject({
        windows: [2, 4],
        cadenceWeeks: { min: 6, max: 8 },
      });
      const stale = await inject(sc, 'PATCH', `/v1/configuration/battery/${planned.id}`, {
        version: planned.version,
        windows: [2],
      });
      expect(stale.statusCode).toBe(409);
      const archived = await inject(sc, 'POST', `/v1/configuration/battery/${planned.id}/archive`);
      expect(archived.statusCode).toBe(200);
      expect(archived.json<BatteryBody>().archivedAt).not.toBeNull();
      const again = await inject(sc, 'POST', `/v1/configuration/battery/${planned.id}/archive`);
      expect(again.statusCode).toBe(200);
      const listed = await inject(
        sc,
        'GET',
        `/v1/configuration/battery?categoryId=${categories['rugby:m15'] ?? ''}&status=archived`,
      );
      expect(listed.json<Page<BatteryBody>>().items.map((i) => i.id)).toEqual([planned.id]);
      const restored = await inject(sc, 'POST', `/v1/configuration/battery/${planned.id}/restore`);
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.json<BatteryBody>().archivedAt).toBeNull();
    });

    it('validates the test, the category and the schedule', async () => {
      const post = (payload: Record<string, unknown>) =>
        inject(admin, 'POST', '/v1/configuration/battery', {
          sport: 'rugby',
          testCode: 'mobility',
          windows: [1],
          validFrom: addDays(today, 100),
          ...payload,
        });
      const unknownTest = await post({ testCode: 'yoyo_ir1' });
      expect(unknownTest.statusCode).toBe(400);
      expect(errorOf(unknownTest).details?.[0]?.path).toEqual(['body', 'testCode']);
      const otherSport = await post({ categoryId: categories['hockey:m15'] });
      expect(otherSport.statusCode).toBe(400);
      expect(errorOf(otherSport).details?.[0]?.path).toEqual(['body', 'categoryId']);
      const otherSex = await post({ categoryId: categories['rugby:m15'], sex: 'female' });
      expect(otherSex.statusCode).toBe(400);
      const otherClub = await post({ categoryId: randomUUID() });
      expect(otherClub.statusCode).toBe(400);
      const empty = await post({ windows: [] });
      expect(empty.statusCode).toBe(400);
      expect(errorOf(empty).details?.[0]?.path).toEqual(['body', 'windows']);
      const repeated = await post({ windows: [1, 1] });
      expect(repeated.statusCode).toBe(400);
      const outOfRange = await post({ windows: [5] });
      expect(outOfRange.statusCode).toBe(400);
      const badCadence = await post({ windows: [], cadenceWeeks: { min: 6, max: 4 } });
      expect(badCadence.statusCode).toBe(400);
      const badRange = await post({ validTo: addDays(today, 100) });
      expect(badRange.statusCode).toBe(400);
      expect(errorOf(badRange).details?.[0]?.path).toEqual(['body', 'validTo']);
    });

    it('keeps maximal loads out of the foundation stage and of M13/M14', async () => {
      await database.admin.query(
        `update test_definition set maximal_load = true where club_id = $1 and code = 'strength'`,
        [clubA],
      );
      const post = (payload: Record<string, unknown>) =>
        inject(sc, 'POST', '/v1/configuration/battery', {
          sport: 'rugby',
          testCode: 'strength',
          windows: [2],
          validFrom: addDays(today, 200),
          ...payload,
        });
      const anyStage = await post({});
      expect(anyStage.statusCode).toBe(400);
      expect(errorOf(anyStage).details?.[0]?.path).toEqual(['body', 'stage']);
      const foundation = await post({ stage: 'foundation' });
      expect(foundation.statusCode).toBe(400);
      const m13 = await post({ stage: 'performance', categoryId: categories['rugby:m13'] });
      expect(m13.statusCode).toBe(400);
      expect(errorOf(m13).details?.[0]?.path).toEqual(['body', 'categoryId']);
      const m17 = await post({ stage: 'performance', categoryId: categories['rugby:m17'] });
      expect(m17.statusCode, m17.body).toBe(201);
    });

    it('hides the entries of another club and lets a supporting superadmin in', async () => {
      const other = await inject(adminB, 'GET', `/v1/configuration/battery/${m15Entry.id}`);
      expect(other.statusCode).toBe(404);
      const otherPatch = await inject(adminB, 'PATCH', `/v1/configuration/battery/${m15Entry.id}`, {
        version: m15Entry.version,
        validTo: addDays(today, 5),
      });
      expect(otherPatch.statusCode).toBe(404);
      const support = await inject(
        supporting(clubA),
        'GET',
        `/v1/configuration/battery/${m15Entry.id}`,
      );
      expect(support.statusCode, support.body).toBe(200);
    });
  });

  describe('speed zones', () => {
    let playerZone: ZoneBody;
    const zoneSet = {
      kind: 'absolute',
      zones: [
        { code: 'walking', minSpeedMs: 0 },
        { code: 'running', minSpeedMs: 3.5 },
        { code: 'high_speed_running', minSpeedMs: 5.2 },
        { code: 'sprinting', minSpeedMs: 6.8 },
      ],
      highSpeedZoneCode: 'high_speed_running',
    };

    it('serves the seeded club-wide zones to the staff', async () => {
      const response = await inject(medical, 'GET', '/v1/configuration/speed-zones?scope=group');
      expect(response.statusCode, response.body).toBe(200);
      expect(
        response
          .json<Page<ZoneBody>>()
          .items.map((z) => z.kind)
          .sort(),
      ).toEqual(['absolute', 'relative']);
      const denied = await inject(player, 'GET', '/v1/configuration/speed-zones');
      expect(denied.statusCode).toBe(403);
      const effective = await inject(
        coach,
        'GET',
        '/v1/configuration/speed-zones/effective?kind=relative&sport=rugby&sex=male',
      );
      expect(effective.statusCode, effective.body).toBe(200);
      expect(
        effective.json<{ source: string; zoneSet: { highSpeedZoneCode: string } }>(),
      ).toMatchObject({
        source: 'club',
        zoneSet: { highSpeedZoneCode: 'high_speed_running' },
      });
    });

    it('validates zone sets with the domain', async () => {
      const notFromZero = await inject(sc, 'POST', '/v1/configuration/speed-zones', {
        sport: 'rugby',
        zoneSet: {
          ...zoneSet,
          zones: [{ code: 'slow', minSpeedMs: 1 }, ...zoneSet.zones.slice(1)],
        },
      });
      expect(notFromZero.statusCode).toBe(400);
      expect(errorOf(notFromZero).details?.[0]?.path).toEqual(['body', 'zoneSet']);
      const firstHighSpeed = await inject(sc, 'POST', '/v1/configuration/speed-zones', {
        sport: 'rugby',
        zoneSet: { ...zoneSet, highSpeedZoneCode: 'walking' },
      });
      expect(firstHighSpeed.statusCode).toBe(400);
      const mixed = await inject(sc, 'POST', '/v1/configuration/speed-zones', {
        sport: 'rugby',
        zoneSet: { ...zoneSet, kind: 'relative' },
      });
      expect(mixed.statusCode).toBe(400);
    });

    it('stores a threshold of a player for who sees the player', async () => {
      const denied = await inject(coach, 'POST', '/v1/configuration/speed-zones', {
        playerId: players.m15,
        zoneSet,
      });
      expect(denied.statusCode).toBe(403);
      const clientUuid = randomUUID();
      const created = await inject(sc, 'POST', '/v1/configuration/speed-zones', {
        clientUuid,
        playerId: players.m15,
        zoneSet,
      });
      expect(created.statusCode, created.body).toBe(201);
      playerZone = created.json<ZoneBody>();
      expect(playerZone).toMatchObject({ kind: 'absolute', playerId: players.m15, sport: null });
      const replay = await inject(sc, 'POST', '/v1/configuration/speed-zones', {
        clientUuid,
        playerId: players.m15,
        zoneSet,
      });
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      const other = await inject(admin, 'POST', '/v1/configuration/speed-zones', {
        playerId: players.m17,
        zoneSet,
      });
      expect(other.statusCode, other.body).toBe(201);
      const otherZone = other.json<ZoneBody>();
      const unknown = await inject(admin, 'POST', '/v1/configuration/speed-zones', {
        playerId: randomUUID(),
        zoneSet,
      });
      expect(unknown.statusCode).toBe(404);

      // The M15 coach sees the M15 player's zones, not the M17 one's.
      const coachList = await inject(coach, 'GET', '/v1/configuration/speed-zones?scope=player');
      expect(coachList.json<Page<ZoneBody>>().items.map((z) => z.id)).toEqual([playerZone.id]);
      // A player the coach does not see does not exist for the coach (RLS).
      const coachGet = await inject(coach, 'GET', `/v1/configuration/speed-zones/${otherZone.id}`);
      expect(coachGet.statusCode).toBe(404);
      const adminList = await inject(admin, 'GET', '/v1/configuration/speed-zones?scope=player');
      expect(adminList.json<Page<ZoneBody>>().items).toHaveLength(2);
    });

    it('resolves the player threshold over the club zones', async () => {
      const effective = await inject(
        coach,
        'GET',
        `/v1/configuration/speed-zones/effective?kind=absolute&sport=rugby&sex=male&playerId=${players.m15}`,
      );
      expect(effective.statusCode, effective.body).toBe(200);
      expect(effective.json<{ source: string; config: { id: string } }>()).toMatchObject({
        source: 'club',
        config: { id: playerZone.id },
      });
      const otherSex = await inject(
        coach,
        'GET',
        `/v1/configuration/speed-zones/effective?kind=absolute&sport=rugby&sex=female&playerId=${players.m15}`,
      );
      expect(otherSex.statusCode).toBe(400);
      const outOfScope = await inject(
        coach,
        'GET',
        `/v1/configuration/speed-zones/effective?kind=absolute&sport=rugby&sex=male&playerId=${players.m17}`,
      );
      expect(outOfScope.statusCode).toBe(404);
    });

    it('keeps zones in force, closes them and replaces them in one request', async () => {
      const changed = await inject(sc, 'PATCH', `/v1/configuration/speed-zones/${playerZone.id}`, {
        version: playerZone.version,
        zoneSet: { ...zoneSet, highSpeedZoneCode: 'sprinting' },
      });
      expect(changed.statusCode).toBe(409);
      const kind = await inject(sc, 'PATCH', `/v1/configuration/speed-zones/${playerZone.id}`, {
        version: playerZone.version,
        zoneSet: {
          kind: 'relative',
          zones: [
            { code: 'low', minVmaxPct: 0 },
            { code: 'high', minVmaxPct: 60 },
          ],
          highSpeedZoneCode: 'high',
        },
      });
      expect(kind.statusCode).toBe(400);
      const from = addDays(today, 7);
      const replacement = await inject(sc, 'POST', '/v1/configuration/speed-zones', {
        playerId: players.m15,
        zoneSet: { ...zoneSet, highSpeedZoneCode: 'sprinting' },
        validFrom: from,
        closePrevious: true,
      });
      expect(replacement.statusCode, replacement.body).toBe(201);
      const previous = await inject(sc, 'GET', `/v1/configuration/speed-zones/${playerZone.id}`);
      expect(previous.json<ZoneBody>().validTo).toBe(from);
      const replaced = replacement.json<ZoneBody>();
      const archived = await inject(
        sc,
        'POST',
        `/v1/configuration/speed-zones/${replaced.id}/archive`,
      );
      expect(archived.statusCode, archived.body).toBe(200);
      const inForce = await inject(
        sc,
        'POST',
        `/v1/configuration/speed-zones/${playerZone.id}/archive`,
      );
      expect(inForce.statusCode).toBe(409);
      const cross = await inject(adminB, 'GET', `/v1/configuration/speed-zones/${playerZone.id}`);
      expect(cross.statusCode).toBe(404);
    });
  });

  describe('alert rules', () => {
    let acwrHigh: RuleBody;

    it('lists the seeded rules for the staff', async () => {
      const response = await inject(medical, 'GET', '/v1/configuration/alert-rules');
      expect(response.statusCode, response.body).toBe(200);
      const rules = response.json<Page<RuleBody>>().items;
      expect(rules.map((r) => r.code)).toEqual([
        'acwr_high',
        'acwr_low',
        'cmj_drop',
        'growth_peak',
        'wellness_low',
        'wellness_zscore_low',
      ]);
      expect(rules.every((r) => r.isDefault)).toBe(true);
      acwrHigh = rules[0] ?? acwrHigh;
      expect(acwrHigh.params).toEqual({
        warningAboveRatio: 1.3,
        criticalAboveRatio: 1.4,
        minHistoryDays: 28,
      });
      expect(acwrHigh.appliesTo).toEqual({});
      for (const caller of [player, parent]) {
        expect((await inject(caller, 'GET', '/v1/configuration/alert-rules')).statusCode).toBe(403);
      }
    });

    it('validates the edits with the domain and the version', async () => {
      const inverted = await inject(sc, 'PATCH', `/v1/configuration/alert-rules/${acwrHigh.id}`, {
        version: acwrHigh.version,
        params: { warningAboveRatio: 1.5, criticalAboveRatio: 1.4, minHistoryDays: 28 },
      });
      expect(inverted.statusCode).toBe(400);
      expect(errorOf(inverted).details?.[0]?.path).toEqual([
        'body',
        'params',
        'criticalAboveRatio',
      ]);
      const otherKind = await inject(sc, 'PATCH', `/v1/configuration/alert-rules/${acwrHigh.id}`, {
        version: acwrHigh.version,
        params: { warningBelowScore: 3.3, criticalBelowScore: 3 },
      });
      expect(otherKind.statusCode).toBe(400);
      const denied = await inject(coach, 'PATCH', `/v1/configuration/alert-rules/${acwrHigh.id}`, {
        version: acwrHigh.version,
        enabled: false,
      });
      expect(denied.statusCode).toBe(403);
      const edited = await inject(sc, 'PATCH', `/v1/configuration/alert-rules/${acwrHigh.id}`, {
        version: acwrHigh.version,
        appliesTo: { stages: ['performance'], sports: ['rugby'] },
        params: { warningAboveRatio: 1.25, criticalAboveRatio: 1.5, minHistoryDays: 21 },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      const body = edited.json<RuleBody>();
      expect(body).toMatchObject({
        appliesTo: { stages: ['performance'], sports: ['rugby'] },
        params: { warningAboveRatio: 1.25, criticalAboveRatio: 1.5, minHistoryDays: 21 },
        enabled: true,
        isDefault: true,
      });
      const stale = await inject(sc, 'PATCH', `/v1/configuration/alert-rules/${acwrHigh.id}`, {
        version: acwrHigh.version,
        enabled: false,
      });
      expect(stale.statusCode).toBe(409);
      const cleared = await inject(sc, 'PATCH', `/v1/configuration/alert-rules/${acwrHigh.id}`, {
        version: body.version,
        appliesTo: null,
        enabled: false,
      });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(cleared.json<RuleBody>()).toMatchObject({ appliesTo: {}, enabled: false });
      const disabled = await inject(sc, 'GET', '/v1/configuration/alert-rules?enabled=false');
      expect(disabled.json<Page<RuleBody>>().items.map((r) => r.code)).toEqual(['acwr_high']);
    });

    it('creates club rules idempotently and rejects a repeated code', async () => {
      const clientUuid = randomUUID();
      const payload = {
        clientUuid,
        code: 'wellness_low_foundation',
        kind: 'wellness_low',
        appliesTo: { stages: ['foundation'] },
        params: { warningBelowScore: 3.5, criticalBelowScore: null },
      };
      const created = await inject(admin, 'POST', '/v1/configuration/alert-rules', payload);
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json<RuleBody>()).toMatchObject({ enabled: true, isDefault: false });
      const replay = await inject(admin, 'POST', '/v1/configuration/alert-rules', payload);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      const repeated = await inject(admin, 'POST', '/v1/configuration/alert-rules', {
        ...payload,
        clientUuid: randomUUID(),
      });
      expect(repeated.statusCode).toBe(409);
      const invalid = await inject(admin, 'POST', '/v1/configuration/alert-rules', {
        ...payload,
        clientUuid: randomUUID(),
        code: 'wellness_low_none',
        params: { warningBelowScore: null, criticalBelowScore: null },
      });
      expect(invalid.statusCode).toBe(400);
      expect(errorOf(invalid).details?.[0]?.path).toEqual(['body', 'params']);
      const wrongShape = await inject(admin, 'POST', '/v1/configuration/alert-rules', {
        ...payload,
        clientUuid: randomUUID(),
        code: 'wellness_wrong',
        params: { warningAboveRatio: 1.3, criticalAboveRatio: null, minHistoryDays: 28 },
      });
      expect(wrongShape.statusCode).toBe(400);
      const denied = await inject(medical, 'POST', '/v1/configuration/alert-rules', {
        ...payload,
        clientUuid: randomUUID(),
        code: 'wellness_medical',
      });
      expect(denied.statusCode).toBe(403);
      const cross = await inject(adminB, 'GET', `/v1/configuration/alert-rules/${acwrHigh.id}`);
      expect(cross.statusCode).toBe(404);
    });
  });
});
