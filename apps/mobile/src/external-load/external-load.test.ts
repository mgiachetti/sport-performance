import type { ExternalLoad, SyncChange } from '@sport-performance/contracts';
import { createApiClient } from '@sport-performance/contracts';
import { parseLocalDate, parseTimeZone } from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryPreferenceStorage } from '../platform/storage.ts';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { PLAYER_ID, T0, createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import { clubDay, createClubTimeZoneStore } from './club-day.ts';
import {
  queueExternalLoadArchive,
  queueExternalLoadCorrection,
  queueExternalLoadReport,
  readExternalLoadWeek,
} from './data.ts';
import {
  canReportExternalLoad,
  correctionRequest,
  draftLoadAu,
  draftOf,
  draftProblems,
  emptyDraft,
  externalLoadTotal,
  parseMinutes,
  reportRequest,
  reportableDays,
  type ExternalLoadDraft,
} from './model.ts';

const TODAY = parseLocalDate('2026-11-03');
const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };

const complete: ExternalLoadDraft = {
  activity: 'other_sport',
  detail: ' Fútbol ',
  day: parseLocalDate('2026-11-01'),
  minutesText: '60',
  rpe: 6,
};

function externalLoadDto(overrides: Partial<ExternalLoad> = {}): ExternalLoad {
  return {
    id: uuid() as ExternalLoad['id'],
    playerId: PLAYER_ID as ExternalLoad['playerId'],
    localDate: parseLocalDate('2026-11-02'),
    activity: 'physical_education',
    detail: null,
    minutes: 40,
    rpe: 4,
    srpeAu: 160,
    reportedBy: 'player',
    archivedAt: null,
    createdAt: '2026-11-02T15:00:00.000Z',
    updatedAt: '2026-11-02T15:00:00.000Z',
    version: 'v1',
    ...overrides,
  };
}

const upsert = (data: ExternalLoad, clientUuid: string | null = null): SyncChange =>
  ({ collection: 'external_load', op: 'upsert', id: data.id, clientUuid, data }) as SyncChange;

describe('external load: the form', () => {
  it('is for the player only, as the permission matrix says', () => {
    expect(canReportExternalLoad('player')).toBe(true);
    for (const role of ['parent', 'coach', 'sc', 'medical', 'admin', 'superadmin'] as const) {
      expect(canReportExternalLoad(role)).toBe(false);
    }
  });

  it('offers the 7 club days of the window, today first', () => {
    expect(reportableDays(TODAY)).toEqual([
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
      '2026-10-31',
      '2026-10-30',
      '2026-10-29',
      '2026-10-28',
    ]);
  });

  it('takes whole minutes in range only', () => {
    expect(parseMinutes(' 45 ')).toBe(45);
    expect(parseMinutes('600')).toBe(600);
    for (const text of ['', '0', '601', '45,5', '4.5', '-3', 'una hora']) {
      expect(parseMinutes(text), text).toBeNull();
    }
  });

  it('says what is missing before saving, and the load once complete', () => {
    expect(draftProblems(emptyDraft(TODAY), TODAY)).toEqual({
      activity: 'activity_missing',
      minutes: 'minutes_invalid',
      rpe: 'rpe_missing',
    });
    expect(draftProblems(complete, TODAY)).toEqual({});
    expect(draftProblems({ ...complete, day: parseLocalDate('2026-10-27') }, TODAY)).toEqual({
      day: 'day_outside',
    });
    expect(draftProblems({ ...complete, detail: 'x'.repeat(61) }, TODAY)).toEqual({
      detail: 'detail_too_long',
    });
    expect(draftLoadAu(complete)).toBe(360);
    expect(draftLoadAu({ ...complete, rpe: null })).toBeNull();
  });

  it('builds the create with its clientUuid and the day chosen', () => {
    expect(reportRequest(complete, 'c1')).toEqual({
      body: {
        clientUuid: 'c1',
        localDate: '2026-11-01',
        activity: 'other_sport',
        detail: 'Fútbol',
        minutes: 60,
        rpe: 6,
      },
    });
    expect(reportRequest({ ...complete, detail: '  ' }, 'c1').body).not.toHaveProperty('detail');
    expect(() => reportRequest(emptyDraft(TODAY), 'c1')).toThrow();
  });

  it('corrects only what changed, with the reason; nothing changed is no correction', () => {
    const item = {
      key: 'k',
      target: { id: 'r1' },
      localDate: parseLocalDate('2026-11-01'),
      activity: 'other_sport' as const,
      detail: 'Fútbol',
      minutes: 60,
      rpe: 6,
      srpeAu: 360,
      state: 'synced' as const,
    };
    expect(correctionRequest(item, draftOf(item), 'Nada')).toBeNull();
    expect(
      correctionRequest(item, { ...draftOf(item), minutesText: '75', detail: '' }, ' Fueron 75 '),
    ).toEqual({
      target: { id: 'r1' },
      body: { changeReason: 'Fueron 75', minutes: 75, detail: null },
    });
  });
});

