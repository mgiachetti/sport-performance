import {
  PARTICIPATION_CONTACTS_MAX,
  PARTICIPATION_MINUTES_MAX,
  sessionRosterEntrySchema,
  type ApiClient,
  type SessionRosterEntry,
  type SyncOperationInput,
  type TrainingSession,
} from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_TIME_ZONE,
  addDays,
  isParticipationStatus,
  isTimeZone,
  participationCarriesLoad,
  periodMinutesTotal,
  type LocalDate,
  type ParticipationStatus,
  type TimeZone,
} from '@sport-performance/domain';
import type { QueuedWrite, SyncEngine, SyncScopeRef } from '../offline/engine.ts';
import type { ReadCache, ReadSchema } from '../offline/read-cache.ts';
import {
  RECENT_SESSION_DAYS,
  createBatches,
  parsePeriods,
  type DraftEntry,
  type DraftField,
  type FieldClock,
  type KnownParticipation,
  type ParticipationTarget,
  type SavePlan,
} from './model.ts';

/**
 * Where the coach's session lives on the phone (B-509, ADR 0080): the
 * sessions and participation of the local database (synced, with the queue
 * laid over), the roster of each session and the club's time zone kept in
 * the read cache, the draft of the sheet kept there too on every change, and
 * the save, which only queues. Nothing here writes to the API.
 */

export const CLUB_KEY = 'coachSession.club';
export const ROSTER_KEY_PREFIX = 'coachSession.roster:';
export const DRAFT_KEY_PREFIX = 'coachSession.draft:';
export const rosterKey = (trainingSessionId: string) => `${ROSTER_KEY_PREFIX}${trainingSessionId}`;
export const draftKey = (trainingSessionId: string) => `${DRAFT_KEY_PREFIX}${trainingSessionId}`;

/** A roster read this recently is not downloaded again by the prefetch of the list. */
export const ROSTER_FRESH_MS = 15 * 60_000;

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

// ─── Club: time zone and category names ──────────────────────────────────────────────

export interface CoachClub {
  readonly timeZone: string;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}

// The documents are checked by hand (the app does not depend on zod): what
// does not parse is a miss of the cache, never a crash.
type Parsed<T> = { success: true; data: T } | { success: false };
const fail = { success: false } as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const coachClubSchema: ReadSchema<CoachClub> = {
  safeParse(value): Parsed<CoachClub> {
    if (!isRecord(value) || typeof value.timeZone !== 'string') return fail;
    if (!Array.isArray(value.categories)) return fail;
    const categories: { id: string; name: string }[] = [];
    for (const item of value.categories as unknown[]) {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
        return fail;
      }
      categories.push({ id: item.id, name: item.name });
    }
    return { success: true, data: { timeZone: value.timeZone, categories } };
  },
};

/** "Today" is the club's day (CLAUDE.md); the default zone until the club is read once. */
export function clubTimeZone(club: CoachClub | null): TimeZone {
  return club !== null && isTimeZone(club.timeZone) ? club.timeZone : DEFAULT_CLUB_TIME_ZONE;
}

async function allPages<Item>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: Item[]; nextCursor: string | null }>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return items;
}

export async function refreshCoachClub(
  api: Pick<ApiClient, 'getClub' | 'listCategories'>,
  cache: Pick<ReadCache, 'put'>,
  scope: SyncScopeRef,
  signal?: AbortSignal,
): Promise<CoachClub> {
  const options = signal === undefined ? {} : { signal };
  const club = await api.getClub(undefined, options);
  const categories = await allPages((cursor) =>
    api.listCategories(
      {
        query: { limit: PAGE_LIMIT, status: 'all', ...(cursor === undefined ? {} : { cursor }) },
      },
      options,
    ),
  );
  const value: CoachClub = {
    timeZone: club.timeZone,
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
  };
  await cache.put(scope, CLUB_KEY, value);
  return value;
}

// ─── Roster ──────────────────────────────────────────────────────────────────────────

export interface KeptRoster {
  readonly entries: readonly SessionRosterEntry[];
}

