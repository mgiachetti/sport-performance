import {
  createApiClient,
  type SessionRosterEntry,
  type SyncChange,
  type TrainingSession,
} from '@sport-performance/contracts';
import type { LocalDate } from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyncEngine } from '../offline/engine.ts';
import { createReadCache } from '../offline/read-cache.ts';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createFakeApi } from '../test/fake-api.ts';
import {
  PLAYER_ID,
  SESSION_ID,
  T0,
  createFakeSyncServer,
  participationDto,
  upsert,
  uuid,
} from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  CLUB_KEY,
  ROSTER_FRESH_MS,
  coachClubSchema,
  draftAfterSave,
  draftedSessions,
  keptRosterSchema,
  loadDraft,
  loadKnownParticipations,
  loadSessions,
  olderDraftSessions,
  prefetchRosters,
  queueSave,
  refreshCoachClub,
  rosterKey,
  saveDraft,
  type SheetDraft,
} from './data.ts';
import {
  EMPTY_CLOCK,
  pauseClock,
  planSave,
  startClock,
  toggleOnField,
  type DraftRow,
} from './model.ts';

const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const OTHER_PLAYER = 'b2222222-2222-4222-8222-222222222222';
const THIRD_PLAYER = 'b3333333-3333-4333-8333-333333333333';
const CATEGORY_ID = 'd1111111-1111-4111-8111-111111111111';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function trainingSessionDto(overrides: Partial<Record<keyof TrainingSession, unknown>> = {}) {
  return {
    id: SESSION_ID,
    sport: 'rugby',
    kind: 'training',
    categoryId: CATEGORY_ID,
    title: null,
    startsAt: '2026-11-03T21:00:00.000Z',
    localDate: '2026-11-03',
    plannedDurationMin: 90,
    location: null,
    opponent: null,
    notes: null,
    archivedAt: null,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    version: 'v1',
    ...overrides,
  } as TrainingSession;
}

