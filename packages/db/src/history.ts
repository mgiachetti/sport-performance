import {
  parseChangeReason,
  type ChangeOperation,
  type ChangeSource,
  type ChangeTrackedTable,
  type PlayerId,
  type Role,
} from '@sport-performance/domain';
import { and, desc, eq, getTableColumns, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from './client.js';
import { TENANT_SETTING_NAMES } from './roles.js';
import { changeHistory, type ChangeValues } from './schema/history.js';

/**
 * Change history (B-305, ADR 0030): how the API passes the reason and the
 * request id of a change, and typed reads of the history.
 *
 * The rows are written by the database (trigger `change_history_record`),
 * never through this module. Every function runs on the caller's
 * transaction, after the tenant context is set (ADR 0006): RLS decides what
 * comes back (the staff that can see the player, ADR 0026). Values of
 * `test_result.not_done_reason` come back as the viewer sees them:
 * `injured` is `unavailable` to everyone but the medical staff (ADR 0029).
 */

/** Transaction-local settings the history trigger reads (like `app.club_id`). */
export const CHANGE_SETTING_NAMES = {
  /** Why submitted values change. Required for corrections made through the API. */
  reason: 'app.change_reason',
  /**
   * The request id of the API (`x-request-id`), to correlate with the logs.
   * The same setting as `TENANT_SETTING_NAMES.requestId` (ADR 0029).
   */
  requestId: TENANT_SETTING_NAMES.requestId,
} as const;

/** Same rule as the API's request ids and the `change_history_request_id` check. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export class ChangeContextError extends Error {
  override readonly name = 'ChangeContextError';
}

export interface ChangeContext {
  /**
   * Reason of the corrections of this transaction; trimmed, 1 to 500
   * characters. `null` clears it. Omitted: unchanged.
   */
  readonly reason?: string | null;
  /** Request id; `null` clears it. Omitted: unchanged. */
  readonly requestId?: string | null;
}

/**
 * Sets the reason and/or the request id for the rest of the current
 * transaction (`set_config(..., true)`, i.e. `SET LOCAL`): every change the
 * transaction makes to a tracked table is recorded with them. Call it inside
 * the tenant transaction, before the writes. Values travel as bind
 * parameters. Throws {@link ChangeContextError} for an invalid request id and
 * the domain's `DomainValidationError` for an invalid reason, before
 * touching the database.
 */
export async function setChangeContext(db: Database, context: ChangeContext): Promise<void> {
  const assignments: SQL[] = [];
  if (context.reason !== undefined) {
    const reason = context.reason === null ? '' : parseChangeReason(context.reason);
    assignments.push(sql`set_config(${CHANGE_SETTING_NAMES.reason}, ${reason}, true)`);
  }
  if (context.requestId !== undefined) {
    if (context.requestId !== null && !REQUEST_ID.test(context.requestId)) {
      throw new ChangeContextError(
        'The request id must be 1 to 128 characters of [A-Za-z0-9._:-].',
      );
    }
    assignments.push(
      sql`set_config(${CHANGE_SETTING_NAMES.requestId}, ${context.requestId ?? ''}, true)`,
    );
  }
  if (assignments.length === 0) return;
  await db.execute(sql`select ${sql.join(assignments, sql`, `)}`);
}

/** One changed column: its value before and after, as JSON (`null` after a delete). */
export interface ChangedValue {
  readonly column: string;
  readonly previous: unknown;
  readonly current: unknown;
}

/** A recorded change of a row, newest first in every list. */
export interface ChangeHistoryEntry {
  readonly id: string;
  /** Total order of the changes (also within one transaction). Use as a cursor. */
  readonly seq: number;
  readonly tableName: ChangeTrackedTable;
  readonly recordId: string;
  readonly playerId: PlayerId | null;
  readonly operation: ChangeOperation;
  readonly source: ChangeSource;
  /** `NULL` for system and worker changes without a user, or once the account is deleted. */
  readonly changedBy: string | null;
  readonly actorRole: Role | null;
  readonly changedAt: Date;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly changes: readonly ChangedValue[];
}

export interface ChangeHistoryPage {
  readonly entries: readonly ChangeHistoryEntry[];
  /** Pass as `beforeSeq` for the next (older) page; `null` when there is none. */
  readonly nextBeforeSeq: number | null;
}