/** Checked with the contract of the roster: a roster an older build kept that no longer parses is a miss. */
export const keptRosterSchema: ReadSchema<KeptRoster> = {
  safeParse(value): Parsed<KeptRoster> {
    if (!isRecord(value) || !Array.isArray(value.entries)) return fail;
    const entries: SessionRosterEntry[] = [];
    for (const item of value.entries as unknown[]) {
      const parsed = sessionRosterEntrySchema.safeParse(item);
      if (!parsed.success) return fail;
      entries.push(parsed.data);
    }
    return { success: true, data: { entries } };
  },
};

/**
 * Downloads the roster of a session (players of the category that day and
 * those called up, with the derived availability, never the cause) and keeps
 * it on the phone for the field.
 */
export async function refreshRoster(
  api: Pick<ApiClient, 'listTrainingSessionRoster'>,
  cache: Pick<ReadCache, 'put'>,
  scope: SyncScopeRef,
  trainingSessionId: string,
  signal?: AbortSignal,
): Promise<KeptRoster> {
  const options = signal === undefined ? {} : { signal };
  const entries = await allPages((cursor) =>
    api.listTrainingSessionRoster(
      {
        params: { trainingSessionId },
        query: { limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      },
      options,
    ),
  );
  const value: KeptRoster = { entries };
  await cache.put(scope, rosterKey(trainingSessionId), value);
  return value;
}

/**
 * Keeps the rosters of the sessions the list shows fresh, so the coach can
 * go to the field without signal; the rosters of sessions that left the
 * list are deleted from the phone (only with `prune`). A failure of one roster (no signal) is
 * not an error: the next refresh tries again.
 */
export async function prefetchRosters(
  api: Pick<ApiClient, 'listTrainingSessionRoster'>,
  cache: ReadCache,
  scope: SyncScopeRef,
  sessionIds: readonly string[],
  options: {
    readonly nowMs?: number;
    readonly signal?: AbortSignal;
    /**
     * The list comes from a finished sync (`lastSyncedAt` set, no cycle
     * running): only then a roster missing from it is deleted. Before the
     * first pull, or while a reset pulls the sessions again, the list may be
     * empty or partial and the kept rosters are what the field needs.
     */
    readonly prune?: boolean;
  } = {},
): Promise<{ readonly fetched: number; readonly failed: number }> {
  const { nowMs = Date.now(), signal, prune = false } = options;
  const kept = await cache.list(scope.membershipId, ROSTER_KEY_PREFIX, keptRosterSchema);
  if (prune) {
    const wanted = new Set(sessionIds.map(rosterKey));
    for (const key of kept.keys()) {
      if (!wanted.has(key)) await cache.remove(scope.membershipId, key);
    }
  }
  let fetched = 0;
  let failed = 0;
  for (const id of sessionIds) {
    if (signal?.aborted === true) break;
    const current = kept.get(rosterKey(id));
    if (current !== undefined && nowMs - current.fetchedAt < ROSTER_FRESH_MS) continue;
    try {
      await refreshRoster(api, cache, scope, id, signal);
      fetched += 1;
    } catch {
      failed += 1;
    }
  }
  return { fetched, failed };
}

// ─── Sessions ────────────────────────────────────────────────────────────────────────

/** The sessions the list can show (today and the last week), from the local database. */
export async function loadSessions(
  sync: Pick<SyncEngine, 'store'>,
  membershipId: string,
  today: LocalDate,
): Promise<TrainingSession[]> {
  const rows = await sync.store.list(membershipId, 'training_session', {
    from: addDays(today, -RECENT_SESSION_DAYS),
    to: today,
  });
  return rows.map((row) => row.data);
}

export async function loadSession(
  sync: Pick<SyncEngine, 'store'>,
  membershipId: string,
  trainingSessionId: string,
): Promise<TrainingSession | null> {
  const row = await sync.store.get(membershipId, 'training_session', { id: trainingSessionId });
  return row?.data ?? null;
}

// ─── What the phone knows of the participation ───────────────────────────────────────

interface KnownFields {
  readonly status?: ParticipationStatus | undefined;
  readonly minutes?: number | null | undefined;
  readonly periodMinutes?: readonly number[] | null | undefined;
  readonly contactsN?: number | null | undefined;
}

function withLoadRule(known: KnownParticipation): KnownParticipation {
  if (participationCarriesLoad(known.status)) return known;
  // No load without taking part (the API's rule): the RPE goes too.
  return {
    ...known,
    minutes: null,
    periodMinutes: null,
    contactsN: null,
    rpe: null,
    srpeAu: null,
  };
}

/**
 * The minutes after a write, as the API decides them (B-803): periods set
 * the total as their sum; a total alone clears the periods.
 */
function minutesAfter(
  known: Pick<KnownParticipation, 'minutes' | 'periodMinutes'>,
  fields: Pick<KnownFields, 'minutes' | 'periodMinutes'>,
): Pick<KnownParticipation, 'minutes' | 'periodMinutes'> {
  if (fields.periodMinutes !== undefined && fields.periodMinutes !== null) {
    return {
      minutes: periodMinutesTotal(fields.periodMinutes),
      periodMinutes: fields.periodMinutes,
    };
  }
  if (fields.periodMinutes === null || fields.minutes !== undefined) {
    return {
      minutes: fields.minutes === undefined ? known.minutes : fields.minutes,
      periodMinutes: null,
    };
  }
  return { minutes: known.minutes, periodMinutes: known.periodMinutes };
}

function edited(
  known: KnownParticipation,
  fields: KnownFields,
  pending: boolean,
): KnownParticipation {
  return withLoadRule({
    ...known,
    ...(fields.status !== undefined && { status: fields.status }),
    ...minutesAfter(known, fields),
    ...(fields.contactsN !== undefined && { contactsN: fields.contactsN }),
    pending: known.pending || pending,
  });
}

function sameTarget(a: ParticipationTarget, b: ParticipationTarget): boolean {
  if ('id' in a && 'id' in b) return a.id === b.id;
  if ('clientUuid' in a && 'clientUuid' in b) return a.clientUuid === b.clientUuid;
  return false;
}

/**
 * The participation of each player of a session as the phone knows it: the
 * synced row with the queue laid over (`LocalStore`); for a player without a
 * synced row, the roster's (when the participation was not pulled yet) and
 * then this phone's queued creates and edits in queue order, which the local
 * store cannot lay over a row it does not have.
 */
export async function loadKnownParticipations(
  sync: Pick<SyncEngine, 'store'>,
  membershipId: string,
  trainingSessionId: string,
  roster: readonly SessionRosterEntry[],
): Promise<Map<string, KnownParticipation>> {
  const known = new Map<string, KnownParticipation>();
  const synced = await sync.store.list(membershipId, 'participation', {
    parentId: trainingSessionId,
  });
  const syncedPlayers = new Set<string>();
  for (const row of synced) {
    syncedPlayers.add(row.data.playerId);
    known.set(row.data.playerId, {
      target: { id: row.id },
      status: row.data.status,
      minutes: row.data.minutes,
      periodMinutes: row.data.periodMinutes,
      contactsN: row.data.contactsN,
      rpe: row.data.rpe,
      srpeAu: row.data.srpeAu,
      pending: row.pending,
    });
  }
  for (const entry of roster) {
    const participation = entry.participation;
    if (participation === null || known.has(entry.player.id)) continue;
    known.set(entry.player.id, {
      target: { id: participation.id },
      status: participation.status,
      minutes: participation.minutes,
      periodMinutes: participation.periodMinutes,
      contactsN: participation.contactsN,
      rpe: participation.rpe,
      srpeAu: participation.srpeAu,
      pending: false,
    });
  }
  const queue = await sync.store.pending(membershipId, [
    'participation.record',
    'participation.update',
  ]);
  for (const queued of queue) {
    if (queued.op === 'participation.record') {
      const input = queued.input as SyncOperationInput<'participation.record'>;
      if (input.params.trainingSessionId !== trainingSessionId) continue;
      for (const row of input.body.rows) {
        if (syncedPlayers.has(row.playerId)) continue;
        const current = known.get(row.playerId);
        const fields = {
          status: row.status,
          ...(row.minutes !== undefined && { minutes: row.minutes }),
          ...(row.periodMinutes !== undefined && { periodMinutes: row.periodMinutes }),
          ...(row.contactsN !== undefined && { contactsN: row.contactsN }),
        };
        known.set(
          row.playerId,
          current === undefined
            ? withLoadRule({
                target: { clientUuid: row.clientUuid },
                status: row.status,
                ...minutesAfter({ minutes: null, periodMinutes: null }, fields),
                contactsN: row.contactsN ?? null,
                rpe: null,
                srpeAu: null,
                pending: true,
              })
            : edited(current, fields, true),
        );
      }
      continue;
    }
    const input = queued.input as SyncOperationInput<'participation.update'>;
    for (const [playerId, current] of known) {
      if (syncedPlayers.has(playerId) || !sameTarget(current.target, input.target)) continue;
      const { status, minutes, periodMinutes, contactsN } = input.body;
      known.set(playerId, edited(current, { status, minutes, periodMinutes, contactsN }, true));
    }
  }
  return known;
}

// ─── Draft ───────────────────────────────────────────────────────────────────────────

/**
 * What the coach changed and did not save yet, kept on the phone on every
 * change: the rows they touched, each with the fields they changed (the rest
 * follows what the phone knows, also after a pull) and the clock of who is on the field.
 */
export interface SheetDraft {
  readonly rows: Readonly<Record<string, DraftEntry>>;
  readonly clock: FieldClock | null;
}

export const EMPTY_DRAFT: SheetDraft = { rows: {}, clock: null };

export function isEmptyDraft(draft: SheetDraft): boolean {
  return Object.keys(draft.rows).length === 0 && draft.clock === null;
}

const isCountText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= String(max).length && /^\d*$/.test(value);

const DRAFT_FIELDS: readonly DraftField[] = ['status', 'minutes', 'contacts'];
const isDraftField = (value: unknown): value is DraftField =>
  DRAFT_FIELDS.includes(value as DraftField);

function parseDraftEntry(value: unknown): DraftEntry | null {
  if (!isRecord(value)) return null;
  const { status, minutes, contacts, periods, touched } = value;
  if (status !== '' && !isParticipationStatus(status)) return null;
  if (!isCountText(minutes, PARTICIPATION_MINUTES_MAX)) return null;
  if (!isCountText(contacts, PARTICIPATION_CONTACTS_MAX)) return null;
  // Periods measured by the clock of a hockey match (B-803); older drafts have none.
  if (
    periods !== undefined &&
    (typeof periods !== 'string' || parsePeriods(periods) === 'invalid')
  ) {
    return null;
  }
  if (!Array.isArray(touched) || !touched.every(isDraftField)) return null;
  return {
    status,
    minutes,
    contacts,
    ...(periods === undefined || periods === '' ? {} : { periods }),
    touched: DRAFT_FIELDS.filter((f) => touched.includes(f)),
  };
}

function parseMsRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, ms] of Object.entries(value)) {
    if (!isMs(ms)) return null;
    result[key] = ms;
  }
  return result;
}

