import { createApiClient, type MyTrainingSession } from '@sport-performance/contracts';
import { localDate } from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInDays, rpeRange, rpeSessions, todayWellness } from '../player/today.ts';
import { createFakeApi } from '../test/fake-api.ts';
import {
  SESSION_ID,
  T0,
  createFakeSyncServer,
  participationDto,
  upsert,
  uuid,
  wellnessDto,
} from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import { openLocalDatabase } from './db/database.ts';
import { createSyncEngine, type SyncScopeRef } from './engine.ts';
import { syncScope } from './db/schema.ts';
import { createReadCache, keptAnswer, readCacheKey, type ReadSchema } from './read-cache.ts';

const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const OTHER_CLUB = { membershipId: 'a2222222-2222-4222-8222-222222222222', userId: 'u1' };
const TODAY = localDate(2026, 11, 3);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup(options: { readonly bindScope?: boolean } = {}) {
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
  // The session's membership, as `services.ts` reads it.
  let active: SyncScopeRef | null = SCOPE;
  if (options.bindScope ?? true) await engine.setScope(SCOPE);
  const cache = createReadCache(database, { activeScope: () => active });
  const actAs = (next: SyncScopeRef | null) => {
    active = next;
  };
  return { api, server, engine, cache, database, actAs };
}

