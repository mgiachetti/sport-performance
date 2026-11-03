import { createApiClient } from '@sport-performance/contracts';
import { localDate } from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInDays, todayWellness } from '../player/today.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { T0, createFakeSyncServer, upsert, uuid, wellnessDto } from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import { openLocalDatabase } from './db/database.ts';
import { createSyncEngine } from './engine.ts';
import { createReadCache } from './read-cache.ts';

const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const OTHER_CLUB = { membershipId: 'a2222222-2222-4222-8222-222222222222', userId: 'u1' };
const TODAY = localDate(2026, 11, 3);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const api = createFakeApi();
  const server = createFakeSyncServer(api);
  const database = await openLocalDatabase(nodeSqliteDriver());
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const engine = createSyncEngine({
    database,
    api: client,
    randomUUID: uuid,
    now: () => T0,
    random: () => 0.5,
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  cleanups.push(() => {
    engine.dispose();
  });
  await engine.setScope(SCOPE);
  return { api, server, engine, cache: createReadCache(database) };
}

describe('read cache (ADR 0071)', () => {
  it('keeps the last answer of each read by membership', async () => {
    const { cache } = await setup();
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toBeNull();
    await cache.put(SCOPE, 'me.player', { stage: 'foundation' }, T0);
    await cache.put(SCOPE, 'me.player', { stage: 'development' }, T0 + 1000);
    await cache.put(OTHER_CLUB, 'me.player', { stage: 'performance' }, T0);
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toEqual({
      value: { stage: 'development' },
      fetchedAt: T0 + 1000,
    });
    // Another club (another membership) never answers this one.
    expect(await cache.get(OTHER_CLUB.membershipId, 'me.player')).toEqual({
      value: { stage: 'performance' },
      fetchedAt: T0,
    });
  });

  it('is deleted when signing out and never written back for the previous user', async () => {
    const { cache, engine } = await setup();
    await cache.put(SCOPE, 'me.consents', { types: [] }, T0);
    await engine.wipe();
    expect(await cache.get(SCOPE.membershipId, 'me.consents')).toBeNull();
    // An answer that arrives after the sign-out is dropped.
    await cache.put(SCOPE, 'me.consents', { types: [] }, T0 + 1);
    expect(await cache.get(SCOPE.membershipId, 'me.consents')).toBeNull();
  });

  it('is deleted when another person signs in on the phone', async () => {
    const { cache, engine } = await setup();
    await cache.put(SCOPE, 'me.player', { id: 'mine' }, T0);
    await engine.setScope({ membershipId: OTHER_CLUB.membershipId, userId: 'u2' });
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toBeNull();
    await cache.put(SCOPE, 'me.player', { id: 'mine' }, T0);
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toBeNull();
  });
});

describe("today's wellness through the queue", () => {
  it('shows a queued check-in and its corrections, then the synced row', async () => {
    const { engine, server } = await setup();
    const clientUuid = uuid();
    await engine.enqueue('wellness.submit', {
      body: { clientUuid, localDate: TODAY, scores: { sleep: 2, fatigue: 3, soreness: 4 } },
    });
    await engine.enqueue('wellness.correct', {
      target: { clientUuid },
      body: { changeReason: 'Toqué la carita equivocada', scores: { sleep: 4 } },
    });
    const queue = await engine.store.pending(SCOPE.membershipId);
    const rows = await engine.store.list(SCOPE.membershipId, 'wellness');
    expect(todayWellness(rows, queue, TODAY)).toEqual({
      scores: { sleep: 4, fatigue: 3, soreness: 4 },
      target: { clientUuid },
      pending: true,
    });
    expect(checkInDays(rows, queue)).toEqual([TODAY]);

    // The server applies both and the pull brings the row back.
    const row = wellnessDto({
      localDate: TODAY,
      itemCount: 3,
      items: ['sleep', 'fatigue', 'soreness'],
      scores: { sleep: 4, fatigue: 3, soreness: 4 },
    });
    server.publish(upsert('wellness', row, clientUuid));
    await engine.syncNow();
    const synced = todayWellness(
      await engine.store.list(SCOPE.membershipId, 'wellness'),
      await engine.store.pending(SCOPE.membershipId),
      TODAY,
    );
    expect(synced).toMatchObject({ target: { id: row.id }, scores: row.scores });
  });
});