function parseClock(value: unknown): FieldClock | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { runningSinceMs, elapsedMs, onField } = value;
  if (runningSinceMs !== null && !isMs(runningSinceMs)) return undefined;
  if (!isMs(elapsedMs)) return undefined;
  if (!Array.isArray(onField) || !onField.every((id) => typeof id === 'string')) return undefined;
  const playedMs = parseMsRecord(value.playedMs);
  const stintSinceMs = parseMsRecord(value.stintSinceMs);
  if (playedMs === null || stintSinceMs === null) return undefined;
  // The ends of the periods (B-803); a clock an older build kept has none.
  const periodEndsMs: Record<string, number>[] = [];
  if (value.periodEndsMs !== undefined) {
    if (!Array.isArray(value.periodEndsMs)) return undefined;
    for (const end of value.periodEndsMs) {
      const parsed = parseMsRecord(end);
      if (parsed === null) return undefined;
      periodEndsMs.push(parsed);
    }
  }
  return { runningSinceMs, elapsedMs, onField, playedMs, stintSinceMs, periodEndsMs };
}

/** A draft an older build wrote that no longer parses is a miss, never a crash. */
export const sheetDraftSchema: ReadSchema<SheetDraft> = {
  safeParse(value): Parsed<SheetDraft> {
    if (!isRecord(value) || !isRecord(value.rows)) return fail;
    const rows: Record<string, DraftEntry> = {};
    for (const [playerId, row] of Object.entries(value.rows)) {
      const parsed = parseDraftEntry(row);
      if (parsed === null) return fail;
      rows[playerId] = parsed;
    }
    const clock = parseClock(value.clock);
    if (clock === undefined) return fail;
    return { success: true, data: { rows, clock } };
  },
};

