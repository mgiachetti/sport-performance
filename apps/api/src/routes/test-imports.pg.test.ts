/**
 * Imports of historical results end to end (B-331, ADR 0052) against
 * Postgres 16, through the real connection roles (ADR 0026): the preview
 * that writes nothing, the all-or-nothing import with its issues per row,
 * idempotency, duplicates, the stage rules as warnings, consent and the
 * permission matrix, and the warning of the series when historical results
 * are mixed with measured ones (principle 4).
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

interface Issue {
  path: (string | number)[];
  code: string;
  message: string;
}

interface Envelope {
  error: { code: string; message: string; details?: Issue[] };
}

interface Warning {
  code: string;
  metricCode?: string;
  suggestedValues?: number[];
  testResultIds?: string[];
}

interface PreviewBody {
  rows: {
    index: number;
    playerId: string | null;
    protocolVersion: number | null;
    measuredOn: string | null;
    outcome: string;
    scores: { metricCode: string; value: number; derived: boolean }[];
    warnings: Warning[];
  }[];
  issues: Issue[];
  summary: Record<string, number>;
}

interface ImportBody {
  import: {
    id: string;
    source: string;
    rowCount: number;
    createdCount: number;
    skippedCount: number;
    createdBy: string | null;
  };
  rows: { index: number; outcome: string; testResultId: string | null; warnings: Warning[] }[];
}

interface ResultBody {
  id: string;
  playerId: string;
  testCode: string;
  method: string | null;
  testSessionId: string | null;
  evaluatorId: string | null;
  importId: string | null;
  measuredOn: string;
  version: string;
  scores: { metricCode: string; value: number }[];
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** The contract limit of rows in one import, and the time budget of the preview or the import. */
const TEST_IMPORT_ROWS = 1000;
const TEST_IMPORT_BUDGET_MS = 30_000;

const SUPPORT_REASON = encodeURIComponent('Alta del club para los tests de B-331');

