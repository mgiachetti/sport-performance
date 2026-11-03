import { createApiClient } from '@sport-performance/contracts';
import { compareHlc, formatHlc, serverHlc } from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { apiError, createFakeApi, validationFailed } from '../test/fake-api.ts';
import {
  PLAYER_ID,
  SESSION_ID,
  T0,
  createFakeSyncServer,
  participationDto,
  tombstone,
  upsert,
  uuid,
  wellnessDto,
} from '../test/fake-sync-server.ts';
import { nodeSqliteDriver, temporaryDatabaseFile } from '../test/node-sqlite.ts';
import type { SessionState } from '../state/session-controller.ts';
import { COACH_AT_ORC, USER } from '../test/fixtures.ts';
import { runBackgroundSync } from './background.ts';
import { openLocalDatabase } from './db/database.ts';
import { deviceMeta } from './db/schema.ts';
import { ACKED_OVERLAY_MAX_MS, createSyncEngine, type SyncEngineOptions } from './engine.ts';
import { InvalidMutationError, MissingClientUuidError } from './operations.ts';

const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const OTHER_SCOPE = { membershipId: 'a2222222-2222-4222-8222-222222222222', userId: 'u1' };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup(
  options: { path?: string; engine?: Partial<SyncEngineOptions>; scope?: typeof SCOPE | null } = {},
) {
  const api = createFakeApi();
  const server = createFakeSyncServer(api);
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const driver = nodeSqliteDriver(options.path);
  const database = await openLocalDatabase(driver);
  let time = T0;
  const timers: { task: () => void; ms: number }[] = [];
  const errors: unknown[] = [];
  const engine = createSyncEngine({
    database,
    api: client,
    randomUUID: uuid,
    now: () => time,
    random: () => 0.5,
    setTimer: (task, ms) => {
      timers.push({ task, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
    reportError: (error) => errors.push(error),
    ...options.engine,
  });
  if (options.scope !== null) await engine.setScope(options.scope ?? SCOPE);
  cleanups.push(() => {
    engine.dispose();
  });
  return {
    api,
    server,
    engine,
    database,
    driver,
    timers,
    errors,
    advance: (ms: number) => {
      time += ms;
    },
    now: () => time,
  };
}

const submitWellness = (clientUuid = uuid(), sleep = 4) =>
  ({
    body: { clientUuid, scores: { sleep, fatigue: 4, soreness: 4, stress: 4, mood: 4 } },
  }) as const;

describe('queue', () => {
  it('validates with the shared contract and requires the clientUuid of a create', async () => {
    const { engine } = await setup();
    await expect(
      engine.enqueue('wellness.submit', { body: { clientUuid: uuid(), scores: { sleep: 9 } } }),
    ).rejects.toBeInstanceOf(InvalidMutationError);
    await expect(
      engine.enqueue('wellness.submit', { body: { scores: { sleep: 3 } } }),
    ).rejects.toBeInstanceOf(MissingClientUuidError);
    expect(engine.getStatus().pendingCount).toBe(0);
  });

  it('stores each write with a strictly increasing HLC, also when the phone time goes back', async () => {
    const { engine, advance } = await setup();
    const first = await engine.enqueue('wellness.submit', submitWellness());
    advance(-60_000);
    const second = await engine.enqueue('wellness.submit', submitWellness());
    expect(compareHlc(second.hlc, first.hlc)).toBe(1);
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(engine.getStatus().pendingCount).toBe(2);
  });

  it('keeps the queue and the clock across an app kill', async () => {
    const file = temporaryDatabaseFile();
    cleanups.push(file.remove);
    const first = await setup({ path: file.path });
    const queued = await first.engine.enqueue('wellness.submit', submitWellness());
    await first.database.close();

    const second = await setup({ path: file.path });
    expect(second.engine.getStatus().pendingCount).toBe(1);
    const again = await second.engine.enqueue('wellness.submit', submitWellness());
    expect(compareHlc(again.hlc, queued.hlc)).toBe(1);
    expect(again.hlc.split('-')[2]).toBe(queued.hlc.split('-')[2]);
    await second.engine.syncNow();
    expect(second.server.pushes[0]?.map((m) => m.mutationId)).toEqual([
      queued.mutationId,
      again.mutationId,
    ]);
  });

  it('asks for a sync shortly after a write', async () => {
    const { engine, timers } = await setup();
    timers.length = 0;
    await engine.enqueue('wellness.submit', submitWellness());
    expect(timers.at(-1)?.ms).toBe(1_000);
  });
});

describe('push', () => {
  it('pushes the queue in order, in batches, with the membership header', async () => {
    const { engine, server, api } = await setup({ engine: { pushBatchSize: 2 } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push((await engine.enqueue('wellness.submit', submitWellness())).mutationId);
    }
    const outcome = await engine.syncNow();
    expect(outcome).toEqual({ status: 'synced', pushed: 5, pulled: 0 });
    expect(server.pushes.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(server.pushes.flat().map((m) => m.mutationId)).toEqual(ids);
    expect(api.last('POST /v1/sync/push')?.headers['x-membership-id']).toBe(SCOPE.membershipId);
    expect(engine.getStatus()).toMatchObject({ phase: 'idle', pendingCount: 0 });
    expect(engine.getStatus().lastSyncedAt).not.toBeNull();
  });

  it('keeps an applied create laid over until the pull brings its row', async () => {
    const { engine, server } = await setup();
    const clientUuid = uuid();
    await engine.enqueue('wellness.submit', submitWellness(clientUuid));
    await engine.syncNow();
    let queue = await engine.store.pending(SCOPE.membershipId);
    expect(queue.map((m) => m.state)).toEqual(['acked']);
    expect(engine.getStatus().pendingCount).toBe(0);

    server.publish(upsert('wellness', wellnessDto(), clientUuid));
    await engine.syncNow();
    queue = await engine.store.pending(SCOPE.membershipId);
    expect(queue).toEqual([]);
    const rows = await engine.store.list(SCOPE.membershipId, 'wellness');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientUuid, pending: false });
  });

  it('surfaces a rejected mutation with its reason and takes it out of the queue', async () => {
    const { engine, server } = await setup();
    const queued = await engine.enqueue('wellness.submit', submitWellness());
    server.decide(() => ({
      status: 'rejected',
      hlc: null,
      error: {
        code: 'conflict',
        message: 'exists',
        details: [{ path: ['body', 'mutations', 0, 'body', 'localDate'], code: 'x', message: 'x' }],
      },
    }));
    await engine.syncNow();
    expect(await engine.store.pending(SCOPE.membershipId)).toEqual([]);
    const issues = await engine.issues();
    expect(issues).toEqual([
      expect.objectContaining({
        mutationId: queued.mutationId,
        op: 'wellness.submit',
        kind: 'rejected',
        errorCode: 'conflict',
        errorPaths: ['body.localDate'],
        input: queued.input,
      }),
    ]);
    expect(engine.getStatus().issueCount).toBe(1);
    await engine.dismissIssue(issues[0]?.id ?? 0);
    expect(engine.getStatus().issueCount).toBe(0);
  });

  it('drops a superseded edit and tells which fields lost', async () => {
    const { engine, server } = await setup();
    const row = wellnessDto();
    server.publish(upsert('wellness', row));
    await engine.syncNow();
    await engine.enqueue('wellness.correct', {
      target: { id: row.id },
      body: { scores: { sleep: 1 } },
    });
    server.decide(() => ({ status: 'superseded', supersededFields: ['sleep'] }));
    await engine.syncNow();
    expect(await engine.store.pending(SCOPE.membershipId)).toEqual([]);
    expect(await engine.issues()).toEqual([
      expect.objectContaining({ kind: 'superseded', fields: ['sleep'] }),
    ]);
  });

  it('keeps everything and backs off without signal; the resend is safe after a lost answer', async () => {
    const { engine, server, timers, now } = await setup();
    const queued = await engine.enqueue('wellness.submit', submitWellness());
    server.failPush('network-error');
    timers.length = 0;
    expect(await engine.syncNow()).toEqual({ status: 'failed', phase: 'offline' });
    const status = engine.getStatus();
    expect(status).toMatchObject({ phase: 'offline', pendingCount: 1 });
    expect(status.nextAttemptAt).toBe(now() + 1_500);
    expect(timers.at(-1)?.ms).toBe(1_500);
    const [stored] = await engine.store.pending(SCOPE.membershipId);
    expect(stored?.attempts).toBe(1);

    // A plain request waits for the backoff; the timer runs the retry.
    engine.requestSync();
    expect(timers).toHaveLength(1);
    timers[0]?.task();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await engine.syncNow();
    expect(server.pushes.map((batch) => batch.map((m) => m.mutationId))).toEqual([
      [queued.mutationId],
      [queued.mutationId],
    ]);
    expect(engine.getStatus()).toMatchObject({
      phase: 'idle',
      pendingCount: 0,
      nextAttemptAt: null,
    });
  });

  it('grows the wait with each failure and honors Retry-After', async () => {
    const { engine, server } = await setup();
    await engine.enqueue('wellness.submit', submitWellness());
    server.failPush(
      apiError(500, 'internal'),
      apiError(500, 'internal'),
      apiError(503, 'service_unavailable', { 'retry-after': '30' }),
    );
    const waits: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      await engine.syncNow();
      const status = engine.getStatus();
      expect(status.phase).toBe('failing');
      waits.push((status.nextAttemptAt ?? 0) - T0);
    }
    expect(waits).toEqual([1_500, 3_000, 30_000]);
    expect(engine.getStatus().pendingCount).toBe(1);
  });

  it('pauses on 401, 403 and 426 until something forces it', async () => {
    const { engine, server, timers } = await setup();
    await engine.enqueue('wellness.submit', submitWellness());
    for (const [status, code, pause] of [
      [401, 'unauthenticated', 'session'],
      [403, 'forbidden', 'forbidden'],
      [426, 'app_update_required', 'update'],
    ] as const) {
      server.failPush(apiError(status, code));
      timers.length = 0;
      await engine.syncNow();
      expect(engine.getStatus()).toMatchObject({ phase: 'paused', pause, nextAttemptAt: null });
      expect(timers).toEqual([]);
      engine.requestSync();
      expect(timers).toEqual([]);
      expect(await engine.syncNow()).toEqual({ status: 'skipped', reason: 'paused' });
      engine.requestSync({ force: true });
      expect(engine.getStatus().pause).toBeNull();
    }
    await engine.syncNow();
    expect(engine.getStatus().pendingCount).toBe(0);
  });

  it('pushes one by one when the server refuses a whole push, rejecting only the culprit', async () => {
    const { engine, server } = await setup();
    const good = await engine.enqueue('wellness.submit', submitWellness());
    const bad = await engine.enqueue('wellness.submit', submitWellness());
    const after = await engine.enqueue('wellness.submit', submitWellness());
    server.refuseWhole((m) => m.mutationId === bad.mutationId);
    expect(await engine.syncNow()).toMatchObject({ status: 'synced' });
    expect(server.pushes.map((batch) => batch.map((m) => m.mutationId))).toEqual([
      [good.mutationId, bad.mutationId, after.mutationId],
      [good.mutationId],
      [bad.mutationId],
      [after.mutationId],
    ]);
    expect(await engine.issues()).toEqual([
      expect.objectContaining({ mutationId: bad.mutationId, errorCode: 'validation_failed' }),
    ]);
    expect(engine.getStatus().pendingCount).toBe(0);
  });

  it.each([
    ['a route the deploy lost', apiError(404, 'not_found')],
    ['a method the proxy refuses', apiError(405, 'bad_request')],
    ['headers a proxy refuses', apiError(431, 'bad_request')],
    ['a gone route', apiError(410, 'bad_request')],
    ['a 400 that is not about the mutations', apiError(400, 'bad_request')],
    ['a proxy page without the envelope', { status: 404, body: '<html>Not Found</html>' }],
  ])('keeps the whole queue and backs off on %s instead of rejecting it', async (_, failure) => {
    const { engine, server, errors } = await setup();
    const queued = [];
    for (let i = 0; i < 3; i += 1) {
      queued.push(await engine.enqueue('wellness.submit', submitWellness()));
    }
    server.failPush(failure, failure, failure, failure);
    expect(await engine.syncNow()).toEqual({ status: 'failed', phase: 'failing' });
    // One request: the batch is not split, nobody is singled out.
    expect(server.pushes).toHaveLength(1);
    expect(await engine.issues()).toEqual([]);
    const pending = await engine.store.pending(SCOPE.membershipId);
    expect(pending.map((m) => [m.mutationId, m.state, m.attempts])).toEqual(
      queued.map((m) => [m.mutationId, 'pending', 1]),
    );
    expect(engine.getStatus()).toMatchObject({ phase: 'failing', pendingCount: 3, issueCount: 0 });
    expect(engine.getStatus().nextAttemptAt).not.toBeNull();
    // A deployment problem to look at: reported.
    expect(errors).toHaveLength(1);
  });

  it.each([
    ['malformed client headers', validationFailed(['headers', 'x-client-version'])],
    [
      'issues on the headers and the body',
      validationFailed(['headers', 'x-client-platform'], ['body', 'mutations', 0]),
    ],
    ['a validation refusal that says where nothing is', apiError(400, 'validation_failed')],
  ])('keeps the whole queue on a 400 validation_failed for %s', async (_, failure) => {
    const { engine, server, errors } = await setup();
    const queued = [];
    for (let i = 0; i < 3; i += 1) {
      queued.push(await engine.enqueue('wellness.submit', submitWellness()));
    }
    // Every push gets it, as when the client headers drift: no mutation is to blame.
    server.failPush(failure, failure, failure, failure);
    expect(await engine.syncNow()).toEqual({ status: 'failed', phase: 'failing' });
    expect(server.pushes).toHaveLength(1);
    expect(await engine.issues()).toEqual([]);
    const pending = await engine.store.pending(SCOPE.membershipId);
    expect(pending.map((m) => [m.mutationId, m.state, m.attempts])).toEqual(
      queued.map((m) => [m.mutationId, 'pending', 1]),
    );
    expect(engine.getStatus()).toMatchObject({ phase: 'failing', pendingCount: 3, issueCount: 0 });
    expect(engine.getStatus().nextAttemptAt).not.toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('rejects only the culprit of a 400 validation_failed located in the body', async () => {
    const { engine, server, errors } = await setup();
    const good = await engine.enqueue('wellness.submit', submitWellness());
    const bad = await engine.enqueue('wellness.submit', submitWellness());
    const after = await engine.enqueue('wellness.submit', submitWellness());
    // The whole push and the culprit alone: `400` with the issue at `['body', 'mutations', i, ...]`.
    server.refuseWhole((m) => m.mutationId === bad.mutationId);
    expect(await engine.syncNow()).toMatchObject({ status: 'synced' });
    expect(server.pushes.map((batch) => batch.map((m) => m.mutationId))).toEqual([
      [good.mutationId, bad.mutationId, after.mutationId],
      [good.mutationId],
      [bad.mutationId],
      [after.mutationId],
    ]);
    expect(await engine.issues()).toEqual([
      expect.objectContaining({ mutationId: bad.mutationId, errorCode: 'validation_failed' }),
    ]);
    expect(engine.getStatus().pendingCount).toBe(0);
    expect(errors).toEqual([]);
  });

  it('keeps the rest of the queue when the one-by-one resend meets a misconfigured server', async () => {
    const { engine, server, errors } = await setup();
    const bad = await engine.enqueue('wellness.submit', submitWellness());
    const next = await engine.enqueue('wellness.submit', submitWellness());
    const last = await engine.enqueue('wellness.submit', submitWellness());
    server.refuseWhole((m) => m.mutationId === bad.mutationId);
    // The batch and the culprit alone get the validation refusal; then the route vanishes.
    server.failPush(
      validationFailed(['body', 'mutations', 0, 'body']),
      validationFailed(['body', 'mutations', 0, 'body']),
      apiError(404, 'not_found'),
    );
    expect(await engine.syncNow()).toEqual({ status: 'failed', phase: 'failing' });
    expect(await engine.issues()).toEqual([
      expect.objectContaining({ mutationId: bad.mutationId, errorCode: 'validation_failed' }),
    ]);
    expect((await engine.store.pending(SCOPE.membershipId)).map((m) => m.mutationId)).toEqual([
      next.mutationId,
      last.mutationId,
    ]);
    expect(errors).toHaveLength(1);

    // The server is back: the rest goes out.
    server.refuseWhole(() => false);
    expect(await engine.syncNow()).toEqual({ status: 'synced', pushed: 2, pulled: 0 });
    expect(engine.getStatus()).toMatchObject({ pendingCount: 0, issueCount: 1 });
  });

  it('rejects alone a mutation whose body is too big or that conflicts as a whole push', async () => {
    const { engine, server } = await setup();
    const big = await engine.enqueue('wellness.submit', submitWellness());
    const fine = await engine.enqueue('wellness.submit', submitWellness());
    server.failPush(apiError(413, 'payload_too_large'), apiError(413, 'payload_too_large'));
    expect(await engine.syncNow()).toMatchObject({ status: 'synced' });
    expect(server.pushes.map((batch) => batch.map((m) => m.mutationId))).toEqual([
      [big.mutationId, fine.mutationId],
      [big.mutationId],
      [fine.mutationId],
    ]);
    expect(await engine.issues()).toEqual([
      expect.objectContaining({ mutationId: big.mutationId, errorCode: 'payload_too_large' }),
    ]);
  });

  it('never runs a cycle before an active Retry-After, whoever asks', async () => {
    const { engine, server, advance, timers } = await setup();
    await engine.enqueue('wellness.submit', submitWellness());
    server.failPush(apiError(503, 'service_unavailable', { 'retry-after': '30' }));
    await engine.syncNow();
    expect(timers.at(-1)?.ms).toBe(30_000);
    advance(29_999);
    expect(await engine.syncNow()).toEqual({ status: 'skipped', reason: 'retry_after' });
    expect(server.pushes).toHaveLength(1);
    advance(1);
    expect(await engine.syncNow()).toMatchObject({ status: 'synced', pushed: 1 });
  });

  it('runs a single cycle at a time and once more for writes made meanwhile', async () => {
    const { engine, server } = await setup();
    await engine.enqueue('wellness.submit', submitWellness());
    const first = engine.syncNow();
    const second = engine.syncNow();
    await engine.enqueue('wellness.submit', submitWellness());
    await Promise.all([first, second]);
    expect(server.pushes.flat()).toHaveLength(2);
    expect(engine.getStatus().pendingCount).toBe(0);
  });

  it('moves the clock past the server clock', async () => {
    const { engine, server } = await setup();
    const ahead = T0 + 3_600_000;
    server.setServerTime(ahead);
    await engine.enqueue('wellness.submit', submitWellness());
    await engine.syncNow();
    const next = await engine.enqueue('wellness.submit', submitWellness());
    expect(compareHlc(next.hlc, formatHlc(serverHlc(ahead)))).toBe(1);
  });
});

describe('pull', () => {
  it('pages to the end and commits each page with its cursor', async () => {
    const { engine, server } = await setup({ engine: { pullLimit: 2 } });
    server.publish(...Array.from({ length: 5 }, () => upsert('wellness', wellnessDto())));
    expect(await engine.syncNow()).toEqual({ status: 'synced', pushed: 0, pulled: 5 });
    expect(server.pulls.map((p) => p.cursor)).toEqual([null, 'c:2', 'c:4']);
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(5);

    server.publish(upsert('wellness', wellnessDto()));
    await engine.syncNow();
    expect(server.pulls.at(-1)?.cursor).toBe('c:5');
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(6);
  });

  it('resumes from the last committed page when the app dies mid-pull', async () => {
    const file = temporaryDatabaseFile();
    cleanups.push(file.remove);
    const first = await setup({ path: file.path, engine: { pullLimit: 2 } });
    first.server.publish(...Array.from({ length: 5 }, () => upsert('wellness', wellnessDto())));
    let pages = 0;
    first.driver.failWhen((sql) => {
      if (sql === 'BEGIN IMMEDIATE') pages += 1;
      // Write #1 is ensureScope; #2 is page one; #3 is page two.
      return sql === 'BEGIN IMMEDIATE' && pages === 3;
    });
    await first.engine.syncNow();
    first.driver.failWhen(() => false);
    await first.database.close();

    const second = await setup({ path: file.path, engine: { pullLimit: 2 } });
    second.server.publish(...first.server.log);
    await second.engine.syncNow();
    expect(second.server.pulls[0]?.cursor).toBe('c:2');
    expect(await second.engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(5);
  });

  it('deletes a tombstoned row and clears the collections on a reset', async () => {
    const { engine, server } = await setup();
    const kept = wellnessDto();
    const gone = wellnessDto();
    server.publish(upsert('wellness', kept), upsert('wellness', gone));
    await engine.syncNow();
    server.publish(tombstone('wellness', gone.id), tombstone('wellness', uuid()));
    await engine.syncNow();
    expect((await engine.store.list(SCOPE.membershipId, 'wellness')).map((r) => r.id)).toEqual([
      kept.id,
    ]);

    // What the user sees changed: the server starts over and the device forgets the rest.
    server.log.splice(
      0,
      server.log.length,
      upsert('wellness', wellnessDto({ localDate: '2026-11-04' })),
    );
    server.resetNext();
    await engine.syncNow();
    const rows = await engine.store.list(SCOPE.membershipId, 'wellness');
    expect(rows.map((r) => r.data.localDate)).toEqual(['2026-11-04']);
  });

  it('starts over when the server no longer reads the cursor', async () => {
    const { engine, server, database } = await setup();
    server.publish(upsert('wellness', wellnessDto()));
    await engine.syncNow();
    await database.write(async (db) => {
      const { syncScope } = await import('./db/schema.ts');
      await db.update(syncScope).set({ cursor: 'broken' });
    });
    await engine.syncNow();
    expect(server.pulls.slice(-2).map((p) => p.cursor)).toEqual(['broken', null]);
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(1);
  });

  it('is not a sync when the pull stops at the page limit before the end', async () => {
    const { engine, server, advance, errors } = await setup({
      engine: { pullLimit: 1, maxPullPages: 2 },
    });
    await engine.enqueue('wellness.submit', submitWellness());
    expect(await engine.syncNow()).toEqual({ status: 'synced', pushed: 1, pulled: 0 });
    const syncedAt = engine.getStatus().lastSyncedAt;
    advance(ACKED_OVERLAY_MAX_MS);
    server.publish(...Array.from({ length: 3 }, () => upsert('wellness', wellnessDto())));
    expect(await engine.syncNow()).toEqual({ status: 'failed', phase: 'failing' });
    expect(errors).toHaveLength(1);
    expect(engine.getStatus()).toMatchObject({ phase: 'failing', lastSyncedAt: syncedAt });
    // The acked create stays laid over: the pull that could bring its row did not end.
    expect(await engine.store.pending(SCOPE.membershipId)).toHaveLength(1);
    // The pages applied stay; the next cycle goes on from their cursor and ends.
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(2);
    advance(60_000);
    expect(await engine.syncNow()).toEqual({ status: 'synced', pushed: 0, pulled: 1 });
    expect(server.pulls.at(-1)?.cursor).toBe('c:2');
    expect(engine.getStatus().lastSyncedAt).toBeGreaterThan(syncedAt ?? 0);
    expect(await engine.store.pending(SCOPE.membershipId)).toEqual([]);
  });

  it('drops an applied mutation a while after a full pull that never brought its row', async () => {
    const { engine, advance } = await setup();
    await engine.enqueue('wellness.submit', submitWellness());
    await engine.syncNow();
    expect(await engine.store.pending(SCOPE.membershipId)).toHaveLength(1);
    advance(ACKED_OVERLAY_MAX_MS - 1);
    await engine.syncNow();
    expect(await engine.store.pending(SCOPE.membershipId)).toHaveLength(1);
    advance(1);
    await engine.syncNow();
    expect(await engine.store.pending(SCOPE.membershipId)).toEqual([]);
  });
});

describe('issues', () => {
  it('tells the screens the list changed also when the count stays the same', async () => {
    const { engine, server } = await setup();
    server.decide(() => ({
      status: 'rejected',
      hlc: null,
      error: { code: 'conflict', message: 'exists', details: [] },
    }));
    await engine.enqueue('wellness.submit', submitWellness());
    await engine.syncNow();
    const [first] = await engine.issues();
    const before = engine.getStatus().issuesVersion;
    await engine.dismissIssue(first?.id ?? 0);
    await engine.enqueue('wellness.submit', submitWellness());
    await engine.syncNow();
    expect(engine.getStatus().issueCount).toBe(1);
    expect(engine.getStatus().issuesVersion).not.toBe(before);
    const [second] = await engine.issues();
    expect(second?.id).not.toBe(first?.id);
  });
});

describe('background', () => {
  it('does not sync from the background task before an active Retry-After', async () => {
    const { engine, server } = await setup({
      scope: { membershipId: COACH_AT_ORC.id, userId: USER.id },
    });
    await engine.enqueue('wellness.submit', submitWellness());
    server.failPush(apiError(429, 'rate_limited', { 'retry-after': '120' }));
    await engine.syncNow();
    const session = {
      getState: (): SessionState => ({
        status: 'signedIn',
        user: USER,
        email: USER.email,
        memberships: [COACH_AT_ORC],
        activeMembership: COACH_AT_ORC,
        clubNotice: null,
        offline: false,
      }),
      subscribe: () => () => undefined,
    };
    expect(await runBackgroundSync({ session, sync: engine }, 1_000)).toBe(false);
    expect(server.pushes).toHaveLength(1);
    expect(engine.getStatus().pendingCount).toBe(1);
  });
});

describe('local view', () => {
  it('lays queued edits over the served row until the server answers', async () => {
    const { engine, server } = await setup();
    const row = wellnessDto();
    const participation = participationDto({ minutes: 60, rpe: 5, srpeAu: 300 });
    server.publish(upsert('wellness', row), upsert('participation', participation));
    await engine.syncNow();

    server.failPush('network-error');
    await engine.enqueue('wellness.correct', {
      target: { id: row.id },
      body: { scores: { sleep: 1, mood: 2 } },
    });
    await engine.enqueue('participation.update', {
      target: { id: participation.id },
      body: { status: 'absent' },
    });
    await engine.enqueue('rpe.submit', {
      params: { trainingSessionId: SESSION_ID },
      body: { clientUuid: uuid(), rpe: 7 },
    });
    await engine.syncNow();

    const [wellness] = await engine.store.list(SCOPE.membershipId, 'wellness', {
      playerId: PLAYER_ID,
    });
    expect(wellness).toMatchObject({ pending: true });
    expect(wellness?.data.scores).toMatchObject({ sleep: 1, mood: 2, fatigue: 4 });
    expect(wellness?.data.meanScore).toBeCloseTo(3);
    const [load] = await engine.store.list(SCOPE.membershipId, 'participation', {
      parentId: SESSION_ID,
    });
    // Absent clears the load, and a later RPE against absent shows nothing.
    expect(load?.data).toMatchObject({ status: 'absent', minutes: null, rpe: null, srpeAu: null });

    const other = await engine.store.get(SCOPE.membershipId, 'wellness', { id: uuid() });
    expect(other).toBeNull();
  });

  it('pushes each queue with its own membership when the club changes mid-cycle', async () => {
    const { engine, api } = await setup();
    await engine.enqueue('wellness.submit', submitWellness());
    const running = engine.syncNow();
    await engine.setScope(OTHER_SCOPE);
    await engine.enqueue('wellness.submit', submitWellness());
    await running;
    await engine.syncNow();
    const headers = api.requests
      .filter((r) => r.path === '/v1/sync/push')
      .map((r) => r.headers['x-membership-id']);
    expect(headers).toEqual([SCOPE.membershipId, OTHER_SCOPE.membershipId]);
    expect(engine.getStatus()).toMatchObject({
      membershipId: OTHER_SCOPE.membershipId,
      pendingCount: 0,
    });
  });

  it('never shows the data of another membership', async () => {
    const { engine, server } = await setup();
    server.publish(upsert('wellness', wellnessDto()));
    await engine.syncNow();
    await engine.setScope(OTHER_SCOPE);
    expect(await engine.store.list(OTHER_SCOPE.membershipId, 'wellness')).toEqual([]);
    expect(engine.getStatus()).toMatchObject({ membershipId: OTHER_SCOPE.membershipId });
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(1);
  });
});

describe('signing out and another user', () => {
  it('wipes every club row, queue and issue and keeps only the clock node', async () => {
    const { engine, server, database } = await setup();
    server.publish(upsert('wellness', wellnessDto()));
    const queued = await engine.enqueue('wellness.submit', submitWellness());
    await engine.syncNow();
    await engine.wipe();
    await engine.setScope(null);
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toEqual([]);
    expect(await engine.store.pending(SCOPE.membershipId)).toEqual([]);
    const meta = await database.read((db) => db.select().from(deviceMeta));
    expect(meta.map((row) => row.key).sort()).toEqual(['hlc.last', 'hlc.node']);
    expect(meta.find((row) => row.key === 'hlc.node')?.value).toBe(queued.hlc.split('-')[2]);
  });

  it('wipes the data of the previous user when another one signs in', async () => {
    const { engine, server } = await setup();
    server.publish(upsert('wellness', wellnessDto()));
    await engine.syncNow();
    await engine.setScope(null);
    await engine.setScope({ membershipId: 'a3333333-3333-4333-8333-333333333333', userId: 'u2' });
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toEqual([]);
  });

  it('cannot queue without a membership', async () => {
    const { engine } = await setup({ scope: null });
    await expect(engine.enqueue('wellness.submit', submitWellness())).rejects.toThrow(
      /No active membership/,
    );
    expect(await engine.syncNow()).toEqual({ status: 'skipped', reason: 'no_scope' });
  });
});