export async function loadDraft(
  cache: Pick<ReadCache, 'get'>,
  membershipId: string,
  trainingSessionId: string,
): Promise<SheetDraft> {
  const kept = await cache.get(membershipId, draftKey(trainingSessionId), sheetDraftSchema);
  return kept?.value ?? EMPTY_DRAFT;
}

/** The sessions with a draft on the phone, for the list ("sin guardar"). */
export async function draftedSessions(
  cache: Pick<ReadCache, 'list'>,
  membershipId: string,
): Promise<Set<string>> {
  const kept = await cache.list(membershipId, DRAFT_KEY_PREFIX, sheetDraftSchema);
  const ids = new Set<string>();
  for (const [key, value] of kept) {
    if (!isEmptyDraft(value.value)) ids.add(key.slice(DRAFT_KEY_PREFIX.length));
  }
  return ids;
}

/**
 * The sessions with a draft on the phone that the list no longer shows
 * (they left the last week), so unsaved work never disappears from view.
 * With `prune` (the local database comes from a finished sync), a draft of
 * a session that is no longer on the phone at all is deleted: it cannot be
 * opened or saved any more.
 */
export async function olderDraftSessions(
  sync: Pick<SyncEngine, 'store'>,
  cache: Pick<ReadCache, 'list' | 'remove'>,
  membershipId: string,
  shownIds: readonly string[],
  options: { readonly prune?: boolean } = {},
): Promise<TrainingSession[]> {
  const shown = new Set(shownIds);
  const sessions: TrainingSession[] = [];
  for (const id of await draftedSessions(cache, membershipId)) {
    if (shown.has(id)) continue;
    const session = await loadSession(sync, membershipId, id);
    if (session !== null) sessions.push(session);
    else if (options.prune === true) await cache.remove(membershipId, draftKey(id));
  }
  return sessions.sort((a, b) => b.startsAt.localeCompare(a.startsAt) || a.id.localeCompare(b.id));
}