// An import records many results through the real roles: room for a busy CI runner.
vi.setConfig({ testTimeout: 30_000 });

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('imports of historical results (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let scM17: SignedIn;
  let coachA: SignedIn;
  let playerUser: SignedIn;
  let clubA: ClubId;
  const categories: Record<string, string> = {};
  const players = { p15: '', p13: '', late: '', noConsent: '', twinA: '', twinB: '' };

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });

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
    name: { first: string; last: string },
    birthDate: string,
    options: { consent?: boolean; userId?: string; since?: string } = {},
  ): Promise<string> {
    const created = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, $3, $4, $5, 'male', 'rugby', '2020-01-01') returning id`,
      [clubA, options.userId ?? null, name.first, name.last, birthDate],
    );
    const id = created.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, $4)`,
      [clubA, id, categoryId, options.since ?? '2020-01-01'],
    );
    if (options.consent !== false) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubA, id, adminA.userId],
      );
    }
    return id;
  }

  async function assign(membershipId: string, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, membershipId, categoryId],
    );
  }

  const post = (caller: SignedIn, url: string, payload: unknown) =>
    t.app.inject({ method: 'POST', url, headers: caller.headers, payload: payload as never });
  const get = (caller: SignedIn, url: string) => t.app.inject({ url, headers: caller.headers });
  const patch = (caller: SignedIn, url: string, payload: unknown) =>
    t.app.inject({ method: 'PATCH', url, headers: caller.headers, payload: payload as never });

  async function historicalCount(): Promise<number> {
    const { rows } = await database.admin.query<{ n: number }>(
      `select count(*)::int as n from test_result where club_id = $1 and method = 'historical'`,
      [clubA],
    );
    return rows[0]?.n ?? -1;
  }

  async function importCount(): Promise<number> {
    const { rows } = await database.admin.query<{ n: number }>(
      `select count(*)::int as n from test_import where club_id = $1`,
      [clubA],
    );
    return rows[0]?.n ?? -1;
  }

  /** A valid spreadsheet: sprint and CMJ of 2024 for two players, by name and by id. */
  const validRows = () => [
    {
      player: { lastName: 'PEREZ', firstName: 'JUAN', birthDate: '2011-05-01' },
      testCode: 'sprint_40',
      entries: [{ kind: 'sprint_splits', split10S: 1.95, split20S: 3.3, split40S: 5.9 }],
    },
    {
      player: { playerId: players.p15 },
      testCode: 'cmj',
      // 512 instead of 51,2: imported, with a warning and a suggestion.
      entries: [{ kind: 'value', metricCode: 'cmj_height_cm', value: 512 }],
      notes: 'Planilla de abril',
    },
    {
      player: { playerId: players.p13 },
      testCode: 'cmj',
      measuredOn: '2024-07-15',
      entries: [
        { kind: 'cmj_flight_time', attemptNumber: 1, flightTimeS: 0.45 },
        { kind: 'cmj_flight_time', attemptNumber: 2, flightTimeS: 0.47 },
      ],
    },
  ];

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
    adminA = await signIn(t, 'admin@imports-a.example.com');
    adminB = await signIn(t, 'admin@imports-b.example.com');
    scA = await signIn(t, 'sc@imports-a.example.com');
    scM17 = await signIn(t, 'sc17@imports-a.example.com');
    coachA = await signIn(t, 'coach@imports-a.example.com');
    playerUser = await signIn(t, 'player@imports-a.example.com');

    clubA = await createClub('imports-a');
    const clubB = await createClub('imports-b');
    const rows = await database.admin.query<{ id: string; age_band_code: string }>(
      `select id, age_band_code from category where club_id = $1`,
      [clubA],
    );
    for (const row of rows.rows) categories[row.age_band_code] = row.id;

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const scMembership = await createMembership(database.admin, scA.userId, clubA, 'sc');
    const sc17Membership = await createMembership(database.admin, scM17.userId, clubA, 'sc');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    for (const band of ['m13', 'm15']) {
      await assign(scMembership, categories[band] ?? '');
      await assign(coachMembership, categories[band] ?? '');
    }
    await assign(sc17Membership, categories.m17 ?? '');

    players.p15 = await insertPlayer(
      categories.m15 ?? '',
      { first: 'Juan', last: 'Pérez' },
      '2011-05-01',
      { userId: playerUser.userId },
    );
    players.p13 = await insertPlayer(
      categories.m13 ?? '',
      { first: 'Tomás', last: 'Gómez' },
      '2013-05-01',
    );
    players.late = await insertPlayer(
      categories.m15 ?? '',
      { first: 'Luca', last: 'Rossi' },
      '2011-02-01',
      { since: '2026-01-01' },
    );
    players.noConsent = await insertPlayer(
      categories.m15 ?? '',
      { first: 'Pedro', last: 'Sin' },
      '2011-07-01',
      { consent: false },
    );
    players.twinA = await insertPlayer(
      categories.m15 ?? '',
      { first: 'Martín', last: 'Díaz' },
      '2011-09-09',
    );
    players.twinB = await insertPlayer(
      categories.m15 ?? '',
      { first: 'Martin', last: 'Diaz' },
      '2011-09-09',
    );
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('preview', () => {
    it('scores every row with the domain formulas and writes nothing', async () => {
      const response = await post(scA, '/v1/test-imports/preview', {
        clientUuid: randomUUID(),
        source: 'Planilla de tests 2024',
        measuredOn: '2024-04-10',
        rows: validRows(),
      });
      expect(response.statusCode, response.body).toBe(200);
      const preview = response.json<PreviewBody>();
      expect(preview.issues).toEqual([]);
      expect(preview.summary).toMatchObject({ rowCount: 3, createCount: 3, invalidCount: 0 });
      expect(preview.rows.map((r) => [r.playerId, r.measuredOn, r.outcome])).toEqual([
        [players.p15, '2024-04-10', 'create'],
        [players.p15, '2024-04-10', 'create'],
        [players.p13, '2024-07-15', 'create'],
      ]);
      const vmax = preview.rows[0]?.scores.find((s) => s.metricCode === 'sprint_vmax_ms');
      expect(vmax?.value).toBeCloseTo(20 / (5.9 - 3.3), 9);
      // CMJ from the flight time, best of the attempts: h = g·t²/8.
      const cmj = preview.rows[2]?.scores.find((s) => s.metricCode === 'cmj_height_cm');
      expect(cmj?.value).toBeCloseTo(((9.81 * 0.47 ** 2) / 8) * 100, 6);
      const implausible = preview.rows[1]?.warnings.find((w) => w.code === 'implausible_value');
      expect(implausible).toMatchObject({ metricCode: 'cmj_height_cm' });
      expect(implausible?.suggestedValues).toContain(51.2);
      expect(await historicalCount()).toBe(0);
      expect(await importCount()).toBe(0);
    });

    it('reports every problem of every row at once, with the rules of historical results', async () => {
      const response = await post(scA, '/v1/test-imports/preview', {
        clientUuid: randomUUID(),
        source: 'Planilla con errores',
        measuredOn: '2024-04-10',
        rows: [
          { player: { playerId: randomUUID() }, testCode: 'cmj', entries: [cmjValue(40)] },
          {
            player: { lastName: 'Díaz', firstName: 'Martín', birthDate: '2011-09-09' },
            testCode: 'cmj',
            entries: [cmjValue(40)],
          },
          {
            player: { playerId: players.p15 },
            testCode: 'cmj',
            measuredOn: '2099-01-01',
            entries: [cmjValue(40)],
          },
          {
            player: { playerId: players.p15 },
            testCode: 'sprint_40',
            entries: [{ kind: 'value', metricCode: 'sprint_vmax_ms', value: 8 }],
          },
          { player: { playerId: players.noConsent }, testCode: 'cmj', entries: [cmjValue(40)] },
          {
            player: { playerId: players.p15 },
            testCode: 'strength',
            entries: [{ kind: 'strength_set', loadKg: 60, reps: 5, rir: 2 }],
          },
          {
            player: { playerId: players.p15 },
            testCode: 'anthro',
            entries: [{ kind: 'value', metricCode: 'height_cm', value: 170 }],
          },
          {
            player: { playerId: players.p15 },
            testCode: 'cmj',
            protocolVersion: 9,
            entries: [cmjValue(40)],
          },
        ],
      });
      expect(response.statusCode, response.body).toBe(200);
      const preview = response.json<PreviewBody>();
      const at = (index: number) =>
        preview.issues.filter((i) => i.path[2] === index).map((i) => [i.path.slice(3), i.code]);
      expect(at(0)).toEqual([[['player'], 'custom']]);
      expect(at(1)).toEqual([[['player'], 'custom']]);
      expect(at(2)).toEqual([[['measuredOn'], 'custom']]);
      expect(at(3)).toEqual([[['entries', 0, 'metricCode'], 'custom']]);
      expect(at(4)).toEqual([[['player'], 'consent_required']]);
      expect(at(5)).toEqual([[['exercise'], 'custom']]);
      expect(at(6)).toContainEqual([['testCode'], 'custom']);
      expect(at(7)).toEqual([[['protocolVersion'], 'custom']]);
      expect(preview.rows.every((r) => r.outcome === 'invalid')).toBe(true);
      expect(preview.summary).toMatchObject({ rowCount: 8, createCount: 0, invalidCount: 8 });
      expect(await historicalCount()).toBe(0);
    });

    it('warns about the stage rules instead of blocking a historical result', async () => {
      const response = await post(scA, '/v1/test-imports/preview', {
        clientUuid: randomUUID(),
        source: 'Planilla de etapas',
        measuredOn: '2024-04-10',
        rows: [
          // Bronco is only in the battery of M17/M19.
          {
            player: { playerId: players.p13 },
            testCode: 'bronco',
            entries: [{ kind: 'value', metricCode: 'bronco_time_s', value: 330 }],
          },
          // Before the player joined a category: no stage rules to check.
          { player: { playerId: players.late }, testCode: 'cmj', entries: [cmjValue(38)] },
          // e1RM in M13 (technique only), and a set outside the protocol.
          {
            player: { playerId: players.p13 },
            testCode: 'strength',
            exercise: 'goblet_squat',
            entries: [{ kind: 'strength_set', loadKg: 30, reps: 8, rir: 0 }],
          },
        ],
      });
      expect(response.statusCode, response.body).toBe(200);
      const preview = response.json<PreviewBody>();
      expect(preview.issues).toEqual([]);
      const codes = (index: number) => preview.rows[index]?.warnings.map((w) => w.code) ?? [];
      expect(codes(0)).toContain('not_in_battery');
      expect(codes(1)).toEqual(['no_category_on_day']);
      expect(codes(2)).toEqual(
        expect.arrayContaining(['strength_metric_not_in_stage', 'protocol_issue']),
      );
      expect(preview.rows.every((r) => r.outcome === 'create')).toBe(true);
    });
  });

  describe('import', () => {
    const clientUuid = randomUUID();
    let imported: ImportBody;

    it('writes nothing when a row is invalid', async () => {
      const response = await post(scA, '/v1/test-imports', {
        clientUuid: randomUUID(),
        source: 'Planilla de tests 2024',
        measuredOn: '2024-04-10',
        rows: [
          ...validRows(),
          { player: { playerId: players.noConsent }, testCode: 'cmj', entries: [cmjValue(40)] },
        ],
      });
      expect(response.statusCode, response.body).toBe(400);
      const error = errorOf(response);
      expect(error.code).toBe('validation_failed');
      expect(error.details?.map((d) => d.path)).toEqual([['body', 'rows', 3, 'player']]);
      expect(await historicalCount()).toBe(0);
      expect(await importCount()).toBe(0);
    });

    it('records historical results of the import, idempotently', async () => {
      const payload = {
        clientUuid,
        source: 'Planilla de tests 2024',
        measuredOn: '2024-04-10',
        rows: validRows(),
      };
      const response = await post(scA, '/v1/test-imports', payload);
      expect(response.statusCode, response.body).toBe(201);
      imported = response.json<ImportBody>();
      expect(imported.import).toMatchObject({
        source: 'Planilla de tests 2024',
        rowCount: 3,
        createdCount: 3,
        skippedCount: 0,
        createdBy: scA.userId,
      });
      expect(imported.rows.map((r) => r.outcome)).toEqual(['created', 'created', 'created']);
      expect(imported.rows[1]?.warnings.map((w) => w.code)).toContain('implausible_value');

      const id = imported.rows[0]?.testResultId ?? '';
      const result = (await get(scA, `/v1/test-results/${id}`)).json<ResultBody>();
      expect(result).toMatchObject({
        playerId: players.p15,
        testCode: 'sprint_40',
        method: 'historical',
        testSessionId: null,
        evaluatorId: null,
        importId: imported.import.id,
        measuredOn: '2024-04-10',
      });

      const replay = await post(scA, '/v1/test-imports', payload);
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      const again = replay.json<ImportBody>();
      expect(again.import.id).toBe(imported.import.id);
      expect(again.rows.map((r) => r.testResultId)).toEqual(
        imported.rows.map((r) => r.testResultId),
      );
      expect(await historicalCount()).toBe(3);

      // The same clientUuid with another batch of as many rows is not a replay.
      const [first, ...rest] = validRows();
      const changed = await post(scA, '/v1/test-imports', {
        ...payload,
        rows: [{ ...first, notes: 'Otra planilla' }, ...rest],
      });
      expect(changed.statusCode, changed.body).toBe(409);
      expect(changed.headers['x-idempotent-replay']).toBeUndefined();
      expect(await historicalCount()).toBe(3);

      // The same batch cannot be previewed again: it is imported.
      const preview = await post(scA, '/v1/test-imports/preview', payload);
      expect(preview.statusCode).toBe(409);
    });

    it('lists the imports and their results', async () => {
      const list = (await get(scA, '/v1/test-imports')).json<Page<ImportBody['import']>>();
      expect(list.items.map((i) => i.id)).toEqual([imported.import.id]);
      const one = await get(adminA, `/v1/test-imports/${imported.import.id}`);
      expect(one.statusCode, one.body).toBe(200);
      const results = (
        await get(scA, `/v1/test-results?importId=${imported.import.id}&sort=createdAt`)
      ).json<Page<ResultBody>>();
      expect(results.items.map((r) => r.id).sort()).toEqual(
        imported.rows.map((r) => r.testResultId).sort(),
      );
      expect(results.items.every((r) => r.importId === imported.import.id)).toBe(true);
      expect((await get(adminB, `/v1/test-imports/${imported.import.id}`)).statusCode).toBe(404);
      expect((await get(adminB, '/v1/test-imports')).json<Page<unknown>>().items).toEqual([]);
    });

    it('rejects duplicates by default and skips them on request', async () => {
      const payload = {
        clientUuid: randomUUID(),
        source: 'La misma planilla otra vez',
        measuredOn: '2024-04-10',
        rows: validRows(),
      };
      const rejected = await post(scA, '/v1/test-imports', payload);
      expect(rejected.statusCode).toBe(400);
      expect(errorOf(rejected).details?.map((d) => d.code)).toEqual([
        'duplicate',
        'duplicate',
        'duplicate',
      ]);

      const preview = (
        await post(scA, '/v1/test-imports/preview', { ...payload, onDuplicate: 'skip' })
      ).json<PreviewBody>();
      expect(preview.summary).toMatchObject({ createCount: 0, skipCount: 3 });
      expect(preview.rows[0]?.warnings.find((w) => w.code === 'duplicate')?.testResultIds).toEqual([
        imported.rows[0]?.testResultId,
      ]);

      const extra = {
        player: { playerId: players.p15 },
        testCode: 'cmj',
        measuredOn: '2024-11-05',
        entries: [cmjValue(44)],
      };
      const skipped = await post(scA, '/v1/test-imports', {
        ...payload,
        onDuplicate: 'skip',
        rows: [...payload.rows, extra],
      });
      expect(skipped.statusCode, skipped.body).toBe(201);
      const body = skipped.json<ImportBody>();
      expect(body.import).toMatchObject({ rowCount: 4, createdCount: 1, skippedCount: 3 });
      expect(body.rows.map((r) => r.outcome)).toEqual([
        'skipped_duplicate',
        'skipped_duplicate',
        'skipped_duplicate',
        'created',
      ]);
      expect(await historicalCount()).toBe(4);

      const repeated = await post(scA, '/v1/test-imports', {
        clientUuid: randomUUID(),
        source: 'Fila repetida',
        rows: [
          { ...extra, measuredOn: '2023-11-05' },
          { ...extra, measuredOn: '2023-11-05' },
        ],
      });
      expect(repeated.statusCode).toBe(400);
      expect(errorOf(repeated).details).toEqual([
        expect.objectContaining({ path: ['body', 'rows', 1], code: 'duplicate' }),
      ]);
    });

    it('rejects entry clientUuids, which the server derives from the batch', async () => {
      // The same entry clientUuid in two rows was a 409 of the preview and a 403 of the
      // import (a conflict mistaken for a replay): now a row error of the request.
      const entryClientUuid = randomUUID();
      const [importsBefore, resultsBefore] = [await importCount(), await historicalCount()];
      const payload = {
        clientUuid: randomUUID(),
        source: 'Planilla con ids de entrada',
        measuredOn: '2023-03-10',
        rows: [players.p15, players.p13].map((playerId) => ({
          player: { playerId },
          testCode: 'cmj',
          entries: [{ ...cmjValue(40), clientUuid: entryClientUuid }],
        })),
      };
      for (const url of ['/v1/test-imports/preview', '/v1/test-imports']) {
        const response = await post(adminA, url, payload);
        expect(response.statusCode, response.body).toBe(400);
        const error = errorOf(response);
        expect(error.code).toBe('validation_failed');
        expect(error.details?.map((d) => d.path.slice(0, 5))).toEqual([
          ['body', 'rows', 0, 'entries', 0],
          ['body', 'rows', 1, 'entries', 0],
        ]);
      }
      expect([await importCount(), await historicalCount()]).toEqual([
        importsBefore,
        resultsBefore,
      ]);

      // Without them, the same rows import, and a replay finds the same entries.
      const valid = {
        ...payload,
        rows: payload.rows.map((row) => ({ ...row, entries: [cmjValue(40)] })),
      };
      const created = await post(adminA, '/v1/test-imports', valid);
      expect(created.statusCode, created.body).toBe(201);
      const replay = await post(adminA, '/v1/test-imports', valid);
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ImportBody>().rows.map((r) => r.testResultId)).toEqual(
        created.json<ImportBody>().rows.map((r) => r.testResultId),
      );
      const { rows: entryIds } = await database.admin.query<{ n: number }>(
        `select count(distinct entry_id)::int as n from test_result_value v
           join test_result r on r.club_id = v.club_id and r.id = v.test_result_id
          where r.import_id = $1`,
        [created.json<ImportBody>().import.id],
      );
      expect(entryIds[0]?.n).toBe(2);
    });

    it('keeps a corrected imported result done and historical, without the stage rules', async () => {
      const response = await post(scA, '/v1/test-imports', {
        clientUuid: randomUUID(),
        source: 'Planilla de mayo',
        measuredOn: '2024-05-20',
        rows: [
          // Not in the battery of M13: a warning on import.
          {
            player: { playerId: players.p13 },
            testCode: 'bronco',
            entries: [{ kind: 'value', metricCode: 'bronco_time_s', value: 330 }],
          },
          // In no category that day: a warning on import.
          { player: { playerId: players.late }, testCode: 'cmj', entries: [cmjValue(38)] },
          // Compared only on the same device, imported without one.
          {
            player: { playerId: players.p13 },
            testCode: 'reaction',
            entries: [{ kind: 'value', metricCode: 'reaction_simple_msec', value: 260 }],
          },
          // An e1RM in M13: strength_metric_not_in_stage, a warning on import.
          {
            player: { playerId: players.p13 },
            testCode: 'strength',
            exercise: 'goblet_squat',
            entries: [{ kind: 'strength_set', attemptNumber: 1, loadKg: 30, reps: 5, rir: 2 }],
          },
          // Another CMJ of the player imported for 2024-07-15.
          { player: { playerId: players.p13 }, testCode: 'cmj', entries: [cmjValue(39)] },
        ],
      });
      expect(response.statusCode, response.body).toBe(201);
      const [bronco, late, reaction, strength, cmj] = response
        .json<ImportBody>()
        .rows.map((r) => r.testResultId ?? '');
      const read = async (id: string | undefined) =>
        (await get(scA, `/v1/test-results/${id ?? ''}`)).json<ResultBody>();
      const reason = 'Corrección de la planilla de mayo';

      for (const [body, path] of [
        [{ method: 'manual' }, ['body', 'method']],
        [{ status: 'not_done', notDoneReason: 'absent' }, ['body', 'status']],
      ] as const) {
        const result = await read(bronco);
        const rejected = await patch(scA, `/v1/test-results/${bronco ?? ''}`, {
          version: result.version,
          changeReason: reason,
          ...body,
        });
        expect(rejected.statusCode, rejected.body).toBe(400);
        expect(errorOf(rejected).details?.map((d) => d.path)).toContainEqual(path);
      }

      // A new day follows the rules of the import: not in the future, not before birth,
      // and not on the day of another result of the same player, test and exercise.
      for (const [measuredOn, message, code] of [
        ['2099-01-01', 'A historical result is not in the future', 'custom'],
        ['2012-01-01', 'The player was not born yet on measuredOn', 'custom'],
        [
          '2024-07-15',
          'A result of the same player, test, day and exercise is already recorded',
          'duplicate',
        ],
      ] as const) {
        const rejected = await patch(scA, `/v1/test-results/${cmj ?? ''}`, {
          version: (await read(cmj)).version,
          changeReason: reason,
          measuredOn,
        });
        expect(rejected.statusCode, rejected.body).toBe(400);
        expect(errorOf(rejected).details).toContainEqual({
          path: ['body', 'measuredOn'],
          code,
          message,
        });
      }

      // A new day applies no stage rules, as the import did not.
      for (const id of [bronco, late]) {
        const result = await read(id);
        const moved = await patch(scA, `/v1/test-results/${id ?? ''}`, {
          version: result.version,
          changeReason: reason,
          measuredOn: '2024-06-20',
        });
        expect(moved.statusCode, moved.body).toBe(200);
        expect(moved.json<ResultBody>()).toMatchObject({
          measuredOn: '2024-06-20',
          method: 'historical',
        });
      }
      const notes = await patch(scA, `/v1/test-results/${bronco ?? ''}`, {
        version: (await read(bronco)).version,
        changeReason: reason,
        notes: 'Corregido',
      });
      expect(notes.statusCode, notes.body).toBe(200);

      // The device is not required on a correction, as it was not on import.
      for (const body of [{ notes: 'Sin dispositivo' }, { measuredOn: '2024-06-21' }]) {
        const corrected = await patch(scA, `/v1/test-results/${reaction ?? ''}`, {
          version: (await read(reaction)).version,
          changeReason: reason,
          ...body,
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
      }

      // Another attempt of the e1RM: the stage rule stays a warning, as on import.
      const added = await post(scA, `/v1/test-results/${strength ?? ''}/entries`, {
        entries: [{ kind: 'strength_set', attemptNumber: 2, loadKg: 32, reps: 5, rir: 2 }],
      });
      expect(added.statusCode, added.body).toBe(200);
      expect(added.json<ResultBody>().scores.map((v) => v.metricCode)).toContain('e1rm_kg');
    });

    it('follows the permission matrix', async () => {
      const payload = {
        clientUuid: randomUUID(),
        source: 'Planilla',
        measuredOn: '2023-04-10',
        rows: [{ player: { playerId: players.p15 }, testCode: 'cmj', entries: [cmjValue(40)] }],
      };
      for (const caller of [coachA, playerUser]) {
        expect((await post(caller, '/v1/test-imports', payload)).statusCode).toBe(403);
        expect((await post(caller, '/v1/test-imports/preview', payload)).statusCode).toBe(403);
        expect((await get(caller, '/v1/test-imports')).statusCode).toBe(403);
      }
      // The sc of M17 is not assigned to the player: an issue of the row.
      const outside = await post(scM17, '/v1/test-imports', payload);
      expect(outside.statusCode).toBe(400);
      expect(errorOf(outside).details?.[0]?.path).toEqual(['body', 'rows', 0, 'player']);
      const admin = await post(adminA, '/v1/test-imports', payload);
      expect(admin.statusCode, admin.body).toBe(201);
      // A replay by an sc who sees the player is a replay; by one who does not, forbidden
      // (not a conflict: it is the same batch).
      const replay = await post(scA, '/v1/test-imports', payload);
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      const hidden = await post(scM17, '/v1/test-imports', payload);
      expect(hidden.statusCode, hidden.body).toBe(403);
      expect(hidden.headers['x-idempotent-replay']).toBeUndefined();
    });
    it('replays a batch after the consent of one of its players is revoked', async () => {
      const revoked = await insertPlayer(
        categories.m15 ?? '',
        { first: 'Ana', last: 'Revocada' },
        '2011-03-03',
      );
      const payload = {
        clientUuid: randomUUID(),
        source: 'Planilla',
        measuredOn: '2023-05-10',
        rows: [{ player: { playerId: revoked }, testCode: 'cmj', entries: [cmjValue(41)] }],
      };
      const created = await post(adminA, '/v1/test-imports', payload);
      expect(created.statusCode, created.body).toBe(201);
      await database.admin.query(
        `update consent set revoked_at = now(), revoked_by = $2 where club_id = $1 and player_id = $3`,
        [clubA, adminA.userId, revoked],
      );
      // A new import of the player is an issue of its row; the replay only returns the ids
      // already recorded, which the RLS of test_result still shows (ADR 0052).
      const again = await post(adminA, '/v1/test-imports', {
        ...payload,
        clientUuid: randomUUID(),
      });
      expect(again.statusCode).toBe(400);
      expect(errorOf(again).details?.[0]?.code).toBe('consent_required');
      const replay = await post(adminA, '/v1/test-imports', payload);
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ImportBody>().rows[0]?.testResultId).toBe(
        created.json<ImportBody>().rows[0]?.testResultId,
      );
    });
  });

  describe('a batch of the size limit', () => {
    it('previews and imports 1000 rows within the time budget', async () => {
      const many: string[] = [];
      for (let index = 0; index < 100; index += 1) {
        many.push(
          await insertPlayer(
            categories.m15 ?? '',
            { first: `Jugador ${String(index)}`, last: 'Lote' },
            '2011-04-04',
          ),
        );
      }
      // 100 players, CMJ and sprint on five days each: 1000 distinct rows.
      const rows = Array.from({ length: TEST_IMPORT_ROWS }, (_, index) => {
        const sprint = index >= TEST_IMPORT_ROWS / 2;
        return {
          player: { playerId: many[index % 100] ?? '' },
          testCode: sprint ? 'sprint_40' : 'cmj',
          measuredOn: `2022-03-0${String(1 + (Math.floor(index / 100) % 5))}`,
          entries: sprint
            ? [{ kind: 'sprint_splits', split10S: 1.9, split20S: 3.2, split40S: 5.8 }]
            : [
                { kind: 'cmj_flight_time', attemptNumber: 1, flightTimeS: 0.45 },
                { kind: 'cmj_flight_time', attemptNumber: 2, flightTimeS: 0.47 },
              ],
        };
      });
      const payload = { clientUuid: randomUUID(), source: 'Planilla grande', rows };
      const resultsBefore = await historicalCount();

      let started = performance.now();
      const preview = await post(adminA, '/v1/test-imports/preview', payload);
      const previewMs = performance.now() - started;
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json<PreviewBody>().summary).toMatchObject({
        rowCount: TEST_IMPORT_ROWS,
        createCount: TEST_IMPORT_ROWS,
        invalidCount: 0,
      });
      expect(await historicalCount()).toBe(resultsBefore);

      started = performance.now();
      const imported = await post(adminA, '/v1/test-imports', payload);
      const importMs = performance.now() - started;
      expect(imported.statusCode, imported.body).toBe(201);
      expect(imported.json<ImportBody>().import.createdCount).toBe(TEST_IMPORT_ROWS);
      expect(await historicalCount()).toBe(resultsBefore + TEST_IMPORT_ROWS);
      // Well under the connection timeout of the API (60 s by default), with room for CI.
      expect(previewMs, `preview: ${String(Math.round(previewMs))} ms`).toBeLessThan(
        TEST_IMPORT_BUDGET_MS,
      );
      expect(importMs, `import: ${String(Math.round(importMs))} ms`).toBeLessThan(
        TEST_IMPORT_BUDGET_MS,
      );
    }, 300_000);
  });

  describe('comparison', () => {
    it('warns when the series mixes historical and measured results', async () => {
      const measured = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: (
          await database.admin.query<{ id: string }>(
            `select id from test_definition where club_id = $1 and code = 'cmj'`,
            [clubA],
          )
        ).rows[0]?.id,
        measuredOn: '2026-03-10',
        method: 'manual',
        entries: [cmjValue(45)],
      });
      expect(measured.statusCode, measured.body).toBe(201);
      const url = `/v1/players/${players.p15}/test-metrics/cmj_height_cm`;
      const series = (await get(scA, url)).json<{
        comparison: { methods: string[]; warnings: string[] };
      }>();
      expect(series.comparison.methods).toEqual(['historical', 'manual']);
      expect(series.comparison.warnings).toContain('mixed_methods');
      const historical = (await get(scA, `${url}?method=historical`)).json<{
        items: unknown[];
        comparison: { warnings: string[] };
      }>();
      expect(historical.items.length).toBeGreaterThan(0);
      expect(historical.comparison.warnings).toEqual([]);
    });
  });
});

function cmjValue(heightCm: number) {
  return { kind: 'value', metricCode: 'cmj_height_cm', value: heightCm };
}
