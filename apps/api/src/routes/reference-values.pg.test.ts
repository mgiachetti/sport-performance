/**
 * First-team references end to end (B-321, ADR 0040) against Postgres 16,
 * through the real connection roles (ADR 0026): the permission matrix in
 * the handlers (`configuration` for the staff, `group_reference` for the
 * player's view), RLS behind it, and the endpoint conventions (ADR 0032):
 * idempotent creates, versions, archive, cursors, support headers.
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
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
import { importRowClientUuid } from './reference-values.js';

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface ReferenceBody {
  id: string;
  metricDefinitionId: string;
  metricCode: string;
  sport: string;
  sex: string;
  scope: 'position' | 'line' | 'squad';
  positionId: string | null;
  positionCode: string | null;
  lineCode: string | null;
  value: number;
  unit: string;
  method: string | null;
  validFrom: string;
  source: string;
  archivedAt: string | null;
  version: string;
}

interface PlayerReferences {
  playerId: string;
  asOf: string;
  sport: string;
  sex: string;
  positionCode: string | null;
  lineCode: string | null;
  items: {
    metricCode: string;
    unit: string;
    direction: string;
    scope: string;
    value: number;
    method: string | null;
    validFrom: string;
    source: string;
  }[];
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Carga de referencias pedida por el club');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('first-team references (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let medicalA: SignedIn;
  let playerA: SignedIn;
  let parentA: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  /** Player of `playerA`: rugby M15, hooker (forwards). */
  let ownPlayer: string;
  /** Another rugby M17 player of club A, fly half (backs). */
  let otherPlayer: string;

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });
  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  const cmj = (extra: Record<string, unknown> = {}) => ({
    metricCode: 'cmj_height_cm',
    sport: 'rugby',
    sex: 'male',
    value: 45.5,
    unit: 'cm',
    validFrom: '2026-02-01',
    source: 'Primera, pretemporada 2026',
    ...extra,
  });

  async function create(caller: SignedIn | Record<string, string>, payload: object) {
    return t.app.inject({
      method: 'POST',
      url: '/v1/reference-values',
      headers: 'headers' in caller ? (caller as SignedIn).headers : caller,
      payload,
    });
  }

  async function list(caller: SignedIn, query = ''): Promise<Page<ReferenceBody>> {
    const response = await t.app.inject({
      url: `/v1/reference-values${query}`,
      headers: caller.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<ReferenceBody>>();
  }

  async function newClub(slug: string, branches: { sport: string; sex: string }[]) {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: { slug, name: `Club ${slug}`, shortName: slug.toUpperCase(), branches },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  async function categoryId(clubId: ClubId, band: string): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `select id from category where club_id = $1 and sport = 'rugby' and age_band_code = $2`,
      [clubId, band],
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    options: { userId?: string; positionCode: string; categoryId: string; name: string },
  ): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, $3, 'Test', '2011-05-10', 'male', 'rugby', '2020-01-01')
       returning id`,
      [clubId, options.userId ?? null, options.name],
    );
    const id = result.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_position (club_id, player_id, position_id, sort_order)
       values ($1, $2, (select id from position where club_id = $1 and sport = 'rugby' and code = $3), 0)`,
      [clubId, id, options.positionCode],
    );
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, options.categoryId],
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
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    scA = await signIn(t, 'sc@club-a.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    medicalA = await signIn(t, 'medical@club-a.example.com');
    playerA = await signIn(t, 'player@club-a.example.com');
    parentA = await signIn(t, 'parent@club-a.example.com');

    clubA = await newClub('club-a', [
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    clubB = await newClub('club-b', [{ sport: 'rugby', sex: 'male' }]);
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await createMembership(database.admin, scA.userId, clubA, 'sc');
    await createMembership(database.admin, medicalA.userId, clubA, 'medical');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, playerA.userId, clubA, 'player');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    const m15 = await categoryId(clubA, 'm15');
    const m17 = await categoryId(clubA, 'm17');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coachMembership, m15],
    );
    ownPlayer = await insertPlayer(clubA, {
      userId: playerA.userId,
      positionCode: 'hooker',
      categoryId: m15,
      name: 'Propio',
    });
    otherPlayer = await insertPlayer(clubA, {
      positionCode: 'fly_half',
      categoryId: m17,
      name: 'Otro',
    });
    await database.admin.query(
      `insert into guardian (club_id, user_id, player_id, relationship, valid_from) values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, parentA.userId, ownPlayer],
    );
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('manual entry', () => {
    let squad: ReferenceBody;
    const clientUuid = randomUUID();

    it('lets sc load a squad reference, idempotently', async () => {
      const response = await create(scA, { ...cmj(), clientUuid, method: 'video' });
      expect(response.statusCode, response.body).toBe(201);
      squad = response.json<ReferenceBody>();
      expect(squad).toMatchObject({
        metricCode: 'cmj_height_cm',
        sport: 'rugby',
        sex: 'male',
        scope: 'squad',
        positionId: null,
        positionCode: null,
        lineCode: null,
        value: 45.5,
        unit: 'cm',
        method: 'video',
        validFrom: '2026-02-01',
        source: 'Primera, pretemporada 2026',
        archivedAt: null,
      });
      const replay = await create(scA, { ...cmj(), clientUuid, method: 'video' });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ReferenceBody>().id).toBe(squad.id);
      const count = await database.admin.query<{ n: string }>(
        'select count(*) as n from reference_value where club_id = $1',
        [clubA],
      );
      expect(count.rows[0]?.n).toBe('1');
    });

    it('answers conflict for a second active reference with the same key', async () => {
      const response = await create(adminA, cmj({ value: 50 }));
      expect(response.statusCode, response.body).toBe(409);
      expect(errorOf(response).code).toBe('conflict');
      // Another start date is another period: allowed.
      const later = await create(adminA, cmj({ value: 47, validFrom: '2026-07-01' }));
      expect(later.statusCode, later.body).toBe(201);
    });

    it('loads position and line references, resolving their codes', async () => {
      const hooker = await create(scA, cmj({ positionCode: 'hooker', value: 41 }));
      expect(hooker.statusCode, hooker.body).toBe(201);
      expect(hooker.json<ReferenceBody>()).toMatchObject({
        scope: 'position',
        positionCode: 'hooker',
        lineCode: null,
      });
      expect(hooker.json<ReferenceBody>().positionId).not.toBeNull();
      const backs = await create(scA, cmj({ lineCode: 'backs', value: 52 }));
      expect(backs.statusCode, backs.body).toBe(201);
      expect(backs.json<ReferenceBody>()).toMatchObject({ scope: 'line', lineCode: 'backs' });
    });

    it('validates the metric, the unit, the position and the line against the club', async () => {
      const cases: [object, string][] = [
        [cmj({ metricCode: 'not_a_metric' }), 'metricCode'],
        [cmj({ unit: 'm' }), 'unit'],
        [cmj({ metricCode: 'scrums_n', unit: 'n', sport: 'hockey', sex: 'female' }), 'metricCode'],
        [cmj({ positionCode: 'goalkeeper' }), 'positionCode'],
        [cmj({ lineCode: 'midfielders' }), 'lineCode'],
      ];
      for (const [payload, field] of cases) {
        const response = await create(scA, payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        const error = errorOf(response);
        expect(error.code).toBe('validation_failed');
        expect(error.details?.map((d) => d.path)).toContainEqual(['body', field]);
      }
      // Both scopes at once: the contract rejects it.
      const both = await create(scA, cmj({ positionCode: 'hooker', lineCode: 'forwards' }));
      expect(both.statusCode).toBe(400);
    });

    it('denies writes to the coach and the medical staff, and everything to players and parents', async () => {
      for (const caller of [coachA, medicalA, playerA, parentA]) {
        const response = await create(caller, cmj({ validFrom: '2025-01-01' }));
        expect(response.statusCode, response.body).toBe(403);
        expect(errorOf(response).message).not.toMatch(/role_denied|out_of_scope/);
      }
      for (const caller of [playerA, parentA]) {
        const response = await t.app.inject({
          url: '/v1/reference-values',
          headers: caller.headers,
        });
        expect(response.statusCode).toBe(403);
        const one = await t.app.inject({
          url: `/v1/reference-values/${squad.id}`,
          headers: caller.headers,
        });
        expect(one.statusCode).toBe(403);
      }
    });

    it('lets the whole staff read, with filters and a stable cursor', async () => {
      for (const caller of [coachA, medicalA, scA, adminA]) {
        expect((await list(caller)).items).toHaveLength(4);
      }
      expect((await list(scA, '?scope=position')).items.map((r) => r.positionCode)).toEqual([
        'hooker',
      ]);
      expect((await list(scA, '?lineCode=backs')).items).toHaveLength(1);
      expect((await list(scA, '?positionCode=hooker')).items).toHaveLength(1);
      expect((await list(scA, '?scope=squad')).items.map((r) => r.validFrom)).toEqual([
        '2026-07-01',
        '2026-02-01',
      ]);
      expect((await list(scA, '?metricCode=sprint_40_s')).items).toHaveLength(0);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Page<ReferenceBody> = await list(
          scA,
          `?limit=1&sort=createdAt${cursor === null ? '' : `&cursor=${cursor}`}`,
        );
        seen.push(...page.items.map((r) => r.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
      const first = await list(scA, '?limit=1&sort=createdAt');
      const wrong = await t.app.inject({
        url: `/v1/reference-values?limit=1&sort=validFrom&cursor=${first.nextCursor ?? ''}`,
        headers: scA.headers,
      });
      expect(wrong.statusCode).toBe(400);
      expect(errorOf(wrong).code).toBe('bad_request');
    });

    it('corrects a reference with the current version and answers conflict for a stale one', async () => {
      const response = await t.app.inject({
        method: 'PATCH',
        url: `/v1/reference-values/${squad.id}`,
        headers: scA.headers,
        payload: { version: squad.version, value: 46, method: null, source: 'Primera, V1 2026' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const updated = response.json<ReferenceBody>();
      expect(updated).toMatchObject({ value: 46, method: null, source: 'Primera, V1 2026' });
      expect(updated.version).not.toBe(squad.version);
      const stale = await t.app.inject({
        method: 'PATCH',
        url: `/v1/reference-values/${squad.id}`,
        headers: scA.headers,
        payload: { version: squad.version, value: 47 },
      });
      expect(stale.statusCode).toBe(409);
      // The scope is not editable.
      const scope = await t.app.inject({
        method: 'PATCH',
        url: `/v1/reference-values/${squad.id}`,
        headers: scA.headers,
        payload: { version: updated.version, positionCode: 'hooker' },
      });
      expect(scope.statusCode).toBe(400);
      // Moving it onto the date of the other squad reference collides.
      const collide = await t.app.inject({
        method: 'PATCH',
        url: `/v1/reference-values/${squad.id}`,
        headers: scA.headers,
        payload: { version: updated.version, validFrom: '2026-07-01' },
      });
      expect(collide.statusCode).toBe(409);
      squad = updated;
    });

    it('archives and restores, idempotently, and refuses a restore that collides', async () => {
      const archive = () =>
        t.app.inject({
          method: 'POST',
          url: `/v1/reference-values/${squad.id}/archive`,
          headers: adminA.headers,
        });
      const first = await archive();
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json<ReferenceBody>().archivedAt).not.toBeNull();
      expect((await archive()).statusCode).toBe(200);
      expect((await list(scA)).items.map((r) => r.id)).not.toContain(squad.id);
      expect((await list(scA, '?status=archived')).items.map((r) => r.id)).toEqual([squad.id]);

      // A new active reference takes its key; restoring the old one would collide.
      const replacement = await create(scA, cmj({ value: 44 }));
      expect(replacement.statusCode, replacement.body).toBe(201);
      const restore = () =>
        t.app.inject({
          method: 'POST',
          url: `/v1/reference-values/${squad.id}/restore`,
          headers: adminA.headers,
        });
      expect((await restore()).statusCode).toBe(409);
      const archived = await t.app.inject({
        method: 'POST',
        url: `/v1/reference-values/${replacement.json<ReferenceBody>().id}/archive`,
        headers: adminA.headers,
      });
      expect(archived.statusCode).toBe(200);
      const restored = await restore();
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.json<ReferenceBody>().archivedAt).toBeNull();
      expect((await restore()).statusCode).toBe(200);
    });

    it('hides the references of another club', async () => {
      const read = await t.app.inject({
        url: `/v1/reference-values/${squad.id}`,
        headers: adminB.headers,
      });
      expect(read.statusCode).toBe(404);
      const update = await t.app.inject({
        method: 'PATCH',
        url: `/v1/reference-values/${squad.id}`,
        headers: adminB.headers,
        payload: { version: squad.version, value: 1 },
      });
      expect(update.statusCode).toBe(404);
      for (const action of ['archive', 'restore']) {
        const response = await t.app.inject({
          method: 'POST',
          url: `/v1/reference-values/${squad.id}/${action}`,
          headers: adminB.headers,
        });
        expect(response.statusCode).toBe(404);
      }
      expect((await list(adminB, '?status=all')).items).toHaveLength(0);
      // The same clientUuid in another club is another create.
      const other = await create(adminB, { ...cmj(), clientUuid });
      expect(other.statusCode, other.body).toBe(201);
      expect(other.headers['x-idempotent-replay']).toBeUndefined();
    });

    it('lets a supporting superadmin load references, audited', async () => {
      const response = await create(supporting(clubB), cmj({ validFrom: '2025-02-01' }));
      expect(response.statusCode, response.body).toBe(201);
      const log = await database.admin.query<{ n: string }>(
        'select count(*) as n from support.access_log where club_id = $1',
        [clubB],
      );
      expect(Number(log.rows[0]?.n)).toBeGreaterThan(0);
      const withoutReason = await create(
        { ...superadmin.headers, 'x-support-club-id': clubB },
        cmj({ validFrom: '2025-03-01' }),
      );
      expect(withoutReason.statusCode).toBe(403);
    });
  });

  describe('import', () => {
    const importOf = (caller: SignedIn, payload: object) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/reference-values/import',
        headers: caller.headers,
        payload,
      });

    const sprintRows = [
      { metricCode: 'sprint_40_s', sport: 'rugby', sex: 'male', value: 5.3, unit: 's' },
      {
        metricCode: 'sprint_40_s',
        sport: 'rugby',
        sex: 'male',
        positionCode: 'hooker',
        value: 5.6,
        unit: 's',
        method: 'photocell',
      },
      {
        metricCode: 'sprint_40_s',
        sport: 'rugby',
        sex: 'male',
        lineCode: 'backs',
        value: 5.1,
        unit: 's',
        validFrom: '2026-03-01',
        source: 'Catapult, marzo 2026',
      },
    ];
    const batchUuid = randomUUID();

    it('imports a parsed table with the defaults of the batch, idempotently', async () => {
      const payload = {
        clientUuid: batchUuid,
        validFrom: '2026-02-15',
        source: 'Planilla de primera 2026',
        rows: sprintRows,
      };
      const response = await importOf(scA, payload);
      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<{ items: ReferenceBody[]; archivedCount: number }>();
      expect(body.archivedCount).toBe(0);
      expect(body.items.map((r) => [r.scope, r.validFrom, r.source])).toEqual([
        ['squad', '2026-02-15', 'Planilla de primera 2026'],
        ['position', '2026-02-15', 'Planilla de primera 2026'],
        ['line', '2026-03-01', 'Catapult, marzo 2026'],
      ]);
      const stored = await database.admin.query<{ client_uuid: string }>(
        `select client_uuid from reference_value where id = $1`,
        [body.items[0]?.id],
      );
      expect(stored.rows[0]?.client_uuid).toBe(importRowClientUuid(batchUuid, 0));

      const replay = await importOf(scA, payload);
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<{ items: ReferenceBody[] }>().items.map((r) => r.id)).toEqual(
        body.items.map((r) => r.id),
      );
    });

    it('writes nothing when a row is invalid, and says which rows', async () => {
      const before = await database.admin.query<{ n: string }>(
        'select count(*) as n from reference_value where club_id = $1',
        [clubA],
      );
      const response = await importOf(scA, {
        clientUuid: randomUUID(),
        validFrom: '2026-08-01',
        source: 'Planilla',
        rows: [
          { metricCode: 'vift_kmh', sport: 'rugby', sex: 'male', value: 20, unit: 'kmh' },
          { metricCode: 'vift_kmh', sport: 'rugby', sex: 'male', value: 20, unit: 'ms' },
          { metricCode: 'nope', sport: 'rugby', sex: 'male', value: 1, unit: 'n' },
          { metricCode: 'vift_kmh', sport: 'rugby', sex: 'male', value: 21, unit: 'kmh' },
        ],
      });
      expect(response.statusCode, response.body).toBe(400);
      const paths = errorOf(response).details?.map((d) => d.path) ?? [];
      expect(paths).toContainEqual(['body', 'rows', 1, 'unit']);
      expect(paths).toContainEqual(['body', 'rows', 2, 'metricCode']);
      expect(paths).toContainEqual(['body', 'rows', 3]);
      expect(paths.some((p) => p[2] === 0)).toBe(false);
      const after = await database.admin.query<{ n: string }>(
        'select count(*) as n from reference_value where club_id = $1',
        [clubA],
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);

      const noDefaults = await importOf(scA, {
        clientUuid: randomUUID(),
        rows: [{ metricCode: 'vift_kmh', sport: 'rugby', sex: 'male', value: 20, unit: 'kmh' }],
      });
      expect(noDefaults.statusCode).toBe(400);
      expect(errorOf(noDefaults).details?.map((d) => d.path)).toContainEqual([
        'body',
        'rows',
        0,
        'validFrom',
      ]);
    });

    it('answers conflict in insert mode and replaces in replace mode', async () => {
      const payload = (mode: string) => ({
        clientUuid: randomUUID(),
        mode,
        validFrom: '2026-02-15',
        source: 'Planilla corregida',
        rows: [{ ...sprintRows[0], value: 5.25 }],
      });
      const insert = await importOf(scA, payload('insert'));
      expect(insert.statusCode, insert.body).toBe(409);
      const replace = await importOf(scA, payload('replace'));
      expect(replace.statusCode, replace.body).toBe(201);
      const body = replace.json<{ items: ReferenceBody[]; archivedCount: number }>();
      expect(body.archivedCount).toBe(1);
      const active = await list(scA, '?metricCode=sprint_40_s&scope=squad');
      expect(active.items.map((r) => [r.value, r.source])).toEqual([[5.25, 'Planilla corregida']]);
    });

    it('denies the import to the coach', async () => {
      const response = await importOf(coachA, {
        clientUuid: randomUUID(),
        validFrom: '2026-02-15',
        source: 'x',
        rows: sprintRows,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("the player's view", () => {
    const view = (caller: SignedIn, playerId: string, query = '') =>
      t.app.inject({
        url: `/v1/players/${playerId}/first-team-references${query}`,
        headers: caller.headers,
      });

    it('shows the player the most specific reference that applies, by date', async () => {
      const response = await view(playerA, ownPlayer, '?asOf=2026-05-01');
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<PlayerReferences>();
      expect(body).toMatchObject({
        playerId: ownPlayer,
        asOf: '2026-05-01',
        sport: 'rugby',
        sex: 'male',
        positionCode: 'hooker',
        lineCode: 'forwards',
      });
      // Hooker: the position reference wins over the squad one; the backs line never applies.
      expect(body.items.map((i) => [i.metricCode, i.scope, i.value])).toEqual([
        ['cmj_height_cm', 'position', 41],
        ['sprint_40_s', 'position', 5.6],
      ]);
      expect(body.items[1]).toMatchObject({
        unit: 's',
        direction: 'lower_is_better',
        method: 'photocell',
        source: 'Planilla de primera 2026',
      });
      // Before any reference starts, nothing applies.
      const early = await view(playerA, ownPlayer, '?asOf=2025-12-31');
      expect(early.json<PlayerReferences>().items).toEqual([]);
    });

    it('falls back to the line and the squad, and picks the latest start date', async () => {
      const response = await view(adminA, otherPlayer, '?asOf=2026-08-01');
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<PlayerReferences>();
      expect(body).toMatchObject({ positionCode: 'fly_half', lineCode: 'backs' });
      expect(body.items.map((i) => [i.metricCode, i.scope, i.value, i.validFrom])).toEqual([
        ['cmj_height_cm', 'line', 52, '2026-02-01'],
        ['sprint_40_s', 'line', 5.1, '2026-03-01'],
      ]);
      const filtered = await view(adminA, otherPlayer, '?asOf=2026-08-01&metricCode=sprint_40_s');
      expect(filtered.json<PlayerReferences>().items).toHaveLength(1);
    });

    it("shows a woman only the women's first-team references of her sport (B-804)", async () => {
      const hockeyPlayer = async (firstName: string, sex: 'female' | 'male'): Promise<string> => {
        const { rows } = await database.admin.query<{ id: string }>(
          `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
           values ($1, $2, 'Test', '2011-03-02', $3, 'hockey', '2020-01-01')
           returning id`,
          [clubA, firstName, sex],
        );
        const id = rows[0]?.id ?? '';
        await database.admin.query(
          `insert into player_category (club_id, player_id, category_id, valid_from)
           values ($1, $2, (select id from category where club_id = $1 and sport = 'hockey'
                            and sex = $3 and age_band_code = 'm15'), '2020-01-01')`,
          [clubA, id, sex],
        );
        return id;
      };
      const woman = await hockeyPlayer('Jugadora', 'female');
      // A men's reference of the same sport and metric: only the sex tells them apart.
      const menHockey = await create(
        scA,
        cmj({ sport: 'hockey', sex: 'male', value: 47.5, source: 'Primera masculina 2026' }),
      );
      expect(menHockey.statusCode, menHockey.body).toBe(201);
      // Before any women's reference, the men's ones never stand in for them.
      const none = await view(adminA, woman, '?asOf=2026-05-01');
      expect(none.statusCode, none.body).toBe(200);
      expect(none.json<PlayerReferences>()).toMatchObject({
        sport: 'hockey',
        sex: 'female',
        items: [],
      });
      const created = await create(
        scA,
        cmj({ sport: 'hockey', sex: 'female', value: 38.5, source: 'Primera femenina 2026' }),
      );
      expect(created.statusCode, created.body).toBe(201);
      const body = (await view(adminA, woman, '?asOf=2026-05-01')).json<PlayerReferences>();
      expect(body.items.map((i) => [i.metricCode, i.scope, i.value, i.source])).toEqual([
        ['cmj_height_cm', 'squad', 38.5, 'Primera femenina 2026'],
      ]);
      // And the other way round: a man of the same sport sees only the men's one.
      // The club has no men's hockey branch: open a category for him.
      await database.admin.query(
        `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
         values ($1, 'hockey', 'male', 'm15', 'Sub 15 hockey masculino', 'development')`,
        [clubA],
      );
      const man = await hockeyPlayer('Jugador', 'male');
      const forMan = await view(adminA, man, '?asOf=2026-05-01');
      expect(forMan.statusCode, forMan.body).toBe(200);
      expect(
        forMan.json<PlayerReferences>().items.map((i) => [i.metricCode, i.value, i.source]),
      ).toEqual([['cmj_height_cm', 47.5, 'Primera masculina 2026']]);
      // And the rugby men keep theirs.
      const men = (await view(playerA, ownPlayer, '?asOf=2026-05-01')).json<PlayerReferences>();
      expect(men.items.map((i) => i.value)).not.toContain(38.5);
      expect(men.items.map((i) => i.value)).not.toContain(47.5);
    });

    it('lets the assigned staff in, never another player, the parent or other clubs', async () => {
      expect((await view(coachA, ownPlayer)).statusCode).toBe(200);
      // The coach is assigned to M15 only.
      expect([403, 404]).toContain((await view(coachA, otherPlayer)).statusCode);
      expect([403, 404]).toContain((await view(playerA, otherPlayer)).statusCode);
      expect((await view(parentA, ownPlayer)).statusCode).toBe(403);
      expect((await view(adminB, ownPlayer)).statusCode).toBe(404);
      expect((await view(adminA, randomUUID())).statusCode).toBe(404);
    });
  });
});
