import { createApiClient, type ApiClient } from '@sport-performance/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { createReadCache } from '../offline/read-cache.ts';
import { DAY, OTHER_PLAYER_ID, anthroDto, anthroUpsert } from '../test/anthro-fixtures.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { PLAYER_ID, T0, createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  CONTEXT_KEY,
  canRecordAnthropometry,
  clubTimeZone,
  contextSchema,
  keptThenFresh,
  loadMeasurements,
  refreshContext,
  refreshSquad,
  squadKey,
  squadSchema,
} from './data.ts';
import { dayMeasurements, recordInput } from './model.ts';

const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const day = DAY as Parameters<typeof recordInput>[2];

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function page<T>(items: T[]) {
  return Promise.resolve({ items, nextCursor: null });
}

const CATEGORIES = [
  { id: 'c15', name: 'M15', sport: 'rugby' },
  { id: 'c17', name: 'M17', sport: 'rugby' },
  { id: 'h16', name: 'Sub 16', sport: 'hockey' },
];

function contextApi(assignments: unknown[]) {
  return {
    getClub: vi.fn(() => Promise.resolve({ timeZone: 'America/Argentina/Buenos_Aires' })),
    listCategories: vi.fn(() => page(CATEGORIES)),
    listMyStaffAssignments: vi.fn(() => page(assignments)),
  } as unknown as Pick<ApiClient, 'getClub' | 'listCategories' | 'listMyStaffAssignments'>;
}

async function setupCache() {
  const database = await openLocalDatabase(nodeSqliteDriver());
  return createReadCache(database, { now: () => T0, activeScope: () => SCOPE });
}

describe('who records on the phone', () => {
  it('is whoever the matrix lets record anthropometry', () => {
    expect(canRecordAnthropometry('sc')).toBe(true);
    expect(canRecordAnthropometry('admin')).toBe(true);
    expect(canRecordAnthropometry('coach')).toBe(false);
    expect(canRecordAnthropometry('player')).toBe(false);
    expect(canRecordAnthropometry('parent')).toBe(false);
  });
});

describe('cached reads of the sheet', () => {
  it('keep the categories of the assignments for the staff and every one for the administration', async () => {
    const cache = await setupCache();
    const sc = await refreshContext(
      contextApi([
        { target: { kind: 'category', categoryId: 'c15' } },
        { target: { kind: 'sport', sport: 'hockey' } },
      ]),
      cache,
      SCOPE,
      'sc',
    );
    expect(sc.categories.map((c) => c.name)).toEqual(['M15', 'Sub 16']);
    const kept = await cache.get(SCOPE.membershipId, CONTEXT_KEY, contextSchema);
    expect(kept?.value).toEqual(sc);
    expect(clubTimeZone(kept?.value ?? null)).toBe('America/Argentina/Buenos_Aires');

    const api = contextApi([]);
    const admin = await refreshContext(api, cache, SCOPE, 'admin');
    expect(admin.categories).toHaveLength(3);
    expect(api.listMyStaffAssignments).not.toHaveBeenCalled();
  });

  it('keep the squad with the stage, consent and parents of each player on the day', async () => {
    const cache = await setupCache();
    const preview = vi.fn((input: { body: { measurements: { playerId: string }[] } }) =>
      Promise.resolve({
        reference: null,
        items: input.body.measurements.map(({ playerId }) => ({
          playerId,
          measuredOn: DAY,
          blockedBy: playerId === OTHER_PLAYER_ID ? 'consent_required' : null,
          stage: playerId === OTHER_PLAYER_ID ? null : 'performance',
          gaps: {
            phvOffset: [],
            adultHeight: playerId === PLAYER_ID ? ['parent_heights_missing'] : [],
          },
        })),
      }),
    );
    const api = {
      listPlayers: vi.fn(() =>
        page([
          {
            id: PLAYER_ID,
            firstName: 'Juan',
            lastName: 'Pérez',
            sex: 'male',
            birthDate: '2009-05-01',
          },
          {
            id: OTHER_PLAYER_ID,
            firstName: 'Tomás',
            lastName: 'Gómez',
            sex: 'male',
            birthDate: '2009-07-01',
          },
        ]),
      ),
      previewAnthroMeasurements: preview,
    } as unknown as Pick<ApiClient, 'listPlayers' | 'previewAnthroMeasurements'>;
    const squad = await refreshSquad(api, cache, SCOPE, 'c17', day);
    expect(preview.mock.calls[0]?.[0].body.measurements).toEqual([
      { playerId: PLAYER_ID, measuredOn: DAY },
      { playerId: OTHER_PLAYER_ID, measuredOn: DAY },
    ]);
    expect(squad.players).toEqual([
      {
        id: PLAYER_ID,
        name: 'Juan Pérez',
        sex: 'male',
        birthDate: '2009-05-01',
        stage: 'performance',
        blocked: false,
        parentHeightsMissing: true,
      },
      {
        id: OTHER_PLAYER_ID,
        name: 'Tomás Gómez',
        sex: 'male',
        birthDate: '2009-07-01',
        stage: null,
        blocked: true,
        parentHeightsMissing: false,
      },
    ]);
    expect((await cache.get(SCOPE.membershipId, squadKey('c17'), squadSchema))?.value).toEqual(
      squad,
    );
  });

  it('are a miss when a kept document no longer reads', async () => {
    const cache = await setupCache();
    await cache.put(SCOPE, squadKey('c17'), { categoryId: 'c17', measuredOn: 'ayer', players: [] });
    expect(await cache.get(SCOPE.membershipId, squadKey('c17'), squadSchema)).toBeNull();
    await cache.put(SCOPE, CONTEXT_KEY, { timeZone: 'x', categories: [{ id: 1 }] });
    expect(await cache.get(SCOPE.membershipId, CONTEXT_KEY, contextSchema)).toBeNull();
  });
});

