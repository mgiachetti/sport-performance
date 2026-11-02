import {
  CHANGE_OPERATIONS,
  CHANGE_REASON_MAX_LENGTH,
  CHANGE_SOURCES,
  CHANGE_TRACKED_TABLES,
  ROLES,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { player } from './players.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Change history (B-305, ADR 0030). Kept in its own module, with its enums,
 * so it stays isolated from the rest of the schema.
 *
 * Rows are written only by the trigger `change_history_record` (migration
 * `0008_change_history`) on every update or delete of a tracked table
 * (`CHANGE_TRACKED_TABLES`), never by the application: no connection role has
 * `INSERT`, `UPDATE` or `DELETE` on this table, and a guard rejects every
 * change except the `ON DELETE SET NULL` of the author's account.
 *
 * - `created_at` is when the change was made and `created_by` its author
 *   (`app.user_id` of the transaction, if the user exists).
 * - `old_values` / `new_values` hold only the changed columns, as JSON, keyed
 *   by column name; `new_values` is `NULL` for a delete. The audit columns
 *   (`updated_at`, `updated_by`, `created_by`) are not part of the diff.
 * - `reason` comes from `app.change_reason` (or, for a void of a
 *   `test_result_value`, from its `void_reason`). It is required when the API
 *   changes a value that was already submitted (not `NULL`).
 * - `request_id` comes from `app.request_id`, to correlate with the logs.
 * - `player_id` is the player the row belongs to (`NULL` for sessions): RLS
 *   shows the history to the staff that can see that player (ADR 0026).
 * - `seq` orders the changes, also several in one transaction.
 */

export const changeTrackedTableEnum = pgEnum('change_tracked_table', CHANGE_TRACKED_TABLES);
export const changeOperationEnum = pgEnum('change_operation', CHANGE_OPERATIONS);
export const changeSourceEnum = pgEnum('change_source', CHANGE_SOURCES);

/** Column values of a changed row, as `to_jsonb` renders them. */
export type ChangeValues = Readonly<Record<string, unknown>>;

export const changeHistory = pgTable(
  'change_history',
  {
    ...tenantColumns(),
    seq: bigint('seq', { mode: 'number' }).notNull().generatedByDefaultAsIdentity(),
    tableName: changeTrackedTableEnum('table_name').notNull(),
    recordId: uuid('record_id').notNull(),
    playerId: uuid('player_id').$type<PlayerId>(),
    operation: changeOperationEnum('operation').notNull(),
    source: changeSourceEnum('source').notNull(),
    /** The role validated by `app.current_role()` when the API made the change. */
    actorRole: text('actor_role'),
    changedColumns: text('changed_columns').array().notNull(),
    oldValues: jsonb('old_values').notNull().$type<ChangeValues>(),
    newValues: jsonb('new_values').$type<ChangeValues>(),
    reason: text('reason'),
    requestId: text('request_id'),
  },
  (t) => [
    ...tenantConstraints('change_history', t),
    tenantReference('change_history', t.clubId, t.playerId, player),
    index('change_history_player_idx')
      .on(t.clubId, t.playerId, t.seq)
      .where(sql`${t.playerId} is not null`),
    index('change_history_record_idx').on(t.clubId, t.tableName, t.recordId, t.seq),
    check('change_history_columns', sql`cardinality(${t.changedColumns}) >= 1`),
    check('change_history_new_values', sql`(${t.operation} = 'delete') = (${t.newValues} is null)`),
    check(
      'change_history_reason',
      sql`${t.reason} is null or (char_length(${t.reason}) between 1 and ${sql.raw(String(CHANGE_REASON_MAX_LENGTH))} and ${t.reason} = btrim(${t.reason}))`,
    ),
    check(
      'change_history_request_id',
      sql`${t.requestId} is null or ${t.requestId} ~ '^[A-Za-z0-9._:-]{1,128}$'`,
    ),
    check(
      'change_history_actor_role',
      sql`${t.actorRole} is null or (${t.source} = 'app' and ${t.actorRole} in (${sql.raw(ROLES.map((role) => `'${role}'`).join(', '))}))`,
    ),
  ],
);
