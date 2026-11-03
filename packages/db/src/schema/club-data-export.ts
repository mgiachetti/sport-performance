import {
  CLUB_DATA_EXPORT_ERROR_CODES,
  CLUB_DATA_EXPORT_MAX_ATTEMPTS,
  CLUB_DATA_EXPORT_STATUSES,
  type ClubDataExportDataset,
  type ClubDataExportErrorCode,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { localDate, timestamptz } from './columns.js';
import { membershipRoleEnum } from './enums.js';
import { file } from './files.js';
import {
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';

/** CSV export of the club's data (B-608, ADR 0072). */
export const clubDataExportStatusEnum = pgEnum(
  'club_data_export_status',
  CLUB_DATA_EXPORT_STATUSES,
);

/**
 * Availability of each exported player on the day of the request, as
 * `medical.availability` gave it to the requester (status only, never the
 * cause): `playerId → { training, match }`.
 */
export type ClubDataExportAvailability = Readonly<
  Record<string, { readonly training: string; readonly match: string }>
>;

/** Rows written per dataset (`dataset → rows`), in the manifest too. */
export type ClubDataExportRowCounts = Readonly<Partial<Record<ClubDataExportDataset, number>>>;

function errorCodeList() {
  return sql.raw(CLUB_DATA_EXPORT_ERROR_CODES.map((code) => `'${code}'`).join(', '));
}

/**
 * A request for the club's data as CSV, and its result. The API inserts it
 * (`queued`) with the scope fixed by the permission matrix at that moment:
 * `player_ids` are the players the requester may export (their scope and a
 * current `data` consent), `availability` their availability that day. The
 * worker generates the ZIP, stores it as a `data_export` file and points at
 * it; `availability` is cleared then, the file keeps it.
 *
 * `player_ids` has no foreign key on purpose (it is a set, and the request
 * outlives a player): erasing a player removes them from it and deletes any
 * ready ZIP that includes them (trigger on `player`, migration `0037`).
 *
 * RLS: the requester reads their own; the administration, every export of
 * the club. Only the API inserts (as itself, `queued`); only the worker
 * changes the status.
 */
export const clubDataExport = pgTable(
  'club_data_export',
  {
    ...tenantColumns(),
    /** Who asked; `NULL` once their account is deleted. */
    requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
    /** The role they asked with: `sc` or `admin`. */
    requesterRole: membershipRoleEnum('requester_role').notNull(),
    status: clubDataExportStatusEnum('status').notNull().default('queued'),
    /** Datasets requested, in canonical order (`CLUB_DATA_EXPORT_DATASETS`). */
    datasets: text('datasets').array().notNull().$type<ClubDataExportDataset[]>(),
    /** Club days of the rows of the dated datasets, both inclusive; `NULL` = unbounded. */
    fromDate: localDate('from_date'),
    toDate: localDate('to_date'),
    /** The club's day of the request: the day of the availability column. */
    requestedOn: localDate('requested_on').notNull(),
    /** Players included, fixed at the request (scope + data consent). */
    playerIds: uuid('player_ids').array().notNull().$type<PlayerId[]>(),
    /** Players in the requester's scope left out for lack of a current data consent. */
    excludedPlayersN: integer('excluded_players_n').notNull().default(0),
    /** Availability snapshot; cleared once the ZIP is written. */
    availability: jsonb('availability').$type<ClubDataExportAvailability>(),
    attempts: smallint('attempts').notNull().default(0),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    fileId: uuid('file_id'),
    rowCounts: jsonb('row_counts').$type<ClubDataExportRowCounts>(),
    errorCode: text('error_code').$type<ClubDataExportErrorCode>(),
  },
  (t) => [
    ...tenantConstraints('club_data_export', t),
    tenantReference('club_data_export', t.clubId, t.fileId, file),
    tenantReferenceIndex('club_data_export', t.clubId, t.fileId),
    index('club_data_export_requested_by_idx').on(t.requestedBy),
    index('club_data_export_created_idx').on(t.clubId, t.createdAt),
    // What the worker takes next: queued, or running for too long.
    index('club_data_export_pending_idx')
      .on(t.clubId, t.createdAt)
      .where(sql`${t.status} in ('queued', 'running')`),
    check('club_data_export_requester_role', sql`${t.requesterRole} in ('sc', 'admin')`),
    check(
      'club_data_export_datasets',
      sql`cardinality(${t.datasets}) >= 1 and array_position(${t.datasets}, null) is null`,
    ),
    check(
      'club_data_export_range',
      sql`${t.fromDate} is null or ${t.toDate} is null or ${t.fromDate} <= ${t.toDate}`,
    ),
    check(
      'club_data_export_counts',
      sql`${t.excludedPlayersN} >= 0 and ${t.attempts} between 0 and ${sql.raw(String(CLUB_DATA_EXPORT_MAX_ATTEMPTS))}`,
    ),
    check(
      'club_data_export_lifecycle',
      sql`(${t.status} = 'queued' or ${t.startedAt} is not null)
          and (${t.status} in ('ready', 'failed')) = (${t.completedAt} is not null)
          and (${t.status} = 'ready') = (${t.fileId} is not null and ${t.rowCounts} is not null)
          and (${t.status} = 'failed') = (${t.errorCode} is not null)
          and (${t.availability} is null or ${t.status} in ('queued', 'running'))`,
    ),
    check(
      'club_data_export_error_code',
      sql`${t.errorCode} is null or ${t.errorCode} in (${errorCodeList()})`,
    ),
  ],
);
