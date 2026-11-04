import { createApiClient, type SyncMutation } from '@sport-performance/contracts';
import {
  DEFAULT_REACTION_PROTOCOL,
  summarizeReactionSeries,
  type ReactionSeriesSummary,
  type ReactionTrialRecord,
} from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { createReadCache } from '../offline/read-cache.ts';
import { apiError, createFakeApi } from '../test/fake-api.ts';
import { createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  ANA_ID,
  BRUNO_ID,
  INSTALLATION_ID,
  M15_ID,
  OTHER_DEVICE_ID,
  REACTION_DEFINITION_ID,
  THIS_DEVICE_ID,
  deviceDto,
  reactionDefinitionDto,
  reactionResultDto,
  reactionRoutes,
  resultChange,
} from '../test/reaction-fixtures.ts';
import {
  clubToday,
  loadReactionRoster,
  loadReactionSetup,
  protocolOf,
  readReactionHistory,
  refreshReactionRoster,
  refreshReactionSetup,
  registerThisDevice,
} from './data.ts';
import { reactionResultInput } from './model.ts';

const SCOPE = { membershipId: 'a3333333-3333-4333-8333-333333333333', userId: 'u1' };
const EVALUATOR = 'f3333333-3333-4333-8333-333333333333';
/** 12:00 in Buenos Aires on 03/11/2026 (15:00 UTC). */
const NOW = Date.UTC(2026, 10, 3, 15, 0, 0);
const HARDWARE = { kind: 'phone', model: 'Pixel 9', osVersion: 'Android 16' } as const;

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
  const cache = createReadCache(database, { activeScope: () => SCOPE });
  cleanups.push(() => {
    engine.dispose();
  });
  return { api, server, client, engine, cache };
}

function completeSeries(task: 'simple' | 'go_no_go', times: number[]): ReactionSeriesSummary {
  const records: ReactionTrialRecord[] = times.map((reactionMs, index) => ({
    index,
    practice: false,
    stimulus: 'go',
    foreperiodMs: 1500,
    outcome: 'valid',
    reactionMs,
  }));
  return summarizeReactionSeries(task, records, DEFAULT_REACTION_PROTOCOL);
}