export interface ChangeHistoryPageOptions {
  /** 1 to 100; default 50. */
  readonly limit?: number;
  /** Only changes older than this `seq` (the `nextBeforeSeq` of the previous page). */
  readonly beforeSeq?: number;
}

export const CHANGE_HISTORY_PAGE_LIMIT_DEFAULT = 50;
export const CHANGE_HISTORY_PAGE_LIMIT_MAX = 100;

type ChangeHistoryRow = typeof changeHistory.$inferSelect;

function changesOf(row: ChangeHistoryRow): ChangedValue[] {
  const previous: ChangeValues = row.oldValues;
  const current: ChangeValues | null = row.newValues;
  return row.changedColumns.map((column) => ({
    column,
    previous: previous[column] ?? null,
    current: current === null ? null : (current[column] ?? null),
  }));
}

function toEntry(row: ChangeHistoryRow): ChangeHistoryEntry {
  return {
    id: row.id,
    seq: row.seq,
    tableName: row.tableName,
    recordId: row.recordId,
    playerId: row.playerId,
    operation: row.operation,
    source: row.source,
    changedBy: row.createdBy,
    actorRole: row.actorRole as Role | null,
    changedAt: row.createdAt,
    reason: row.reason,
    requestId: row.requestId,
    changes: changesOf(row),
  };
}

function pageLimit(limit: number | undefined): number {
  const value = limit ?? CHANGE_HISTORY_PAGE_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || value < 1 || value > CHANGE_HISTORY_PAGE_LIMIT_MAX) {
    throw new RangeError(
      `limit must be an integer from 1 to ${String(CHANGE_HISTORY_PAGE_LIMIT_MAX)}`,
    );
  }
  return value;
}

/**
 * `values` with `test_result.not_done_reason` projected by
 * `app.not_done_reason_for_viewer()` (ADR 0029), like the API projects the
 * result itself: the history must not reveal `injured` either.
 */
function viewerValues<T extends ChangeValues | null>(
  values: typeof changeHistory.oldValues | typeof changeHistory.newValues,
): SQL<T> {
  // node-postgres parses the jsonb result like the column itself.
  return sql<T>`case
    when ${changeHistory.tableName} = 'test_result'
     and jsonb_typeof(${values} -> 'not_done_reason') = 'string'
    then jsonb_set(${values}, '{not_done_reason}',
           to_jsonb("app"."not_done_reason_for_viewer"(
             (${values} ->> 'not_done_reason')::"public"."test_not_done_reason")))
    else ${values}
  end`;
}

async function page(
  db: Database,
  filter: SQL | undefined,
  options: ChangeHistoryPageOptions,
): Promise<ChangeHistoryPage> {
  const limit = pageLimit(options.limit);
  if (options.beforeSeq !== undefined && !Number.isSafeInteger(options.beforeSeq)) {
    throw new RangeError('beforeSeq must be a safe integer');
  }
  const rows = await db
    .select({
      ...getTableColumns(changeHistory),
      oldValues: viewerValues<ChangeValues>(changeHistory.oldValues),
      newValues: viewerValues<ChangeValues | null>(changeHistory.newValues),
    })
    .from(changeHistory)
    .where(
      and(
        filter,
        options.beforeSeq === undefined ? undefined : lt(changeHistory.seq, options.beforeSeq),
      ),
    )
    .orderBy(desc(changeHistory.seq))
    .limit(limit + 1);
  const entries = rows.slice(0, limit).map(toEntry);
  const last = entries.at(-1);
  return { entries, nextBeforeSeq: rows.length > limit && last !== undefined ? last.seq : null };
}

/**
 * The history of one row of a tracked table, newest first. Empty when the
 * row never changed or the caller may not see it (RLS).
 */
export function listRecordChangeHistory(
  db: Database,
  record: { readonly tableName: ChangeTrackedTable; readonly recordId: string },
  options: ChangeHistoryPageOptions = {},
): Promise<ChangeHistoryPage> {
  return page(
    db,
    and(eq(changeHistory.tableName, record.tableName), eq(changeHistory.recordId, record.recordId)),
    options,
  );
}

/** Every recorded change of a player's rows, newest first (the player's file, B-305). */
export function listPlayerChangeHistory(
  db: Database,
  playerId: PlayerId,
  options: ChangeHistoryPageOptions = {},
): Promise<ChangeHistoryPage> {
  return page(db, eq(changeHistory.playerId, playerId), options);
}
