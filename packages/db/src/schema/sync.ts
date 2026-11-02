import {
  HLC_PATTERN,
  SYNC_COLLECTIONS,
  SYNC_OPERATIONS,
  SYNC_STORED_OUTCOMES,
  type CategoryId,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sportEnum } from './enums.js';
import { tenantColumns, tenantConstraints } from './tenant.js';

/**
 * Offline sync (B-323, ADR 0015, ADR 0050). Kept in its own module, with its
 * enums.
 *
 * - `sync_change`: one row per synced row and per scope it was in (its
 *   player, or the category and sport of a session), written only by the trigger
 *   `sync_change_record` (migration `0025_offline_sync`) on every insert,
 *   update or delete of a synced table; never by the application (no
 *   `INSERT`, `UPDATE` or `DELETE` grant). Each change moves the row to the
 *   end of the log: a new `(txid, seq)`. Devices pull by that cursor, only
 *   up to the oldest transaction still running (`pg_snapshot_xmin`), so a
 *   transaction that commits later is never skipped. `deleted` rows are the
 *   marks of a row that was deleted or left that scope (a session moved to
 *   another category): who saw it there reads the mark and gets a delete. `field_hlc` keeps the hybrid logical clock of each editable
 *   field (`SYNC_FIELD_COLUMNS`): the last writer per field wins.
 * - `sync_mutation`: the mutations a device pushed, by `client_uuid` (the
 *   `mutationId`): a replay of one already applied is answered without
 *   applying it again. Only its author reads it; nothing updates it.
 */

/** `xid8`: a full transaction id (no wraparound), compared as a number. Read as text. */
const xid8 = customType<{ data: string; driverData: string }>({
  dataType: () => 'xid8',
});

export const syncCollectionEnum = pgEnum('sync_collection', SYNC_COLLECTIONS);
export const syncOperationEnum = pgEnum('sync_operation', SYNC_OPERATIONS);
export const syncMutationOutcomeEnum = pgEnum('sync_mutation_outcome', SYNC_STORED_OUTCOMES);

/** HLC of each editable field of a row, by column name. */
export type FieldClocks = Readonly<Record<string, string>>;

const hlcPattern = sql.raw(`'${HLC_PATTERN.source}'`);

export const syncChange = pgTable(
  'sync_change',
  {
    ...tenantColumns(),
    collection: syncCollectionEnum('collection').notNull(),
    /** The synced row (a result for the change of one of its values). No foreign key: tombstones outlive it. */
    rowId: uuid('row_id').notNull(),
    /** The player the row belongs to (`NULL` for sessions): the scope of the entry, never changed. */
    playerId: uuid('player_id').$type<PlayerId>(),
    /**
     * Category and sport of a session row (`NULL` for player rows): the scope
     * of the entry, for the read policy. Never changed: a session that moves
     * marks this entry `deleted` and gets the entry of its new scope. No
     * foreign key either.
     */
    categoryId: uuid('category_id').$type<CategoryId>(),
    sport: sportEnum('sport'),
    /** The row is gone, or no longer in this scope. */
    deleted: boolean('deleted').notNull().default(false),
    /** Transaction of the last change (`pg_current_xact_id()`). */
    txid: xid8('txid')
      .notNull()
      .default(sql`pg_current_xact_id()`),
    /** Order within a transaction; a new value on every change. */
    seq: bigint('seq', { mode: 'number' }).notNull().generatedByDefaultAsIdentity(),
    fieldHlc: jsonb('field_hlc').notNull().default({}).$type<FieldClocks>(),
  },
  (t) => [
    ...tenantConstraints('sync_change', t),
    // One entry per row and per scope it was in: the entry of a scope the row left is a mark.
    unique('sync_change_scope_key')
      .on(t.clubId, t.collection, t.rowId, t.playerId, t.categoryId, t.sport)
      .nullsNotDistinct(),
    index('sync_change_cursor_idx').on(t.clubId, t.txid, t.seq),
    check('sync_change_field_hlc', sql`jsonb_typeof(${t.fieldHlc}) = 'object'`),
  ],
);

export const syncMutation = pgTable(
  'sync_mutation',
  {
    ...tenantColumns(),
    operation: syncOperationEnum('operation').notNull(),
    /** The clock the mutation was applied with (after the server's clamp). */
    hlc: text('hlc').notNull(),
    /** The clock the device sent, as received: to audit devices with their time wrong. */
    receivedHlc: text('received_hlc').notNull(),
    outcome: syncMutationOutcomeEnum('outcome').notNull(),
  },
  (t) => [
    ...tenantConstraints('sync_mutation', t),
    index('sync_mutation_created_at_idx').on(t.clubId, t.createdAt),
    check('sync_mutation_hlc_format', sql`${t.hlc} ~ ${hlcPattern}`),
    check('sync_mutation_received_hlc_format', sql`${t.receivedHlc} ~ ${hlcPattern}`),
  ],
);