describe('read cache (ADR 0074)', () => {
  it('keeps the last answer of each read by membership', async () => {
    const { cache, actAs } = await setup();
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toBeNull();
    await cache.put(SCOPE, 'me.player', { stage: 'foundation' }, T0);
    await cache.put(SCOPE, 'me.player', { stage: 'development' }, T0 + 1000);
    actAs(OTHER_CLUB);
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
    const { cache, engine, actAs } = await setup();
    await cache.put(SCOPE, 'me.consents', { types: [] }, T0);
    actAs(null);
    await engine.setScope(null);
    await engine.wipe();
    expect(await cache.get(SCOPE.membershipId, 'me.consents')).toBeNull();
    // An answer that arrives after the sign-out is dropped.
    await cache.put(SCOPE, 'me.consents', { types: [] }, T0 + 1);
    expect(await cache.get(SCOPE.membershipId, 'me.consents')).toBeNull();
  });

  it('is deleted when another person signs in on the phone', async () => {
    const { cache, engine, actAs } = await setup();
    await cache.put(SCOPE, 'me.player', { id: 'mine' }, T0);
    const other = { membershipId: OTHER_CLUB.membershipId, userId: 'u2' };
    actAs(other);
    await engine.setScope(other);
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toBeNull();
    await cache.put(SCOPE, 'me.player', { id: 'mine' }, T0);
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toBeNull();
  });

  it('keeps the first answer after signing in, before the engine claims the device', async () => {
    const { cache, engine, actAs } = await setup();
    await cache.put(SCOPE, 'me.player', { id: 'previous' }, T0);
    await engine.setScope(null);
    // Another person signs in: their first read answers before `setScope` runs.
    const next = { membershipId: OTHER_CLUB.membershipId, userId: 'u2' };
    actAs(next);
    await cache.put(next, 'me.player', { id: 'theirs' }, T0 + 1);
    expect(await cache.get(next.membershipId, 'me.player')).toMatchObject({
      value: { id: 'theirs' },
    });
    // Nothing of the previous person stays, and the engine finds the device already theirs.
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toBeNull();
    await engine.setScope(next);
    expect(await cache.get(next.membershipId, 'me.player')).toMatchObject({
      value: { id: 'theirs' },
    });
  });

  it('keeps the first answer on a phone nobody had signed in to', async () => {
    const { cache } = await setup({ bindScope: false });
    await cache.put(SCOPE, 'me.player', { id: 'mine' }, T0);
    expect(await cache.get(SCOPE.membershipId, 'me.player')).toMatchObject({
      value: { id: 'mine' },
    });
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

/** A session of the club day `on` (UTC-3): 16:00, its RPE window until the end of the next day. */
function sessionOn(on: number, id: string = SESSION_ID): MyTrainingSession {
  const day = String(on).padStart(2, '0');
  const next = String(on + 2).padStart(2, '0');
  const startsAt = `2026-11-${day}T19:00:00.000Z`;
  return {
    session: {
      id,
      sport: 'rugby',
      kind: 'training',
      categoryId: null,
      title: null,
      startsAt,
      localDate: localDate(2026, 11, on),
      plannedDurationMin: 90,
      archivedAt: null,
    },
    participation: null,
    rpeWindow: { opensAt: startsAt, closesAt: `2026-11-${next}T03:00:00.000Z` },
    canSubmitRpe: true,
  } as MyTrainingSession;
}

describe('RPE the morning after, without signal', () => {
  const READ = 'me.trainingSessions';
  const params = (today: ReturnType<typeof localDate>) => {
    const range = rpeRange(today);
    return [range.from, range.to];
  };

  it("shows yesterday's session from the list kept yesterday, whose range was another", async () => {
    const { cache } = await setup();
    // On the 3rd, with signal: the list of the 2nd and 3rd is kept, with a session
    // of the 2nd already rated (its window closes at the end of the 3rd).
    const rated = { ...sessionOn(2, uuid()), participation: participationDto({ rpe: 5 }) };
    await cache.put(SCOPE, readCacheKey(READ, params(TODAY)), [rated, sessionOn(3)], T0);

    // The 4th at 10:00 without signal: nothing is kept under the new range...
    const tomorrow = localDate(2026, 11, 4);
    expect(await keptAnswer(cache, SCOPE.membershipId, READ, params(tomorrow))).toBeNull();
    // ...but the latest kept answer of the read still holds the 3rd's session.
    const kept = await keptAnswer<MyTrainingSession[]>(
      cache,
      SCOPE.membershipId,
      READ,
      params(tomorrow),
      true,
    );
    expect(kept?.fetchedAt).toBe(T0);
    const items = rpeSessions({
      sessions: kept?.value ?? [],
      from: rpeRange(tomorrow).from,
      participations: [],
      queue: [],
      nowMs: Date.parse('2026-11-04T13:00:00.000Z'),
    });
    // The 3rd's window is open until the end of the 4th; the 2nd's is out of range.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ session: { id: SESSION_ID }, rpe: null, canSubmit: true });
  });

  it('prefers the answer kept for the same range', async () => {
    const { cache } = await setup();
    const tomorrow = localDate(2026, 11, 4);
    await cache.put(SCOPE, readCacheKey(READ, params(TODAY)), [sessionOn(3)], T0);
    await cache.put(SCOPE, readCacheKey(READ, params(tomorrow)), [], T0 + 1000);
    expect(await keptAnswer(cache, SCOPE.membershipId, READ, params(tomorrow), true)).toEqual({
      value: [],
      fetchedAt: T0 + 1000,
    });
  });
});

// ─── Documents read with their contract (the field test day, ADR 0075) ──────────────

const numberBox: ReadSchema<{ n: number }> = {
  safeParse: (value) =>
    typeof value === 'object' && value !== null && typeof (value as { n?: unknown }).n === 'number'
      ? { success: true, data: value as { n: number } }
      : { success: false },
};

async function documents() {
  const database = await openLocalDatabase(nodeSqliteDriver());
  let time = 1_000;
  let active: SyncScopeRef | null = SCOPE;
  const cache = createReadCache(database, { now: () => time, activeScope: () => active });
  return {
    database,
    cache,
    actAs: (next: SyncScopeRef | null) => {
      active = next;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('documents kept with their contract (ADR 0075)', () => {
  it('replace the document whole, per membership, with when it was read', async () => {
    const { cache, advance, actAs } = await documents();
    await cache.put(SCOPE, 'k', { n: 1 });
    advance(500);
    await cache.put(SCOPE, 'k', { n: 2 });
    actAs(OTHER_CLUB);
    await cache.put(OTHER_CLUB, 'k', { n: 3 });
    expect(await cache.get(SCOPE.membershipId, 'k', numberBox)).toEqual({
      value: { n: 2 },
      fetchedAt: 1_500,
    });
    expect((await cache.get(OTHER_CLUB.membershipId, 'k', numberBox))?.value).toEqual({ n: 3 });
    await cache.remove(SCOPE.membershipId, 'k');
    expect(await cache.get(SCOPE.membershipId, 'k', numberBox)).toBeNull();
  });

  it('are a miss when they no longer match their contract', async () => {
    const { cache } = await documents();
    await cache.put(SCOPE, 'old', { n: 'one' });
    expect(await cache.get(SCOPE.membershipId, 'old', numberBox)).toBeNull();
  });

  it('list by prefix, where `_` is not a wildcard', async () => {
    const { cache } = await documents();
    await cache.put(SCOPE, 'test_day:1', { n: 1 });
    await cache.put(SCOPE, 'testXday:2', { n: 2 });
    await cache.put(SCOPE, 'test_day:bad', { n: 'x' });
    expect([...(await cache.list(SCOPE.membershipId, 'test_day:', numberBox)).keys()]).toEqual([
      'test_day:1',
    ]);
  });

  it('go with their membership', async () => {
    const { cache, database } = await documents();
    await cache.put(SCOPE, 'k', { n: 1 });
    await database.write((db) => db.delete(syncScope));
    expect(await cache.get(SCOPE.membershipId, 'k', numberBox)).toBeNull();
  });

  it('write nothing once the session no longer acts in their membership', async () => {
    const { cache, database, actAs } = await documents();
    // A download still running when the user signs out (or changes club).
    actAs(null);
    await cache.put(SCOPE, 'k', { n: 1 });
    actAs(OTHER_CLUB);
    await cache.put(SCOPE, 'k', { n: 2 });
    expect(await cache.get(SCOPE.membershipId, 'k', numberBox)).toBeNull();
    expect(await database.read((db) => db.select().from(syncScope))).toEqual([]);
  });
});
