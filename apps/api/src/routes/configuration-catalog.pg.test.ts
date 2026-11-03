/**
 * Catalog reads of the club (B-409, ADR 0062) against Postgres 16, through
 * the real connection roles (ADR 0026): the tests of the catalog (one per
 * code, the protocol version in force) and the metric dictionary, with
 * `configuration.read` in the handlers, RLS behind it and cursors.
 */
import {
  CANONICAL_METRIC_CODES,
  CANONICAL_TEST_CODES,
  type ClubId,
} from '@sport-performance/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface TestBody {
  code: string;
  testDefinitionId: string;
  protocolVersion: number;
  inForce: boolean;
  sports: string[] | null;
  maximalLoad: boolean;
  metricCodes: string[];
  validFrom: string;
  validTo: string | null;
}

interface MetricBody {
  id: string;
  code: string;
  unit: string;
  source: string;
  direction: string;
  testCode: string | null;
  sports: string[] | null;
  catapultAliases: string[];
  isCanonical: boolean;
  archivedAt: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Revisión del catálogo pedida por el club');

describeWithPostgres('club catalog (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let sc: SignedIn;
  let coach: SignedIn;
  let medical: SignedIn;
  let player: SignedIn;
  let parent: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;

  const get = (caller: SignedIn | Record<string, string>, url: string) =>
    t.app.inject({
      method: 'GET',
      url,
      headers: 'headers' in caller ? (caller.headers as Record<string, string>) : caller,
    });

  async function page<T>(caller: SignedIn, url: string): Promise<Page<T>> {
    const response = await get(caller, url);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<T>>();
  }

  async function all<T>(caller: SignedIn, path: string, query = ''): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const result: Page<T> = await page<T>(caller, `${path}?limit=4${query}${suffix}`);
      items.push(...result.items);
      cursor = result.nextCursor;
    } while (cursor !== null);
    return items;
  }

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

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: { auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } } },
    });
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    clubA = await createClubAs('club-a');
    clubB = await createClubAs('club-b');
    sc = await signIn(t, 'sc@club-a.example.com');
    coach = await signIn(t, 'coach@club-a.example.com');
    medical = await signIn(t, 'medical@club-a.example.com');
    player = await signIn(t, 'player@club-a.example.com');
    parent = await signIn(t, 'parent@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    await createMembership(database.admin, sc.userId, clubA, 'sc');
    await createMembership(database.admin, coach.userId, clubA, 'coach');
    await createMembership(database.admin, medical.userId, clubA, 'medical');
    await createMembership(database.admin, player.userId, clubA, 'player');
    await createMembership(database.admin, parent.userId, clubA, 'parent');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('tests of the catalog', () => {
    it('lists one row per seeded test, across pages', async () => {
      const tests = await all<TestBody>(coach, '/v1/catalog/tests');
      expect(tests.map((test) => test.code).sort()).toEqual([...CANONICAL_TEST_CODES].sort());
      const sprint = tests.find((test) => test.code === 'sprint_40');
      expect(sprint).toMatchObject({ inForce: true, protocolVersion: 1, validTo: null });
      expect(sprint?.metricCodes).toEqual(
        expect.arrayContaining(['sprint_10_s', 'sprint_40_s', 'sprint_vmax_ms']),
      );
      expect(tests.find((test) => test.code === 'bronco')).toMatchObject({
        sports: ['rugby'],
        maximalLoad: false,
      });
    });

    it('filters by sport and shows the version in force on a day', async () => {
      // A second protocol version of the CMJ from 2030 on; the first one closes then.
      const v1 = await database.admin.query<{ id: string }>(
        `update test_definition set valid_to = '2030-01-01'
         where club_id = $1 and code = 'cmj' and version = 1 returning id`,
        [clubA],
      );
      await database.admin.query(
        `insert into test_definition (club_id, code, version, sports, attempt_count, valid_from)
         values ($1, 'cmj', 2, '{rugby}', 3, '2030-01-01')`,
        [clubA],
      );
      const now = await all<TestBody>(sc, '/v1/catalog/tests', '&sport=hockey');
      expect(now.some((test) => test.code === 'bronco')).toBe(false);
      expect(now.find((test) => test.code === 'cmj')).toMatchObject({
        testDefinitionId: v1.rows[0]?.id,
        protocolVersion: 1,
        inForce: true,
      });
      const later = await all<TestBody>(sc, '/v1/catalog/tests', '&onDate=2030-06-01');
      expect(later.find((test) => test.code === 'cmj')).toMatchObject({
        protocolVersion: 2,
        inForce: true,
        sports: ['rugby'],
      });
      // In 2030 the CMJ in force is for rugby only: hockey has no CMJ that day.
      const hockeyLater = await all<TestBody>(
        sc,
        '/v1/catalog/tests',
        '&sport=hockey&onDate=2030-06-01',
      );
      expect(hockeyLater.find((test) => test.code === 'cmj')).toBeUndefined();
      expect(hockeyLater.find((test) => test.code === 'sprint_40')?.inForce).toBe(true);
    });

    it('flags a test with no version in force that day', async () => {
      await database.admin.query(
        `insert into test_definition (club_id, code, version, sports, valid_from)
         values ($1, 'yo_yo_ir1', 1, '{hockey}', '2031-01-01')`,
        [clubA],
      );
      const now = await all<TestBody>(sc, '/v1/catalog/tests', '&sport=hockey');
      expect(now.find((test) => test.code === 'yo_yo_ir1')).toMatchObject({
        inForce: false,
        validFrom: '2031-01-01',
        metricCodes: [],
      });
      const later = await all<TestBody>(sc, '/v1/catalog/tests', '&onDate=2031-02-01');
      expect(later.find((test) => test.code === 'yo_yo_ir1')?.inForce).toBe(true);
    });
  });

  describe('metric dictionary', () => {
    it('lists the canonical metrics with their unit and Catapult aliases', async () => {
      const metrics = await all<MetricBody>(medical, '/v1/catalog/metrics');
      expect(metrics.map((metric) => metric.code)).toEqual(
        expect.arrayContaining([...CANONICAL_METRIC_CODES]),
      );
      const codes = metrics.map((metric) => metric.code);
      // Pages neither repeat nor skip a row.
      expect(new Set(codes).size).toBe(codes.length);
      expect(metrics.find((metric) => metric.code === 'cmj_height_cm')).toMatchObject({
        unit: 'cm',
        source: 'test',
        direction: 'higher_is_better',
        testCode: 'cmj',
        isCanonical: true,
        archivedAt: null,
      });
      expect(
        metrics.find((metric) => metric.code === 'dist_m')?.catapultAliases.length,
      ).toBeGreaterThan(0);
    });

    it('filters by sport, source, test and status', async () => {
      const hockey = await all<MetricBody>(sc, '/v1/catalog/metrics', '&sport=hockey');
      expect(hockey.some((metric) => metric.code === 'scrums_n')).toBe(false);
      expect(hockey.some((metric) => metric.code === 'dist_m')).toBe(true);
      const sprint = await all<MetricBody>(sc, '/v1/catalog/metrics', '&testCode=sprint_40');
      expect(sprint.every((metric) => metric.testCode === 'sprint_40')).toBe(true);
      const field = await all<MetricBody>(sc, '/v1/catalog/metrics', '&source=field');
      expect(field.every((metric) => metric.source === 'field')).toBe(true);

      await database.admin.query(
        `update metric_definition set archived_at = now() where club_id = $1 and code = 'kicks_n'`,
        [clubA],
      );
      const active = await all<MetricBody>(sc, '/v1/catalog/metrics');
      expect(active.some((metric) => metric.code === 'kicks_n')).toBe(false);
      const archived = await all<MetricBody>(sc, '/v1/catalog/metrics', '&status=archived');
      expect(archived.map((metric) => metric.code)).toEqual(['kicks_n']);
    });
  });

  describe('access', () => {
    it('is for the staff of the club: players and guardians are forbidden', async () => {
      for (const caller of [player, parent]) {
        for (const path of ['/v1/catalog/tests', '/v1/catalog/metrics']) {
          const response = await get(caller, path);
          expect(response.statusCode, path).toBe(403);
        }
      }
    });

    it("keeps each club's catalog apart", async () => {
      await database.admin.query(
        `update metric_definition set description = 'Solo del club B' where club_id = $1 and code = 'dist_m'`,
        [clubB],
      );
      const ownA = await all<MetricBody & { description: string | null }>(
        sc,
        '/v1/catalog/metrics',
      );
      expect(ownA.find((metric) => metric.code === 'dist_m')?.description).not.toBe(
        'Solo del club B',
      );
      const ownB = await all<MetricBody & { description: string | null }>(
        adminB,
        '/v1/catalog/metrics',
      );
      expect(ownB.find((metric) => metric.code === 'dist_m')?.description).toBe('Solo del club B');
      // Club B never got the CMJ v2 of club A.
      const testsB = await all<TestBody>(adminB, '/v1/catalog/tests', '&onDate=2030-06-01');
      expect(testsB.find((test) => test.code === 'cmj')?.protocolVersion).toBe(1);
    });

    it('serves the superadmin in support mode', async () => {
      const response = await get(
        {
          ...superadmin.headers,
          'x-support-club-id': clubA,
          'x-support-reason': SUPPORT_REASON,
        },
        '/v1/catalog/tests?limit=1',
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<Page<TestBody>>().items).toHaveLength(1);
    });

    it('rejects a cursor reused with other filters', async () => {
      const first = await page<TestBody>(sc, '/v1/catalog/tests?limit=1');
      const response = await get(
        sc,
        `/v1/catalog/tests?limit=1&sport=rugby&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      );
      expect(response.statusCode).toBe(400);
    });
  });
});