describe('reaction test data', () => {
  it('keeps the setup and the roster on the phone and reads them without signal', async () => {
    const { api, client, cache } = await setup();
    reactionRoutes(api);
    const fresh = await refreshReactionSetup(client, cache, SCOPE, INSTALLATION_ID);
    expect(fresh.device).toMatchObject({ id: THIS_DEVICE_ID, label: 'Celular de la PF' });
    expect(fresh.definition?.id).toBe(REACTION_DEFINITION_ID);
    expect(protocolOf(fresh)).toEqual(DEFAULT_REACTION_PROTOCOL);
    // The phone looks for itself by its installation id, retired ones included.
    const devices = api.last('GET /v1/devices');
    expect(devices?.query.get('serialNumber')).toBe(INSTALLATION_ID);
    expect(devices?.query.get('status')).toBe('all');
    expect(api.last('GET /v1/test-definitions')?.query.get('code')).toBe('reaction');
    await refreshReactionRoster(client, cache, SCOPE, M15_ID);

    api.setOffline(true);
    const cached = await loadReactionSetup(cache, SCOPE.membershipId, INSTALLATION_ID);
    expect(cached?.data).toEqual(fresh);
    expect(clubToday(cached?.data ?? null, NOW)).toBe('2026-11-03');
    const roster = await loadReactionRoster(cache, SCOPE.membershipId, M15_ID);
    expect(roster?.data.map((p) => p.firstName)).toEqual(['Ana', 'Bruno']);
    // Another installation (a database restored on another phone) has no setup here.
    expect(await loadReactionSetup(cache, SCOPE.membershipId, uuid())).toBeNull();
  });

  it('reads the protocol of the version in force', async () => {
    const { api, client, cache } = await setup();
    reactionRoutes(api, {
      definition: reactionDefinitionDto({ sameDeviceOnly: true, practiceTrials: 2 }),
    });
    const fresh = await refreshReactionSetup(client, cache, SCOPE, INSTALLATION_ID);
    expect(protocolOf(fresh)).toMatchObject({ practiceTrials: 2, validTrials: 5 });
  });

  it('registers this phone with its installation id and keeps it', async () => {
    const { api, client, cache } = await setup();
    reactionRoutes(api, { device: null });
    const before = await refreshReactionSetup(client, cache, SCOPE, INSTALLATION_ID);
    expect(before.device).toBeNull();
    api.on('POST /v1/devices', { status: 201, body: deviceDto({ label: 'Tablet 1' }) });
    const clientUuid = uuid();
    const after = await registerThisDevice(client, cache, SCOPE, {
      setup: before,
      installationId: INSTALLATION_ID,
      label: 'Tablet 1',
      hardware: HARDWARE,
      clientUuid,
    });
    expect(api.last('POST /v1/devices')?.body).toEqual({
      clientUuid,
      kind: 'phone',
      label: 'Tablet 1',
      serialNumber: INSTALLATION_ID,
      model: 'Pixel 9',
      firmwareVersion: 'Android 16',
    });
    expect(after.device).toMatchObject({ id: THIS_DEVICE_ID, label: 'Tablet 1' });
    expect(
      (await loadReactionSetup(cache, SCOPE.membershipId, INSTALLATION_ID))?.data.device?.id,
    ).toBe(THIS_DEVICE_ID);
  });

  it('takes the device someone else registered for this phone, and restores a retired one', async () => {
    const { api, client, cache } = await setup();
    reactionRoutes(api, { device: null });
    const before = await refreshReactionSetup(client, cache, SCOPE, INSTALLATION_ID);
    api.on('POST /v1/devices', apiError(409, 'conflict'));
    api.on('GET /v1/devices', {
      status: 200,
      body: { items: [deviceDto({ label: 'Ya registrado' })], nextCursor: null },
    });
    const found = await registerThisDevice(client, cache, SCOPE, {
      setup: before,
      installationId: INSTALLATION_ID,
      label: 'Otro',
      hardware: HARDWARE,
      clientUuid: uuid(),
    });
    expect(found.device?.label).toBe('Ya registrado');

    const retired = {
      ...found,
      device: {
        id: deviceDto().id,
        label: 'Ya registrado',
        kind: 'phone' as const,
        retiredAt: '2026-10-01T12:00:00.000Z',
      },
    };
    api.on(`POST /v1/devices/${THIS_DEVICE_ID}/restore`, { status: 200, body: deviceDto() });
    const restored = await registerThisDevice(client, cache, SCOPE, {
      setup: retired,
      installationId: INSTALLATION_ID,
      label: 'x',
      hardware: HARDWARE,
      clientUuid: uuid(),
    });
    expect(restored.device?.retiredAt).toBeNull();
  });

  it('compares only with the same player on this device, synced or still in the queue', async () => {
    const { api, server, engine } = await setup();
    reactionRoutes(api);
    server.publish(
      resultChange(
        reactionResultDto({
          playerId: ANA_ID,
          deviceId: THIS_DEVICE_ID,
          measuredOn: '2026-07-10',
          simpleMs: 262,
          goNoGoMs: 341,
        }),
      ),
      // Another device and another player: never in Ana's comparison.
      resultChange(
        reactionResultDto({
          playerId: ANA_ID,
          deviceId: OTHER_DEVICE_ID,
          measuredOn: '2026-08-10',
          simpleMs: 199,
        }),
      ),
      resultChange(
        reactionResultDto({
          playerId: BRUNO_ID,
          deviceId: THIS_DEVICE_ID,
          measuredOn: '2026-08-10',
          simpleMs: 180,
        }),
      ),
    );
    await engine.syncNow();

    // Today's run, saved without signal.
    api.setOffline(true);
    const input = reactionResultInput({
      clientUuid: uuid(),
      playerId: ANA_ID,
      testDefinitionId: REACTION_DEFINITION_ID,
      deviceId: THIS_DEVICE_ID,
      measuredOn: clubToday(null, NOW),
      evaluatorId: EVALUATOR,
      summaries: [completeSeries('simple', [240, 250, 260, 250, 250])],
      notes: 'Reacción simple: 0 anticipaciones, 0 sin respuesta.',
      randomUUID: uuid,
      recordedAt: new Date(NOW).toISOString(),
    });
    if (input === null) throw new Error('nothing to save');
    await engine.enqueue('test_result.create', input);
    const history = await readReactionHistory({
      store: engine.store,
      membershipId: SCOPE.membershipId,
      playerId: ANA_ID,
      deviceId: THIS_DEVICE_ID,
    });
    expect(history.simple.map((item) => [item.measuredOn, item.valueMs, item.pending])).toEqual([
      ['2026-07-10', 262, false],
      ['2026-11-03', 250, true],
    ]);
    expect(history.go_no_go.map((item) => item.valueMs)).toEqual([341]);

    // What the queue sends: the app on this device, one attempt per valid stimulus.
    api.setOffline(false);
    await engine.syncNow();
    const pushed = (api.last('POST /v1/sync/push')?.body as { mutations: SyncMutation[] })
      .mutations[0];
    expect(pushed).toMatchObject({
      op: 'test_result.create',
      body: {
        status: 'done',
        playerId: ANA_ID,
        method: 'app',
        deviceId: THIS_DEVICE_ID,
        measuredOn: '2026-11-03',
        evaluatorId: EVALUATOR,
      },
    });
    const entries = (
      pushed as unknown as { body: { entries: { attemptNumber: number; value: number }[] } }
    ).body.entries;
    expect(entries.map((entry) => [entry.attemptNumber, entry.value])).toEqual([
      [1, 240],
      [2, 250],
      [3, 260],
      [4, 250],
      [5, 250],
    ]);
  });
});