export async function saveDraft(
  cache: Pick<ReadCache, 'put' | 'remove'>,
  scope: SyncScopeRef,
  trainingSessionId: string,
  draft: SheetDraft,
): Promise<void> {
  if (isEmptyDraft(draft)) {
    await cache.remove(scope.membershipId, draftKey(trainingSessionId));
    return;
  }
  await cache.put(scope, draftKey(trainingSessionId), draft);
}

// ─── Save ────────────────────────────────────────────────────────────────────────────

/**
 * Queues a save: the new participations in batches of
 * `participation.record` (each row with a fresh `clientUuid`) and one
 * `participation.update` per edited player, with the reason on the
 * corrections. Every write is validated with the contract and they all
 * enter the queue in one transaction: a save never half enters the queue,
 * neither for a bug of the screen nor for a failure of the phone's
 * database. Answers the players it wrote.
 */
export async function queueSave(
  sync: Pick<SyncEngine, 'enqueueAll'>,
  trainingSessionId: string,
  plan: Pick<SavePlan, 'creates' | 'edits'>,
  changeReason: string | null,
  newUuid: () => string,
): Promise<string[]> {
  const reason = changeReason?.trim() ?? '';
  const writes: QueuedWrite[] = [];
  const creates = plan.creates.map((row) => ({ clientUuid: newUuid(), ...row }));
  for (const rows of createBatches(creates)) {
    writes.push({
      op: 'participation.record',
      input: { params: { trainingSessionId }, body: { rows } },
    });
  }
  for (const edit of plan.edits) {
    writes.push({
      op: 'participation.update',
      input: {
        target: edit.target,
        body: { ...edit.fields, ...(edit.correction && reason !== '' && { changeReason: reason }) },
      },
    });
  }
  await sync.enqueueAll(writes);
  return [...plan.creates.map((row) => row.playerId), ...plan.edits.map((edit) => edit.playerId)];
}

/** The draft after a save: the saved rows follow what the phone knows again. */
export function draftAfterSave(draft: SheetDraft, saved: readonly string[]): SheetDraft {
  const done = new Set(saved);
  return {
    rows: Object.fromEntries(Object.entries(draft.rows).filter(([id]) => !done.has(id))),
    clock: draft.clock,
  };
}