describe('external load: the club day', () => {
  it('keeps the club zone on the phone and reads the day in it', async () => {
    const store = createClubTimeZoneStore(memoryPreferenceStorage());
    expect(await store.get('club-1')).toBeNull();
    await store.save('club-1', 'America/Argentina/Buenos_Aires');
    await store.save('club-2', 'Not/AZone');
    expect(await store.get('club-1')).toBe('America/Argentina/Buenos_Aires');
    expect(await store.get('club-2')).toBeNull();
    // 01:30 UTC on the 4th is still the 3rd in Buenos Aires.
    const instant = Date.UTC(2026, 10, 4, 1, 30);
    expect(clubDay(instant, parseTimeZone('America/Argentina/Buenos_Aires'))).toBe('2026-11-03');
    expect(clubDay(instant, parseTimeZone('Europe/Madrid'))).toBe('2026-11-04');
  });
});

describe('external load: through the local database and the queue', () => {
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
      now: () => T0,
      random: () => 0.5,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    await engine.setScope(SCOPE);
    cleanups.push(() => {
      engine.dispose();
    });
    const week = () => readExternalLoadWeek(engine.store, SCOPE.membershipId, TODAY);
    return { server, engine, week };
  }

  it('shows what was reported without signal, corrected and archived, before any sync', async () => {
    const { engine, week } = await setup();
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    let next = 0;
    const randomUUID = () => ids[next++] ?? uuid();
    await queueExternalLoadReport(engine, complete, randomUUID);
    await queueExternalLoadReport(
      engine,
      {
        ...complete,
        activity: 'physical_education',
        detail: '',
        day: TODAY,
        minutesText: '40',
        rpe: 4,
      },
      randomUUID,
    );
    let items = await week();
    expect(items.map((i) => [i.key, i.localDate, i.minutes, i.srpeAu, i.state])).toEqual([
      [ids[1], '2026-11-03', 40, 160, 'local'],
      [ids[0], '2026-11-01', 60, 360, 'local'],
    ]);
    // A correction of a create still in the queue names it by its clientUuid.
    const first = items[1];
    if (first === undefined) throw new Error('missing item');
    expect(
      await queueExternalLoadCorrection(
        engine,
        first,
        { ...draftOf(first), minutesText: '75' },
        'Fueron 75',
      ),
    ).toBe('saved');
    expect(await queueExternalLoadCorrection(engine, first, draftOf(first), 'x')).toBe('unchanged');
    items = await week();
    expect(items[1]).toMatchObject({ minutes: 75, srpeAu: 450, state: 'local' });
    const queued = await engine.store.pending(SCOPE.membershipId);
    expect(queued.map((m) => m.op)).toEqual([
      'external_load.report',
      'external_load.report',
      'external_load.correct',
    ]);
    expect(queued[0]?.input).toMatchObject({ body: { clientUuid: ids[0] } });
    expect(queued.slice(2).map((m) => [m.op, m.input])).toEqual([
      [
        'external_load.correct',
        { target: { clientUuid: ids[0] }, body: { changeReason: 'Fueron 75', minutes: 75 } },
      ],
    ]);
    const second = items[0];
    if (second === undefined) throw new Error('missing item');
    await queueExternalLoadArchive(engine, second);
    expect((await week()).map((i) => i.key)).toEqual([ids[0]]);
    expect(externalLoadTotal(await week())).toEqual({ count: 1, loadAu: 450 });
  });

  it('pushes the queue and shows the rows the pull brings, archived ones left out', async () => {
    const { server, engine, week } = await setup();
    const clientUuid = '33333333-3333-4333-8333-333333333333';
    await queueExternalLoadReport(engine, complete, () => clientUuid);
    const served = externalLoadDto({
      localDate: parseLocalDate('2026-11-01'),
      activity: 'other_sport',
      detail: 'Fútbol',
      minutes: 60,
      rpe: 6,
      srpeAu: 360,
    });
    const old = externalLoadDto({ localDate: parseLocalDate('2026-10-20') });
    const archived = externalLoadDto({ archivedAt: '2026-11-02T16:00:00.000Z' });
    server.publish(upsert(served, clientUuid), upsert(old), upsert(archived));
    const outcome = await engine.syncNow();
    expect(outcome).toMatchObject({ status: 'synced', pushed: 1 });
    expect(server.pushes[0]?.[0]).toMatchObject({
      op: 'external_load.report',
      body: { clientUuid, activity: 'other_sport', minutes: 60, rpe: 6 },
    });
    // The served row replaces the queued create; the one of an older week is out of the window.
    expect(await week()).toEqual([
      expect.objectContaining({ key: served.id, target: { id: served.id }, state: 'synced' }),
    ]);
    // A correction of a synced row is laid over it until the next pull.
    const [item] = await week();
    if (item === undefined) throw new Error('missing item');
    await queueExternalLoadCorrection(engine, item, { ...draftOf(item), rpe: 8 }, 'Más dura');
    expect(await week()).toEqual([
      expect.objectContaining({ key: served.id, rpe: 8, srpeAu: 480, state: 'pending' }),
    ]);
  });
});
