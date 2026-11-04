import type { SyncCollection, SyncOperation } from '@sport-performance/domain';
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Local database of the app (B-502, ADR 0015, ADR 0069). The migrations in
 * `migrations.ts` create exactly these tables (a test checks it). Times are
 * epoch milliseconds; JSON columns are `TEXT`.
 *
 * Every row of club data belongs to a membership (`sync_scope`): one user in
 * one club with one role, the scope of `X-Membership-Id` and of what the
 * server lets that membership see. Deleting a scope deletes its rows.
 */

/**
 * What belongs to the installation and not to a person: the HLC node and
 * the last clock stamped (ADR 0050), and the user whose data the device
 * holds. Survives signing out.
 */
export const deviceMeta = sqliteTable('device_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** One membership the device syncs: its pull cursor and when it last synced. */
export const syncScope = sqliteTable('sync_scope', {
  membershipId: text('membership_id').primaryKey(),
  userId: text('user_id').notNull(),
  /** Opaque cursor of `GET /v1/sync/changes`; `null` before the first pull. */
  cursor: text('cursor'),
  /** Collections the cursor covers (JSON array): a different set starts over. */
  collections: text('collections'),
  lastPushedAt: integer('last_pushed_at'),
  lastPulledAt: integer('last_pulled_at'),
  /** End of the last cycle that pushed the whole queue and pulled to the end. */
  lastSyncedAt: integer('last_synced_at'),
  createdAt: integer('created_at').notNull(),
});

/**
 * Rows as the server last served them in a pull: the DTO of the collection's
 * read endpoint (`data`), plus the columns screens filter by. Never written
 * by a local edit: pending edits stay in the queue and are laid over on
 * read (`local-store.ts`), so a pull never loses them and never fights them.
 */
export const syncedRow = sqliteTable(
  'synced_row',
  {
    membershipId: text('membership_id').notNull(),
    collection: text('collection').$type<SyncCollection>().notNull(),
    id: text('id').notNull(),
    clientUuid: text('client_uuid'),
    /** The player of a player row (wellness, participation, result). */
    playerId: text('player_id'),
    /** The session of a participation or a result. */
    parentId: text('parent_id'),
    categoryId: text('category_id'),
    /** The club day of the row (`localDate`, `scheduledOn`, `measuredOn`). */
    localDate: text('local_date'),
    data: text('data').notNull(),
    pulledAt: integer('pulled_at').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'synced_row_pk',
      columns: [table.membershipId, table.collection, table.id],
    }),
    foreignKey({
      name: 'synced_row_scope_fk',
      columns: [table.membershipId],
      foreignColumns: [syncScope.membershipId],
    }).onDelete('cascade'),
    index('synced_row_client_uuid_idx').on(table.membershipId, table.collection, table.clientUuid),
    index('synced_row_player_idx').on(
      table.membershipId,
      table.collection,
      table.playerId,
      table.localDate,
    ),
    index('synced_row_parent_idx').on(table.membershipId, table.collection, table.parentId),
    index('synced_row_date_idx').on(table.membershipId, table.collection, table.localDate),
  ],
);

export const MUTATION_STATES = ['pending', 'acked'] as const;
/**
 * `pending`: not answered yet. `acked`: the server applied it; it stays laid
 * over its rows until a pull brings them (or a while after a full pull), so
 * the screen never jumps back to the old value in between.
 */
export type MutationState = (typeof MUTATION_STATES)[number];

/** The queue (ADR 0015): one write per row, pushed in `seq` order. */
export const mutation = sqliteTable(
  'mutation',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    membershipId: text('membership_id').notNull(),
    mutationId: text('mutation_id').notNull(),
    op: text('op').$type<SyncOperation>().notNull(),
    hlc: text('hlc').notNull(),
    /** `{ params?, target?, body }` of the operation (JSON), as it is pushed. */
    input: text('input').notNull(),
    /** Rows it writes (JSON `MutationTarget[]`), to lay it over and to clear it. */
    targets: text('targets').notNull(),
    state: text('state').$type<MutationState>().notNull(),
    /** Pushes that got no answer about it (network, `5xx`). */
    attempts: integer('attempts').notNull(),
    createdAt: integer('created_at').notNull(),
    ackedAt: integer('acked_at'),
  },
  (table) => [
    uniqueIndex('mutation_mutation_id_key').on(table.mutationId),
    index('mutation_scope_state_idx').on(table.membershipId, table.state, table.seq),
    foreignKey({
      name: 'mutation_scope_fk',
      columns: [table.membershipId],
      foreignColumns: [syncScope.membershipId],
    }).onDelete('cascade'),
  ],
);

export const SYNC_ISSUE_KINDS = ['rejected', 'superseded'] as const;
/**
 * `rejected`: the server answered the error the online endpoint gives; it
 * was not applied. `superseded`: some or all of its fields lost to a later
 * edit by someone else.
 */
export type SyncIssueKind = (typeof SYNC_ISSUE_KINDS)[number];

/** What the user has to see about a mutation that left the queue (until dismissed). */
export const syncIssue = sqliteTable(
  'sync_issue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    membershipId: text('membership_id').notNull(),
    mutationId: text('mutation_id').notNull(),
    op: text('op').$type<SyncOperation>().notNull(),
    kind: text('kind').$type<SyncIssueKind>().notNull(),
    /** API error code of a rejection (`conflict`, `forbidden`…). */
    errorCode: text('error_code'),
    /** Paths of the fields the error points at (JSON array of strings). */
    errorPaths: text('error_paths'),
    /** Fields that lost (JSON array), for `superseded`. */
    fields: text('fields'),
    /** The input of the mutation (JSON), to show what was not applied. */
    input: text('input').notNull(),
    /** When it was recorded on the device. */
    recordedAt: integer('recorded_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('sync_issue_scope_idx').on(table.membershipId, table.id),
    foreignKey({
      name: 'sync_issue_scope_fk',
      columns: [table.membershipId],
      foreignColumns: [syncScope.membershipId],
    }).onDelete('cascade'),
  ],
);

/**
 * Reads that are not sync collections, kept for using the app offline
 * (ADR 0073): the sheet of a test day, the club's categories and time
 * zone, the settings of a station on this phone. One JSON document per
 * membership and key, replaced whole by the next successful read. Belongs
 * to its membership like every club row: signing out deletes it.
 */
export const cachedRead = sqliteTable(
  'cached_read',
  {
    membershipId: text('membership_id').notNull(),
    key: text('key').notNull(),
    data: text('data').notNull(),
    /** When it was read from the server (or written on the phone). */
    fetchedAt: integer('fetched_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'cached_read_pk', columns: [table.membershipId, table.key] }),
    foreignKey({
      name: 'cached_read_scope_fk',
      columns: [table.membershipId],
      foreignColumns: [syncScope.membershipId],
    }).onDelete('cascade'),
  ],
);

export const localSchema = { deviceMeta, syncScope, syncedRow, mutation, syncIssue, cachedRead };
