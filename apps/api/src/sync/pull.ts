import { createHash } from 'node:crypto';
import type { SyncChange } from '@sport-performance/contracts';
import {
  category,
  gymProgram,
  gymSet,
  participation,
  playerCategory,
  syncChange,
  testDefinition,
  testResult,
  testSession,
  trainingSession,
  wellness,
} from '@sport-performance/db/schema';
import {
  SYNC_COLLECTIONS,
  listScope,
  type CategoryId,
  type ClubId,
  type ListScope,
  type LocalDate,
  type PermissionSubject,
  type ResourceKind,
  type Sport,
  type SyncCollection,
} from '@sport-performance/domain';
import { and, eq, inArray, isNotNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { HttpError } from '../http/errors.js';
import { clubToday } from '../http/permissions.js';
import { testSessionColumns, testSessionDto } from '../routes/calendar/shared.js';
import { testResultColumns, testResultDtos } from '../routes/tests/model.js';
import {
  participationColumns,
  participationDto,
  sessionColumns,
  sessionDto,
} from '../routes/training-shared.js';
import { wellnessColumns, wellnessDto } from '../routes/wellness.js';
import {
  appliesTo,
  assignedPrograms,
  gymProgramColumns,
  gymProgramDto,
  gymSetColumns,
  gymSetDtos,
  playerDayOf,
} from '../routes/gym/model.js';
import { loadStageSources } from '../routes/tests/model.js';

/**
 * The pull of the offline sync (B-323, ADR 0050): the rows of the synced
 * collections that changed since the device's cursor, in the order of the
 * change log (`sync_change`, by `(txid, seq)`), as the read endpoints render
 * them and filtered by the same permission scope and RLS as their lists.
 */

/** Every collection is read with the `read` action of the matrix resource of its name. */
const READ_KIND = {
  wellness: 'wellness',
  participation: 'participation',
  training_session: 'training_session',
  test_session: 'test_session',
  test_result: 'test_result',
  gym_program: 'gym_program',
  gym_set: 'gym_set',
} as const satisfies Record<SyncCollection, ResourceKind>;

type Scope = Exclude<ListScope, { kind: 'none' } | { kind: 'platform' }>;

/** The collections a subject may pull, with the scope of each one. */
export function pullScopes(
  subject: PermissionSubject,
  requested: readonly SyncCollection[],
): Map<SyncCollection, Scope> {
  const scopes = new Map<SyncCollection, Scope>();
  for (const collection of SYNC_COLLECTIONS) {
    if (!requested.includes(collection)) continue;
    const scope = listScope(subject, READ_KIND[collection], 'read');
    // No `read` rule is platform-wide or needs a row check today; a new one must be added here.
    if (scope.kind === 'none' || scope.kind === 'platform') continue;
    if (scope.rowCheck) {
      throw new Error(`pull: ${collection} needs a row check the sync does not do`);
    }
    scopes.set(collection, scope);
  }
  return scopes;
}

// ─── Cursor ──────────────────────────────────────────────────────────────────────────

interface CursorPayload {
  readonly v: 1;
  /** Club the cursor belongs to. */
  readonly c: string;
  /** Fingerprint of what the caller sees (role, scopes, visible players, collections). */
  readonly f: string;
  /** Position in the log: `txid` and `seq` of the last change returned (`null` from the start). */
  readonly x: string | null;
  readonly s: number | null;
}

export interface PullPosition {
  readonly txid: string | null;
  readonly seq: number | null;
}

/** Largest `xid8` (unsigned 64 bits): a larger txid would fail the cast in the query. */
const XID8_MAX = 2n ** 64n - 1n;

const START: PullPosition = { txid: null, seq: null };

export function encodePullCursor(clubId: ClubId, fingerprint: string, at: PullPosition): string {
  const payload: CursorPayload = { v: 1, c: clubId, f: fingerprint, x: at.txid, s: at.seq };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function invalidCursor(): never {
  throw new HttpError('bad_request', 'Invalid sync cursor');
}

/**
 * Where to read from. A cursor of another fingerprint (the caller's scope
 * changed) restarts from the beginning with `reset`; a malformed one or one
 * of another club is `400`.
 */
export function decodePullCursor(
  cursor: string | undefined,
  clubId: ClubId,
  fingerprint: string,
): { at: PullPosition; reset: boolean } {
  if (cursor === undefined) return { at: START, reset: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null) return invalidCursor();
  const { v, c, f, x, s } = parsed as Partial<Record<keyof CursorPayload, unknown>>;
  if (v !== 1 || typeof c !== 'string' || typeof f !== 'string') return invalidCursor();
  if (c !== clubId) throw new HttpError('bad_request', 'The sync cursor belongs to another club');
  let at: PullPosition;
  if (x === null && s === null) at = START;
  else if (
    typeof x === 'string' &&
    /^\d{1,20}$/.test(x) &&
    BigInt(x) <= XID8_MAX &&
    typeof s === 'number' &&
    Number.isSafeInteger(s) &&
    s >= 0
  ) {
    at = { txid: x, seq: s };
  } else return invalidCursor();
  if (f !== fingerprint) return { at: START, reset: true };
  return { at, reset: false };
}

/**
 * What the caller sees, as a hash: their role and user, the scope of each
 * collection, the categories their assignments give them today (by category
 * or by sport, as the log's policy reads them) and the players RLS shows
 * them today. When it changes (a new assignment, a new category of an
 * assigned sport, a player who joined or left a category, another role),
 * rows may have entered or left the caller's view without a change in the
 * log: the device has to download its collections again. A row that leaves
 * the view by a change of its own (a session moved to another category) is
 * not a reset: the log keeps an entry for the scope it left (ADR 0050).
 */
export async function pullFingerprint(
  db: TenantDatabase,
  subject: PermissionSubject,
  scopes: ReadonlyMap<SyncCollection, Scope>,
): Promise<string> {
  const { rows } = await db.execute<{ ids: string[] | null; categories: string[] | null }>(
    sql`select coalesce((select array_agg(v order by v) from unnest(app.visible_player_ids()) v), '{}')::text[] as ids,
               coalesce((select array_agg(v order by v) from unnest(app.assigned_category_ids()) v), '{}')::text[] as categories`,
  );
  // Which category programs reach a player follows their categories and stage today: a
  // change of either can bring or take programs without a change in the log.
  const programScope = scopes.get('gym_program');
  const playerDays =
    programScope?.kind === 'players'
      ? await (async () => {
          if (subject.clubId === null) throw new Error('pull: a players scope outside a club');
          const sources = await loadStageSources(db, subject.clubId, programScope.playerIds);
          const today = await clubToday(db);
          return programScope.playerIds.map((id) => {
            const day = playerDayOf(sources, id, today);
            const categories = day.categories
              .map((c) => [c.id, c.stage, c.stageLessApplies] as const)
              .sort(([a], [b]) => (a < b ? -1 : 1));
            return [id, categories, day.stage];
          });
        })()
      : null;
  const scopeKeys = [...scopes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([collection, scope]) => [
      collection,
      scope.kind,
      scope.kind === 'assigned' ? [[...scope.categoryIds].sort(), [...scope.sports].sort()] : null,
      scope.kind === 'players' ? [...scope.playerIds].sort() : null,
    ]);
  return createHash('sha256')
    .update(
      JSON.stringify([
        subject.userId,
        subject.role,
        subject.clubId,
        scopeKeys,
        rows[0]?.ids ?? [],
        rows[0]?.categories ?? [],
        ...(playerDays === null ? [] : [playerDays]),
      ]),
    )
    .digest('base64url')
    .slice(0, 22);
}

// ─── Scope filters ───────────────────────────────────────────────────────────────────

/** `valid_from <= day < valid_to` of a player's category (exclusive end, ADR 0023). */
function currentOn(day: LocalDate): SQL {
  return sql`(${playerCategory.validFrom} <= ${day}::date and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${day}::date))`;
}

/** The player is today in a category of the assignments (as `app.visible_player_ids`). */
function assignedPlayer(
  clubId: AnyColumn,
  playerId: AnyColumn,
  today: LocalDate,
  categoryIds: readonly CategoryId[],
  sports: readonly Sport[],
): SQL {
  const target = or(
    categoryIds.length > 0 ? inArray(category.id, [...categoryIds]) : undefined,
    sports.length > 0 ? inArray(category.sport, [...sports]) : undefined,
  );
  return sql`exists (
    select 1 from ${playerCategory}
      join ${category} on ${category.clubId} = ${playerCategory.clubId}
                      and ${category.id} = ${playerCategory.categoryId}
     where ${playerCategory.clubId} = ${clubId}
       and ${playerCategory.playerId} = ${playerId}
       and ${currentOn(today)}
       and ${target})`;
}

function playerScope(
  scope: Scope,
  clubId: AnyColumn,
  playerId: AnyColumn,
  today: LocalDate,
): SQL | undefined {
  switch (scope.kind) {
    case 'club':
      return undefined;
    case 'assigned':
      return assignedPlayer(clubId, playerId, today, scope.categoryIds, scope.sports);
    case 'players':
      return inArray(playerId, [...scope.playerIds]);
  }
}

/** Sessions of the assigned categories or sports; days without category only for the club scope. */
function sessionScope(
  scope: Scope,
  categoryId: AnyColumn,
  sport: AnyColumn,
): SQL | undefined | false {
  switch (scope.kind) {
    case 'club':
      return undefined;
    case 'assigned':
      return and(
        isNotNull(categoryId),
        or(
          scope.categoryIds.length > 0 ? inArray(categoryId, [...scope.categoryIds]) : undefined,
          scope.sports.length > 0 ? inArray(sport, [...scope.sports]) : undefined,
        ),
      );
    case 'players':
      // No rule of the sessions scopes by player.
      return false;
  }
}

/**
 * {@link sessionScope} for an entry of the log: the category and sport it
 * was logged under (the session's now, or one it was deleted from or left).
 */
function seesSessionEntry(scope: Scope, categoryId: string | null, sport: Sport | null): boolean {
  switch (scope.kind) {
    case 'club':
      return true;
    case 'assigned':
      return (
        categoryId !== null &&
        ((scope.categoryIds as readonly string[]).includes(categoryId) ||
          (sport !== null && scope.sports.includes(sport)))
      );
    case 'players':
      return false;
  }
}

const SESSION_COLLECTIONS: ReadonlySet<SyncCollection> = new Set([
  'training_session',
  'test_session',
]);

// ─── Rows ────────────────────────────────────────────────────────────────────────────

type Upsert = Extract<SyncChange, { op: 'upsert' }>;

interface LoadContext {
  readonly db: TenantDatabase;
  readonly clubId: ClubId;
  readonly today: LocalDate;
}

/** The visible rows of `ids`, as upserts, by id. */
async function loadRows(
  ctx: LoadContext,
  collection: SyncCollection,
  scope: Scope,
  ids: readonly string[],
): Promise<Map<string, Upsert>> {
  const { db, clubId, today } = ctx;
  const out = new Map<string, Upsert>();
  switch (collection) {
    case 'wellness': {
      const rows = await db
        .select({ ...wellnessColumns, clientUuid: wellness.clientUuid })
        .from(wellness)
        .where(
          and(
            eq(wellness.clubId, clubId),
            inArray(wellness.id, [...ids]),
            playerScope(scope, wellness.clubId, wellness.playerId, today),
          ),
        );
      for (const row of rows) {
        out.set(row.id, {
          collection,
          op: 'upsert',
          id: row.id,
          clientUuid: row.clientUuid,
          data: wellnessDto(row),
        } as Upsert);
      }
      return out;
    }
    case 'participation': {
      const rows = await db
        .select(participationColumns)
        .from(participation)
        .where(
          and(
            eq(participation.clubId, clubId),
            inArray(participation.id, [...ids]),
            playerScope(scope, participation.clubId, participation.playerId, today),
          ),
        );
      for (const row of rows) {
        out.set(row.id, {
          collection,
          op: 'upsert',
          id: row.id,
          clientUuid: row.clientUuid,
          data: participationDto(row),
        } as Upsert);
      }
      return out;
    }
    case 'training_session': {
      const filter = sessionScope(scope, trainingSession.categoryId, trainingSession.sport);
      if (filter === false) return out;
      const rows = await db
        .select({ ...sessionColumns, clientUuid: trainingSession.clientUuid })
        .from(trainingSession)
        .where(
          and(eq(trainingSession.clubId, clubId), inArray(trainingSession.id, [...ids]), filter),
        );
      for (const row of rows) {
        out.set(row.id, {
          collection,
          op: 'upsert',
          id: row.id,
          clientUuid: row.clientUuid,
          data: sessionDto(row),
        } as Upsert);
      }
      return out;
    }
    case 'test_session': {
      const filter = sessionScope(scope, testSession.categoryId, testSession.sport);
      if (filter === false) return out;
      const rows = await db
        .select({ ...testSessionColumns, clientUuid: testSession.clientUuid })
        .from(testSession)
        .where(and(eq(testSession.clubId, clubId), inArray(testSession.id, [...ids]), filter));
      for (const row of rows) {
        out.set(row.id, {
          collection,
          op: 'upsert',
          id: row.id,
          clientUuid: row.clientUuid,
          data: testSessionDto(row),
        } as Upsert);
      }
      return out;
    }
    case 'test_result': {
      const rows = await db
        .select({ ...testResultColumns, clientUuid: testResult.clientUuid })
        .from(testResult)
        .innerJoin(
          testDefinition,
          and(
            eq(testDefinition.clubId, testResult.clubId),
            eq(testDefinition.id, testResult.testDefinitionId),
          ),
        )
        .where(
          and(
            eq(testResult.clubId, clubId),
            inArray(testResult.id, [...ids]),
            playerScope(scope, testResult.clubId, testResult.playerId, today),
          ),
        );
      const dtos = await testResultDtos(db, clubId, rows);
      rows.forEach((row, index) => {
        out.set(row.id, {
          collection,
          op: 'upsert',
          id: row.id,
          clientUuid: row.clientUuid,
          data: dtos[index],
        } as Upsert);
      });
      return out;
    }
    case 'gym_program': {
      let filter: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          filter = undefined;
          break;
        case 'assigned':
          filter = assignedPrograms(today, scope.categoryIds, scope.sports);
          break;
        case 'players': {
          const sources = await loadStageSources(db, clubId, scope.playerIds);
          const days = scope.playerIds.map((id) => appliesTo(playerDayOf(sources, id, today)));
          filter = days.length === 0 ? sql`false` : sql`(${sql.join(days, sql` or `)})`;
          break;
        }
      }
      // An archived program leaves the phone (a delete): it no longer applies.
      const rows = await db
        .select(gymProgramColumns)
        .from(gymProgram)
        .where(
          and(
            eq(gymProgram.clubId, clubId),
            inArray(gymProgram.id, [...ids]),
            sql`${gymProgram.archivedAt} is null`,
            filter,
          ),
        );
      for (const row of rows) {
        out.set(row.id, {
          collection,
          op: 'upsert',
          id: row.id,
          clientUuid: row.clientUuid,
          data: gymProgramDto(row),
        } as Upsert);
      }
      return out;
    }
    case 'gym_set': {
      const rows = await db
        .select(gymSetColumns)
        .from(gymSet)
        .where(
          and(
            eq(gymSet.clubId, clubId),
            inArray(gymSet.id, [...ids]),
            playerScope(scope, gymSet.clubId, gymSet.playerId, today),
          ),
        );
      const dtos = await gymSetDtos(db, clubId, rows);
      rows.forEach((row, index) => {
        out.set(row.id, {
          collection,
          op: 'upsert',
          id: row.id,
          clientUuid: row.clientUuid,
          data: dtos[index],
        } as Upsert);
      });
      return out;
    }
  }
}

export interface PullPage {
  readonly items: SyncChange[];
  readonly at: PullPosition;
  readonly hasMore: boolean;
}

/**
 * One page of changes after `at`. Only changes of transactions that already
 * ended are read (`txid` below the `xmin` of the snapshot): a transaction
 * still running when the page is read gets a `txid` at or above it, so it
 * shows up in a later page, never before the cursor.
 */
export async function pullPage(
  db: TenantDatabase,
  clubId: ClubId,
  scopes: ReadonlyMap<SyncCollection, Scope>,
  at: PullPosition,
  limit: number,
): Promise<PullPage> {
  const collections = [...scopes.keys()];
  if (collections.length === 0) return { items: [], at, hasMore: false };
  const after =
    at.txid === null
      ? undefined
      : sql`(${syncChange.txid}, ${syncChange.seq}) > (${at.txid}::xid8, ${at.seq}::bigint)`;
  const log = await db
    .select({
      collection: syncChange.collection,
      rowId: syncChange.rowId,
      categoryId: syncChange.categoryId,
      sport: syncChange.sport,
      txid: sql<string>`${syncChange.txid}::text`,
      seq: syncChange.seq,
    })
    .from(syncChange)
    .where(
      and(
        eq(syncChange.clubId, clubId),
        inArray(syncChange.collection, collections),
        after,
        sql`${syncChange.txid} < pg_snapshot_xmin(pg_current_snapshot())`,
      ),
    )
    .orderBy(syncChange.txid, syncChange.seq)
    .limit(limit + 1);
  const hasMore = log.length > limit;
  const page = log.slice(0, limit);
  const last = page.at(-1);
  if (last === undefined) return { items: [], at, hasMore: false };

  // A session entry outside the caller's scope of the matrix is skipped, as its rows are: the
  // log's policy gives the same categories, this keeps both in step.
  const inScope = page.filter((entry) => {
    if (!SESSION_COLLECTIONS.has(entry.collection)) return true;
    const scope = scopes.get(entry.collection);
    return scope !== undefined && seesSessionEntry(scope, entry.categoryId, entry.sport);
  });
  const ctx: LoadContext = { db, clubId, today: await clubToday(db) };
  const loaded = new Map<SyncCollection, Map<string, Upsert>>();
  for (const collection of collections) {
    const ids = [
      ...new Set(inScope.filter((e) => e.collection === collection).map((e) => e.rowId)),
    ];
    const scope = scopes.get(collection);
    if (ids.length === 0 || scope === undefined) continue;
    loaded.set(collection, await loadRows(ctx, collection, scope, ids));
  }
  // Every entry the caller sees is a row that is in their view now (upsert) or is not anymore:
  // deleted, or moved out of the scope of the entry (a session to another category). Both go
  // as a delete, so the device never keeps a row it no longer sees; one for an id the device
  // never had is a no-op. A row with more than one entry in the page (the mark of the scope it
  // left and its new one) goes once.
  const items: SyncChange[] = [];
  const done = new Set<string>();
  for (const entry of inScope) {
    const key = `${entry.collection}:${entry.rowId}`;
    if (done.has(key)) continue;
    done.add(key);
    const row = loaded.get(entry.collection)?.get(entry.rowId);
    items.push(
      row ??
        ({
          collection: entry.collection,
          op: 'delete',
          id: entry.rowId,
          clientUuid: null,
          data: null,
        } as SyncChange),
    );
  }
  return { items, at: { txid: last.txid, seq: last.seq }, hasMore };
}