function rosterEntry(
  playerId: string,
  overrides: Partial<Record<keyof SessionRosterEntry, unknown>> = {},
): SessionRosterEntry {
  return {
    player: { id: playerId, firstName: 'Juan', lastName: 'Pérez', archivedAt: null },
    inCategory: true,
    participation: null,
    availability: { status: 'available', staffNotes: [] },
    hasDataConsent: true,
    canRecord: true,
    ...overrides,
  } as SessionRosterEntry;
}

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
    reportError: () => undefined,
  });
  await engine.setScope(SCOPE);
  const cache = createReadCache(database, { activeScope: () => SCOPE, now: () => time });
  cleanups.push(() => {
    engine.dispose();
  });
  return {
    api,
    server,
    client,
    engine,
    cache,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const sessionChange = (data: TrainingSession): SyncChange => ({
  collection: 'training_session',
  op: 'upsert',
  id: data.id,
  clientUuid: null,
  data,
});

describe('sessions and participation from the phone', () => {
  it('lists the synced sessions of the week', async () => {
    const { server, engine } = await setup();
    server.publish(
      sessionChange(trainingSessionDto()),
      sessionChange(trainingSessionDto({ id: uuid(), localDate: '2026-10-20' })),
    );
    await engine.syncNow();
    const sessions = await loadSessions(engine, SCOPE.membershipId, '2026-11-03' as LocalDate);
    expect(sessions.map((s) => s.id)).toEqual([SESSION_ID]);
  });

  it('knows each player: synced rows with the queue over them, the roster, and queued creates and edits', async () => {
    const { server, engine } = await setup();
    const synced = participationDto({ minutes: 60, contactsN: 2, rpe: 7, srpeAu: 420 });
    server.publish(upsert('participation', synced));
    await engine.syncNow();
    server.failPush('network-error', 'network-error', 'network-error');
    const fromRoster = participationDto({ playerId: THIRD_PLAYER, minutes: 30 });
    const roster = [
      rosterEntry(PLAYER_ID),
      rosterEntry(OTHER_PLAYER),
      rosterEntry(THIRD_PLAYER, { participation: fromRoster }),
    ];

    // Offline: an edit of the synced row, a new row and an edit of that new row.
    const created = uuid();
    await engine.enqueue('participation.update', {
      target: { id: synced.id },
      body: { contactsN: 5 },
    });
    await engine.enqueue('participation.record', {
      params: { trainingSessionId: SESSION_ID },
      body: {
        rows: [{ clientUuid: created, playerId: OTHER_PLAYER, status: 'full', minutes: 80 }],
      },
    });
    await engine.enqueue('participation.update', {
      target: { clientUuid: created },
      body: { status: 'absent' },
    });
    await engine.enqueue('participation.update', {
      target: { id: fromRoster.id },
      body: { minutes: 35 },
    });

    const known = await loadKnownParticipations(engine, SCOPE.membershipId, SESSION_ID, roster);
    expect(known.get(PLAYER_ID)).toMatchObject({
      target: { id: synced.id },
      minutes: 60,
      contactsN: 5,
      rpe: 7,
      pending: true,
    });
    // Absent carries no load.
    expect(known.get(OTHER_PLAYER)).toMatchObject({
      target: { clientUuid: created },
      status: 'absent',
      minutes: null,
      pending: true,
    });
    expect(known.get(THIRD_PLAYER)).toMatchObject({
      target: { id: fromRoster.id },
      minutes: 35,
      pending: true,
    });
  });
});

describe('save', () => {
  it('queues one batch of creates and one edit per known player, with the reason on corrections', async () => {
    const { server, engine } = await setup();
    const synced = participationDto({ minutes: 60, contactsN: 2 });
    server.publish(upsert('participation', synced));
    await engine.syncNow();
    const roster = [rosterEntry(PLAYER_ID), rosterEntry(OTHER_PLAYER)];
    const known = await loadKnownParticipations(engine, SCOPE.membershipId, SESSION_ID, roster);
    const rows = new Map<string, DraftRow>([
      [PLAYER_ID, { status: 'full', minutes: '55', contacts: '2' }],
      [OTHER_PLAYER, { status: 'partial', minutes: '20', contacts: '3' }],
    ]);
    const plan = planSave(roster, known, rows);
    expect(plan.needsReason).toBe(true);
    const saved = await queueSave(engine, SESSION_ID, plan, '  Salió antes  ', uuid);
    expect(saved).toEqual([OTHER_PLAYER, PLAYER_ID]);
    await engine.syncNow();
    const pushed = server.pushes.at(-1) ?? [];
    expect(pushed.map((m) => m.op)).toEqual(['participation.record', 'participation.update']);
    expect(pushed[0]?.params).toEqual({ trainingSessionId: SESSION_ID });
    expect(pushed[0]?.body).toEqual({
      rows: [expect.objectContaining({ playerId: OTHER_PLAYER, minutes: 20, contactsN: 3 })],
    });
    // Only the changed field, never a version: the server resolves it by its clock.
    expect(pushed[1]).toMatchObject({
      target: { id: synced.id },
      body: { minutes: 55, changeReason: 'Salió antes' },
    });
  });

  it('queues nothing when one write of the save is invalid', async () => {
    const { engine } = await setup();
    await expect(
      queueSave(
        engine,
        SESSION_ID,
        {
          creates: [{ playerId: PLAYER_ID, status: 'full', minutes: 60 }],
          edits: [
            {
              playerId: OTHER_PLAYER,
              target: { id: uuid() },
              correction: false,
              fields: { minutes: 9999 },
            },
          ],
        },
        null,
        uuid,
      ),
    ).rejects.toThrow();
    expect(engine.getStatus().pendingCount).toBe(0);
  });
});

describe('kept on the phone', () => {
  it('keeps the periods of a hockey match and the ends of the periods of its clock (B-803)', async () => {
    const { cache } = await setup();
    const clock = pauseClock(
      startClock(toggleOnField(EMPTY_CLOCK, PLAYER_ID, T0), T0),
      T0 + 900_000,
    );
    const draft: SheetDraft = {
      rows: {
        [PLAYER_ID]: {
          status: 'partial',
          minutes: '20',
          contacts: '',
          periods: '15,5',
          touched: ['status', 'minutes'],
        },
      },
      clock,
    };
    expect(clock.periodEndsMs).toEqual([{ [PLAYER_ID]: 900_000 }]);
    await saveDraft(cache, SCOPE, SESSION_ID, draft);
    expect(await loadDraft(cache, SCOPE.membershipId, SESSION_ID)).toEqual(draft);
  });

  it('keeps the draft with its clock by membership, and lists the sessions with one', async () => {
    const { engine, cache } = await setup();
    const draft: SheetDraft = {
      rows: {
        [PLAYER_ID]: {
          status: 'full',
          minutes: '',
          contacts: '3',
          touched: ['status', 'contacts'],
        },
      },
      clock: startClock(toggleOnField(EMPTY_CLOCK, PLAYER_ID, T0), T0),
    };
    await saveDraft(cache, SCOPE, SESSION_ID, draft);
    expect(await loadDraft(cache, SCOPE.membershipId, SESSION_ID)).toEqual(draft);
    expect(await draftedSessions(cache, SCOPE.membershipId)).toEqual(new Set([SESSION_ID]));
    expect(await loadDraft(cache, 'a2222222-2222-4222-8222-222222222222', SESSION_ID)).toEqual({
      rows: {},
      clock: null,
    });

    const after = draftAfterSave({ ...draft, clock: null }, [PLAYER_ID]);
    await saveDraft(cache, SCOPE, SESSION_ID, after);
    expect(await draftedSessions(cache, SCOPE.membershipId)).toEqual(new Set());

    // Signing out deletes it with the membership.
    await saveDraft(cache, SCOPE, SESSION_ID, draft);
    await engine.wipe();
    expect(await loadDraft(cache, SCOPE.membershipId, SESSION_ID)).toEqual({
      rows: {},
      clock: null,
    });
  });

  it('downloads the rosters of the list once in a while and drops the ones that left it', async () => {
    const { api, client, advance, cache } = await setup();
    const other = uuid();
    const stale = uuid();
    let calls = 0;
    api.on(`GET /v1/training-sessions/${SESSION_ID}/roster`, () => {
      calls += 1;
      return { status: 200, body: { items: [rosterEntry(PLAYER_ID)], nextCursor: null } };
    });
    api.on(`GET /v1/training-sessions/${stale}/roster`, {
      status: 200,
      body: { items: [], nextCursor: null },
    });
    await prefetchRosters(client, cache, SCOPE, [stale], { nowMs: T0 });
    // Before a finished sync (first pull, a reset), an empty list deletes nothing.
    await prefetchRosters(client, cache, SCOPE, [], { nowMs: T0 });
    expect(await cache.get(SCOPE.membershipId, rosterKey(stale), keptRosterSchema)).not.toBeNull();
    const first = await prefetchRosters(client, cache, SCOPE, [SESSION_ID, other], {
      nowMs: T0,
      prune: true,
    });
    // The other one has no answer (no signal): counted, not thrown.
    expect(first).toEqual({ fetched: 1, failed: 1 });
    const kept = await cache.get(SCOPE.membershipId, rosterKey(SESSION_ID), keptRosterSchema);
    expect(kept?.value.entries.map((e) => e.player.id)).toEqual([PLAYER_ID]);
    expect(await cache.get(SCOPE.membershipId, rosterKey(stale), keptRosterSchema)).toBeNull();

    await prefetchRosters(client, cache, SCOPE, [SESSION_ID], { nowMs: T0 + 60_000 });
    expect(calls).toBe(1);
    advance(ROSTER_FRESH_MS);
    await prefetchRosters(client, cache, SCOPE, [SESSION_ID], {
      nowMs: T0 + ROSTER_FRESH_MS + 1,
    });
    expect(calls).toBe(2);
  });

  it('shows the drafts of sessions that left the list, and drops those no longer on the phone', async () => {
    const { server, engine, cache } = await setup();
    const old = trainingSessionDto({ id: uuid(), localDate: '2026-10-20' });
    server.publish(sessionChange(old));
    await engine.syncNow();
    const gone = uuid();
    const draft: SheetDraft = {
      rows: { [PLAYER_ID]: { status: 'full', minutes: '', contacts: '1', touched: ['contacts'] } },
      clock: null,
    };
    for (const id of [SESSION_ID, old.id, gone]) await saveDraft(cache, SCOPE, id, draft);
    const shown = [SESSION_ID];
    const first = await olderDraftSessions(engine, cache, SCOPE.membershipId, shown);
    expect(first.map((s) => s.id)).toEqual([old.id]);
    // Without a finished sync the draft of a session not on the phone stays.
    expect(await draftedSessions(cache, SCOPE.membershipId)).toContain(gone);
    await olderDraftSessions(engine, cache, SCOPE.membershipId, shown, { prune: true });
    expect(await draftedSessions(cache, SCOPE.membershipId)).toEqual(new Set([SESSION_ID, old.id]));
  });

  it('keeps the club time zone and category names, following every page', async () => {
    const { cache } = await setup();
    const pages = [
      { items: [{ id: CATEGORY_ID, name: 'M17' }], nextCursor: 'next' },
      { items: [{ id: OTHER_PLAYER, name: 'M19' }], nextCursor: null },
    ];
    const cursors: (string | undefined)[] = [];
    const club = await refreshCoachClub(
      {
        getClub: () => Promise.resolve({ timeZone: 'America/Argentina/Buenos_Aires' } as never),
        listCategories: (input) => {
          cursors.push(input?.query?.cursor);
          return Promise.resolve(pages[cursors.length - 1] as never);
        },
      },
      cache,
      SCOPE,
    );
    expect(cursors).toEqual([undefined, 'next']);
    expect(club.categories.map((c) => c.name)).toEqual(['M17', 'M19']);
    const kept = await cache.get(SCOPE.membershipId, CLUB_KEY, coachClubSchema);
    expect(kept?.value).toEqual(club);
  });
});
