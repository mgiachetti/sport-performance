import {
  DATA_SUBJECT_REQUEST_KINDS,
  DATA_SUBJECT_REQUEST_NOTE_MAX_LENGTH,
  DATA_SUBJECT_REQUEST_STATUSES,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { timestamptz } from './columns.js';
import { membershipRoleEnum } from './enums.js';
import { tenantColumns, tenantConstraints } from './tenant.js';

/**
 * Rights of the data subject (Ley 25.326, arts. 14 to 16; B-329, ADR 0051).
 */

export const dataSubjectRequestKindEnum = pgEnum(
  'data_subject_request_kind',
  DATA_SUBJECT_REQUEST_KINDS,
);
export const dataSubjectRequestStatusEnum = pgEnum(
  'data_subject_request_status',
  DATA_SUBJECT_REQUEST_STATUSES,
);

/** Rows erased per table (`schema.table` → count), as `app.erase_player` reports them. */
export type ErasedRows = Readonly<Record<string, number>>;

/**
 * A request of the data subject about a player: an export (`access`,
 * recorded completed when delivered) or an erasure (`erasure`, pending until
 * the administration executes, rejects or someone cancels it).
 *
 * **It outlives the player.** `player_id` has no foreign key on purpose: the
 * request is the evidence that the erasure was asked for and done, so it stays
 * after `app.erase_player` deleted the player, with only the player's id (no
 * name or other data) and the number of rows erased per table. The same goes
 * for `medical.access_log` (ADR 0029).
 *
 * Writes: the API inserts (the holder or the administration, as themselves),
 * cancels and rejects under RLS; only `app.erase_player` completes an erasure.
 */
export const dataSubjectRequest = pgTable(
  'data_subject_request',
  {
    ...tenantColumns(),
    /** The player the request is about. No foreign key: it survives the erasure. */
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    kind: dataSubjectRequestKindEnum('kind').notNull(),
    status: dataSubjectRequestStatusEnum('status').notNull(),
    /** Who asked; `NULL` once their account is deleted. */
    requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
    /** The role they asked with: `player`, `parent` or `admin`. */
    requesterRole: membershipRoleEnum('requester_role').notNull(),
    /** Optional note of whoever asked (how the request arrived, e.g. on paper). */
    note: text('note'),
    resolvedAt: timestamptz('resolved_at'),
    resolvedBy: text('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    /** Why it was rejected or cancelled; required for a rejection. */
    resolutionNote: text('resolution_note'),
    /** Rows erased per table, for a completed erasure. */
    erasedRows: jsonb('erased_rows').$type<ErasedRows>(),
  },
  (t) => [
    ...tenantConstraints('data_subject_request', t),
    index('data_subject_request_player_idx').on(t.clubId, t.playerId, t.createdAt),
    index('data_subject_request_requested_by_idx').on(t.requestedBy),
    index('data_subject_request_status_idx').on(t.clubId, t.status, t.createdAt),
    // One pending erasure per player: asking again is a conflict.
    uniqueIndex('data_subject_request_pending_erasure_key')
      .on(t.clubId, t.playerId)
      .where(sql`${t.kind} = 'erasure' and ${t.status} = 'pending'`),
    check(
      'data_subject_request_requester_role',
      sql`${t.requesterRole} in ('player', 'parent', 'admin')`,
    ),
    // An export is recorded when it is delivered: never pending, rejected or cancelled.
    check(
      'data_subject_request_access_completed',
      sql`${t.kind} <> 'access' or ${t.status} = 'completed'`,
    ),
    check(
      'data_subject_request_resolution',
      sql`(${t.status} = 'pending') = (${t.resolvedAt} is null)
          and (${t.status} <> 'rejected' or btrim(coalesce(${t.resolutionNote}, '')) <> '')
          and (${t.erasedRows} is null or (${t.kind} = 'erasure' and ${t.status} = 'completed'))`,
    ),
    check(
      'data_subject_request_note_length',
      sql`char_length(coalesce(${t.note}, '')) <= ${sql.raw(String(DATA_SUBJECT_REQUEST_NOTE_MAX_LENGTH))}
          and char_length(coalesce(${t.resolutionNote}, '')) <= ${sql.raw(String(DATA_SUBJECT_REQUEST_NOTE_MAX_LENGTH))}`,
    ),
  ],
);