describe('kept, then fresh', () => {
  it('shows what the phone has, then the server, and keeps it when the refresh fails', async () => {
    const values: unknown[] = [];
    const missing = vi.fn();
    const refreshing: boolean[] = [];
    await keptThenFresh({
      read: () => Promise.resolve({ value: 'kept', fetchedAt: 1 }),
      refresh: () => Promise.reject(new TypeError('Network request failed')),
      now: () => 9,
      onValue: (value) => values.push(value),
      onMissing: missing,
      onRefreshing: (value) => refreshing.push(value),
      cancelled: () => false,
    });
    expect(values).toEqual([{ data: 'kept', savedAt: 1 }]);
    expect(missing).not.toHaveBeenCalled();
    expect(refreshing).toEqual([true, false]);

    await keptThenFresh({
      read: () => Promise.resolve(null),
      refresh: () => Promise.resolve('fresh'),
      now: () => 9,
      onValue: (value) => values.push(value),
      onMissing: missing,
      cancelled: () => false,
    });
    expect(values.at(-1)).toEqual({ data: 'fresh', savedAt: 9 });

    const error = new TypeError('Network request failed');
    await keptThenFresh({
      read: () => Promise.resolve(null),
      refresh: () => Promise.reject(error),
      now: () => 9,
      onValue: (value) => values.push(value),
      onMissing: missing,
      cancelled: () => false,
    });
    expect(missing).toHaveBeenCalledWith(error);
  });

  it('reports nothing once the screen left', async () => {
    const onValue = vi.fn();
    await keptThenFresh({
      read: () => Promise.resolve({ value: 'kept', fetchedAt: 1 }),
      refresh: () => Promise.resolve('fresh'),
      now: () => 9,
      onValue,
      onMissing: vi.fn(),
      cancelled: () => true,
    });
    expect(onValue).not.toHaveBeenCalled();
  });
});

describe('a measurement day without signal', () => {
  async function setup() {
    const api = createFakeApi();
    const server = createFakeSyncServer(api);
    const database = await openLocalDatabase(nodeSqliteDriver());
    const time = T0;
    const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
    const engine = createSyncEngine({
      database,
      api: client,
      randomUUID: uuid,
      now: () => time,
      random: () => 0.5,
      setTimer: () => 0,
      clearTimer: () => undefined,
      reportError: () => undefined,
    });
    await engine.setScope(SCOPE);
    cleanups.push(() => {
      engine.dispose();
    });
    return { api, server, engine };
  }

  const players = new Set([PLAYER_ID, OTHER_PLAYER_ID]);
  const sheet = async (engine: Awaited<ReturnType<typeof setup>>['engine']) => {
    const { served, queued } = await loadMeasurements(engine, SCOPE.membershipId, day, players);
    return dayMeasurements(served, queued, day);
  };

  it('shows what was queued, with its corrections, and the server row once it is pulled', async () => {
    const { api, server, engine } = await setup();
    api.setOffline(true);
    const clientUuid = uuid();
    await engine.enqueue(
      'anthro.record',
      recordInput(clientUuid, PLAYER_ID, day, { heightCm: 16.54, weightKg: 55.1 }),
    );
    await engine.enqueue('anthro.update', {
      target: { clientUuid },
      body: { changeReason: 'Coma corrida', heightCm: 165.4 },
    });
    expect((await sheet(engine)).get(PLAYER_ID)).toMatchObject({
      target: { clientUuid },
      sync: 'queued',
      values: { heightCm: 165.4, weightKg: 55.1, sittingHeightCm: null },
      maturation: null,
    });
    expect(await engine.syncNow()).toMatchObject({ status: 'failed', phase: 'offline' });

    // Back online: the queue goes up in order and the pull brings the measurement.
    api.setOffline(false);
    const served = anthroDto({ heightCm: 165.4, sittingHeightCm: null, weightKg: 55.1 });
    server.publish(
      anthroUpsert(
        { ...served, maturation: { ...served.maturation, derivedAt: null } },
        clientUuid,
      ),
    );
    expect(await engine.syncNow()).toMatchObject({ status: 'synced' });
    expect(server.pushes.flat().map((m) => m.op)).toEqual(['anthro.record', 'anthro.update']);
    expect(await engine.store.pending(SCOPE.membershipId)).toEqual([]);
    expect((await sheet(engine)).get(PLAYER_ID)).toMatchObject({
      target: { id: served.id },
      sync: 'synced',
      maturation: { derivedAt: null },
    });

    // The worker derived the maturation: the next pull brings it.
    server.publish(anthroUpsert(served, clientUuid));
    await engine.syncNow();
    expect((await sheet(engine)).get(PLAYER_ID)?.maturation).toMatchObject({
      phvOffsetYears: -0.8,
      adultHeightPct: 92.8,
    });
  });

  it('lays a correction of a served measurement over it until the server answers', async () => {
    const { api, server, engine } = await setup();
    const served = anthroDto({ playerId: OTHER_PLAYER_ID });
    server.publish(anthroUpsert(served));
    await engine.syncNow();
    api.setOffline(true);
    await engine.enqueue('anthro.update', {
      target: { id: served.id },
      body: { changeReason: 'Peso con zapatillas', weightKg: 54.3 },
    });
    expect((await sheet(engine)).get(OTHER_PLAYER_ID)).toMatchObject({
      target: { id: served.id },
      sync: 'pending',
      values: { weightKg: 54.3, heightCm: 165.4 },
      // The device cannot recompute it: pending until the pull.
      maturation: { derivedAt: null },
    });
  });
});
