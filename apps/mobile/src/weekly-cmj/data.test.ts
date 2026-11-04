import { createApiClient, type SyncMutation } from '@sport-performance/contracts';
import { parseLocalDate } from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { createReadCache } from '../offline/read-cache.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  ANA_ID,
  BRUNO_ID,
  CMJ_DEFINITION_ID,
  M17_ID,
  cmjResultDto,
  resultChange,
  weeklyCmjRoutes,
} from '../test/weekly-cmj-fixtures.ts';
import {
  loadWeeklyCmjRoster,
  loadWeeklyCmjSettings,
  loadWeeklyCmjSetup,
  readWeeklyCmjView,
  recordWeeklyCmjAttempts,
  refreshWeeklyCmjRoster,
  refreshWeeklyCmjSetup,
  saveWeeklyCmjSettings,
  voidWeeklyCmjAttempt,
} from './data.ts';
import { DEFAULT_WEEKLY_CMJ_SETTINGS, todayResultFor, type WeeklyCmjSettings } from './model.ts';

const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const EVALUATOR = 'f1111111-1111-4111-8111-111111111111';
/** 12:00 in Buenos Aires on 03/11/2026 (15:00 UTC). */
const NOW = Date.UTC(2026, 10, 3, 15, 0, 0);
const SETTINGS: WeeklyCmjSettings = { method: 'app', mode: 'height_cm', categoryId: M17_ID };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const api = createFakeApi();
  const server = createFakeSyncServer(api);
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const database = await openLocalDatabase(nodeSqliteDriver());
  const engine = createSyncEngine({
    database,
    api: client,
    randomUUID: uuid,
    now: () => NOW,
    random: () => 0.5,
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  await engine.setScope(SCOPE);
  const cache = createReadCache(database, { activeScope: () => SCOPE, now: () => NOW });
  cleanups.push(() => {
    engine.dispose();
  });
  weeklyCmjRoutes(api);
  return { api, server, client, engine, cache };
}

async function view({
  engine,
  cache,
}: Pick<Awaited<ReturnType<typeof setup>>, 'engine' | 'cache'>) {
  const setupDoc = await loadWeeklyCmjSetup(cache, SCOPE.membershipId);
  const roster = await loadWeeklyCmjRoster(cache, SCOPE.membershipId, M17_ID);
  if (setupDoc === null || roster === null) throw new Error('nothing cached');
  return readWeeklyCmjView({
    store: engine.store,
    membershipId: SCOPE.membershipId,
    setup: setupDoc.value,
    roster: roster.value,
    settings: SETTINGS,
    nowMs: NOW,
  });
}

function rowOf(result: Awaited<ReturnType<typeof view>>, playerId: string) {
  const row = result.rows.find((candidate) => candidate.player.playerId === playerId);
  if (row === undefined) throw new Error(playerId);
  return row;
}

describe('weekly CMJ data', () => {
  it('keeps the setup and the roster on the phone and reads them without signal', async () => {
    const { api, client, engine, cache } = await setup();
    const fresh = await refreshWeeklyCmjSetup(client, cache, SCOPE);
    expect(fresh.test?.testDefinitionId).toBe(CMJ_DEFINITION_ID);
    expect(fresh.categories.map((c) => c.name)).toEqual(['M17', 'M15']);
    expect(api.last('GET /v1/configuration/alert-rules')?.query.get('kind')).toBe('cmj_drop');
    await refreshWeeklyCmjRoster(client, cache, SCOPE, M17_ID);
    expect(api.last('GET /v1/panel/weekly')?.query.get('categoryId')).toBe(M17_ID);

    api.setOffline(true);
    const result = await view({ engine, cache });
    expect(result.today).toBe(parseLocalDate('2026-11-03'));
    // Carla is at `development`: no weekly CMJ, only counted.
    expect(result.rows.map((row) => row.player.firstName)).toEqual(['Ana', 'Bruno']);
    expect(result.otherStages).toBe(1);
  });

  it('keeps the settings of the session per membership', async () => {
    const { cache } = await setup();
    expect(await loadWeeklyCmjSettings(cache, SCOPE.membershipId)).toEqual(
      DEFAULT_WEEKLY_CMJ_SETTINGS,
    );
    await saveWeeklyCmjSettings(cache, SCOPE, { ...SETTINGS, mode: 'flight_time_ms' });
    expect(await loadWeeklyCmjSettings(cache, SCOPE.membershipId)).toEqual({
      ...SETTINGS,
      mode: 'flight_time_ms',
    });
  });

  it('compares with the synced history and records through the queue, offline', async () => {
    const { api, server, client, engine, cache } = await setup();
    await refreshWeeklyCmjSetup(client, cache, SCOPE);
    await refreshWeeklyCmjRoster(client, cache, SCOPE, M17_ID);
    server.publish(
      resultChange(cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-13', heightsCm: [40] })),
      resultChange(
        cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-20', heightsCm: [41, 42] }),
      ),
      resultChange(cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-27', heightsCm: [41] })),
      // Another method: never part of the baseline.
      resultChange(
        cmjResultDto({
          playerId: ANA_ID,
          measuredOn: '2026-10-29',
          heightsCm: [30],
          method: 'manual',
        }),
      ),
    );
    await engine.syncNow();

    let result = await view({ engine, cache });
    const ana = rowOf(result, ANA_ID);
    expect(ana.baseline).toMatchObject({ heightCm: 41, samples: 3 });
    expect(ana.otherMethodDays).toBe(1);
    expect(ana.verdict).toBeNull();

    api.setOffline(true);
    await recordWeeklyCmjAttempts(engine, {
      existing: null,
      playerId: ANA_ID,
      testDefinitionId: CMJ_DEFINITION_ID,
      today: result.today,
      method: 'app',
      mode: 'height_cm',
      evaluatorId: EVALUATOR,
      values: [37.5, 37],
      randomUUID: uuid,
      nowMs: NOW,
    });
    result = await view({ engine, cache });
    let row = rowOf(result, ANA_ID);
    expect(row.todayHeightCm).toBe(37.5);
    expect(row.sync).toBe('queued');
    expect(row.verdict).toMatchObject({
      kind: 'compared',
      severity: 'warning',
      baselineHeightCm: 41,
    });

    // A third attempt goes to the same result; a wrong one is voided, never edited.
    const today = todayResultFor(row, 'app');
    if (today === null) throw new Error('no result today');
    await recordWeeklyCmjAttempts(engine, {
      existing: today,
      playerId: ANA_ID,
      testDefinitionId: CMJ_DEFINITION_ID,
      today: result.today,
      method: 'app',
      mode: 'flight_time_ms',
      evaluatorId: EVALUATOR,
      values: [580],
      randomUUID: uuid,
      nowMs: NOW,
    });
    const first = today.attempts[0];
    if (first === undefined) throw new Error('no attempt');
    await voidWeeklyCmjAttempt(engine, {
      target: today.target,
      entryId: first.id,
      reason: 'Intento mal cargado',
    });
    row = rowOf(await view({ engine, cache }), ANA_ID);
    expect(row.today).toHaveLength(1);
    expect(row.today[0]?.attempts.map((a) => [a.attemptNumber, a.voidedReason])).toEqual([
      [1, 'Intento mal cargado'],
      [2, null],
      [3, null],
    ]);
    // 580 ms → 41,25 cm counts now that 37,5 is voided.
    expect(row.todayHeightCm).toBeCloseTo(41.25, 2);
    expect(row.verdict).toMatchObject({ kind: 'compared', severity: 'ok' });

    // Back online: pushed in order, the server's row replaces the queue, nothing duplicated.
    api.setOffline(false);
    await engine.syncNow();
    const pushed: SyncMutation[] = server.pushes.flat();
    expect(pushed.map((m) => m.op)).toEqual([
      'test_result.create',
      'test_result.add_entries',
      'test_result.void_entries',
    ]);
    const create = pushed[0];
    if (create?.op !== 'test_result.create') throw new Error('create');
    expect(create.body).toMatchObject({
      status: 'done',
      playerId: ANA_ID,
      testDefinitionId: CMJ_DEFINITION_ID,
      measuredOn: '2026-11-03',
      method: 'app',
      evaluatorId: EVALUATOR,
    });
    expect(create.body).not.toHaveProperty('testSessionId');
    const clientUuid = 'clientUuid' in today.target ? today.target.clientUuid : '';
    server.publish(
      resultChange(
        cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-11-03', heightsCm: [37.5, 37, 41.25] }),
        clientUuid,
      ),
    );
    await engine.syncNow();
    row = rowOf(await view({ engine, cache }), ANA_ID);
    expect(row.today).toHaveLength(1);
    expect(row.sync).toBe('saved');
  });

  it('goes with the membership when the user signs out', async () => {
    const { client, engine, cache } = await setup();
    await refreshWeeklyCmjSetup(client, cache, SCOPE);
    await refreshWeeklyCmjRoster(client, cache, SCOPE, M17_ID);
    await engine.wipe();
    expect(await loadWeeklyCmjSetup(cache, SCOPE.membershipId)).toBeNull();
    expect(await loadWeeklyCmjRoster(cache, SCOPE.membershipId, M17_ID)).toBeNull();
  });

  it('shows the queued jumps of a player whose create the server has not served yet', async () => {
    const { client, engine, cache } = await setup();
    await refreshWeeklyCmjSetup(client, cache, SCOPE);
    await refreshWeeklyCmjRoster(client, cache, SCOPE, M17_ID);
    await recordWeeklyCmjAttempts(engine, {
      existing: null,
      playerId: BRUNO_ID,
      testDefinitionId: CMJ_DEFINITION_ID,
      today: parseLocalDate('2026-11-03'),
      method: 'app',
      mode: 'height_cm',
      evaluatorId: EVALUATOR,
      values: [45],
      randomUUID: uuid,
      nowMs: NOW,
    });
    const bruno = rowOf(await view({ engine, cache }), BRUNO_ID);
    expect(bruno.verdict).toEqual({ kind: 'no_baseline', samples: 0, minSamples: 3 });
    expect(bruno.todayHeightCm).toBe(45);
  });
});
