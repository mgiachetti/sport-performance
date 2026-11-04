import { createApiClient, type SyncChange, type TestResult } from '@sport-performance/contracts';
import { addDays, type LocalDate } from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { createReadCache } from '../offline/read-cache.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { T0, createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import { must } from '../test/must.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  ANA_ID,
  CATEGORY_ID,
  SESSION_ID,
  SPRINT,
  WINDOW_ID,
  sheet as sheetFixture,
  sprintResult,
  testSession,
} from '../test/test-day-fixtures.ts';
import { createTestDayController } from './controller.ts';
import { planAttempt } from './model.ts';

const SCOPE = {
  membershipId: 'a1111111-1111-4111-8111-111111111111',
  userId: 'd1111111-1111-4111-8111-111111111111',
};
const TODAY = '2026-04-14' as LocalDate;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const api = createFakeApi();
  const server = createFakeSyncServer(api);
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const database = await openLocalDatabase(nodeSqliteDriver());
  let time = T0;
  const engine = createSyncEngine({
    database,
    api: client,
    randomUUID: uuid,
    now: () => time,
    random: () => 0.5,
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  await engine.setScope(SCOPE);
  cleanups.push(() => {
    engine.dispose();
  });
  const controller = createTestDayController({
    sync: engine,
    // The session acts in the scope the engine syncs (`services.ts`).
    cache: createReadCache(database, { activeScope: () => SCOPE, now: () => time }),
    api: client,
    scope: SCOPE,
    role: 'sc',
    randomUUID: uuid,
    now: () => time,
  });
  const sheet = sheetFixture();
  api.on(`GET /v1/test-sessions/${SESSION_ID}/sheet`, { status: 200, body: sheet });
  api.on('GET /v1/club', {
    status: 200,
    body: {
      id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      slug: 'orc',
      name: 'Olivos Rugby Club',
      shortName: 'ORC',
      timeZone: 'America/Argentina/Buenos_Aires',
      locale: 'es-AR',
      colors: { primary: '#f1882a', secondary: '#050505', accent: '#f1882a' },
      logoFileId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: '1',
    },
  });
  return {
    api,
    server,
    engine,
    controller,
    sheet,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const sessionChange = (data: ReturnType<typeof testSession>): SyncChange => ({
  collection: 'test_session',
  op: 'upsert',
  id: data.id,
  clientUuid: null,
  data,
});
const resultChange = (data: TestResult, clientUuid: string | null): SyncChange =>
  ({ collection: 'test_result', op: 'upsert', id: data.id, clientUuid, data }) as SyncChange;

describe('the sheet of a day on the phone', () => {
  it('is kept for offline use, under the membership, and wiped on sign-out', async () => {
    const { api, controller, engine } = await setup();
    expect(await controller.sheet(SESSION_ID)).toBeNull();
    await controller.refreshSheet(SESSION_ID);
    api.setOffline(true);
    await expect(controller.refreshSheet(SESSION_ID)).rejects.toThrow();
    const saved = await controller.sheet(SESSION_ID);
    expect(saved?.value.stations.map((s) => s.testCode)).toEqual(['sprint_40', 'cmj', 'cod_505']);
    expect(saved?.fetchedAt).toBe(T0);
    expect([...(await controller.savedSheets()).keys()]).toEqual([SESSION_ID]);
    await engine.wipe();
    expect(await controller.sheet(SESSION_ID)).toBeNull();
  });

  it('takes the synced day when it is newer (a day suspended after the download)', async () => {
    const { server, engine, controller } = await setup();
    await controller.refreshSheet(SESSION_ID);
    server.publish(
      sessionChange(testSession({ status: 'cancelled', version: '1793586338688999' })),
    );
    await engine.syncNow();
    expect((await controller.sheet(SESSION_ID))?.value.testSession.status).toBe('cancelled');
  });

  it('downloads the sheets of the coming week on its own, once while they are fresh', async () => {
    const { api, server, engine, controller, advance } = await setup();
    const later = testSession({
      id: 'c2222222-2222-4222-8222-222222222222' as never,
      scheduledOn: addDays(TODAY, 20),
    });
    const past = testSession({
      id: 'c3333333-3333-4333-8333-333333333333' as never,
      scheduledOn: addDays(TODAY, -3),
    });
    server.publish(sessionChange(testSession()), sessionChange(later), sessionChange(past));
    await engine.syncNow();
    const days = await controller.days(TODAY);
    expect(days.map((d) => d.id).sort()).toEqual([SESSION_ID, later.id, past.id].sort());
    expect(await controller.prefetch(days, TODAY)).toBe(1);
    expect(await controller.prefetch(days, TODAY)).toBe(0);
    advance(16 * 60_000);
    expect(await controller.prefetch(days, TODAY)).toBe(1);
    expect(api.requests.filter((r) => r.path.endsWith('/sheet'))).toHaveLength(2);
  });

  it('keeps the club context for the time zone and the category names', async () => {
    const { api, controller } = await setup();
    api.on('GET /v1/categories', {
      status: 200,
      body: {
        items: [
          {
            id: CATEGORY_ID,
            sport: 'rugby',
            sex: 'male',
            ageBandCode: 'm15',
            name: 'M15',
            defaultStage: 'development',
            sortOrder: 1,
            archivedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            version: '1793586338688123',
          },
        ],
        nextCursor: null,
      },
    });
    api.on('GET /v1/seasons', {
      status: 200,
      body: {
        items: [
          {
            id: '0192e7a0-5555-7000-8000-000000000001',
            sport: 'rugby',
            name: '2026',
            startsOn: '2026-02-01',
            endsOn: '2026-11-30',
            testWindows: [
              {
                id: WINDOW_ID,
                seasonId: '0192e7a0-5555-7000-8000-000000000001',
                number: 2,
                label: 'V2',
                startsOn: '2026-04-01',
                endsOn: '2026-04-30',
                archivedAt: null,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                version: '1793586338688123',
              },
            ],
            archivedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            version: '1793586338688123',
          },
        ],
        nextCursor: null,
      },
    });
    await controller.refreshClubContext();
    api.setOffline(true);
    expect(await controller.clubContext()).toEqual({
      timeZone: 'America/Argentina/Buenos_Aires',
      categories: [{ id: CATEGORY_ID, name: 'M15' }],
      testWindows: [{ id: WINDOW_ID, label: 'V2' }],
    });
  });
});

describe('loading a day without signal', () => {
  it('queues the attempts, shows them at once and settles when the server serves them back', async () => {
    const { api, server, engine, controller, sheet } = await setup();
    await controller.refreshSheet(SESSION_ID);
    api.setOffline(true);
    const read = must(await controller.sheet(SESSION_ID)).value;
    let view = await controller.station(read, SPRINT, await controller.results(read));
    const ana = must(view.rows.find((r) => r.player.id === ANA_ID));
    const first = planAttempt(controller.writeContext(read, SPRINT, view.settings), ana, {
      split20S: '3,1',
      split40S: '5,5',
    });
    if (first.kind !== 'writes') throw new Error('writes expected');
    await controller.submit(first.writes);
    view = await controller.station(read, SPRINT, await controller.results(read));
    const queued = must(view.rows.find((r) => r.player.id === ANA_ID));
    expect(queued.sync).toBe('queued');
    const second = planAttempt(controller.writeContext(read, SPRINT, view.settings), queued, {
      split20S: '3,0',
      split40S: '5,3',
    });
    if (second.kind !== 'writes') throw new Error('writes expected');
    await controller.submit(second.writes);
    expect(engine.getStatus().pendingCount).toBe(2);
    expect(controller.progress(read, await controller.results(read)).get('sprint_40')).toEqual({
      recorded: 1,
      total: 3,
    });

    // Signal again: the queue goes out in order, then the pull brings the result back.
    api.setOffline(false);
    await engine.syncNow();
    expect(server.pushes.flat().map((m) => m.op)).toEqual([
      'test_session.record_results',
      'test_result.add_entries',
    ]);
    const create = first.writes[0];
    const add = second.writes[0];
    if (create?.op !== 'test_session.record_results' || add?.op !== 'test_result.add_entries') {
      throw new Error('unexpected writes');
    }
    const input = create.input.body.results[0];
    if (input?.status !== 'done') throw new Error('done expected');
    const template = must(sprintResult(ANA_ID).entries[0]);
    const served = sprintResult(ANA_ID, {
      entries: [...input.entries, ...add.input.body.entries].map((entry, index) => ({
        ...template,
        id: entry.clientUuid as never,
        attemptNumber: index + 1,
      })),
    });
    server.publish(resultChange(served, input.clientUuid ?? null));
    await engine.syncNow();
    expect(engine.getStatus().pendingCount).toBe(0);
    const results = await controller.results(sheet);
    expect(results).toHaveLength(1);
    view = await controller.station(read, SPRINT, results);
    const saved = must(view.rows.find((r) => r.player.id === ANA_ID));
    expect(saved.sync).toBe('saved');
    expect(saved.attempts).toHaveLength(2);
  });

  it('remembers the settings of a station on this phone', async () => {
    const { controller, sheet } = await setup();
    await controller.refreshSheet(SESSION_ID);
    const view = await controller.station(sheet, SPRINT, []);
    expect(view.settings.method).toBe('photocell');
    await controller.saveSettings(sheet, SPRINT, { ...view.settings, method: 'manual' });
    expect((await controller.station(sheet, SPRINT, [])).settings.method).toBe('manual');
    expect(controller.writeContext(sheet, SPRINT, view.settings).evaluatorId).toBe(SCOPE.userId);
  });
});
