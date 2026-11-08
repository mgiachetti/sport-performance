import {
  LOCATION_ERASURE_REASONS,
  LOCATION_ERASURE_STATUSES,
  type LocationErasedRows,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { timestamptz } from './columns.js';
import { player } from './players.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Location consent of the pod (B-913, ADR 0106).
 */

export const locationErasureStatusEnum = pgEnum(
  'location_erasure_status',
  LOCATION_ERASURE_STATUSES,
);
export const locationErasureReasonEnum = pgEnum(
  'location_erasure_reason',
  LOCATION_ERASURE_REASONS,
);

/**
 * The erasure of a player's position data after their `location` consent was
 * revoked: queued by the database in the transaction of the revocation
 * (trigger `consent_location_erasure`), completed by the worker, which deletes
 * the position traces and the `pod_raw` files and records here only how many
 * rows it deleted per table (`deleted_rows`). Tracked by the change history
 * (ADR 0030): its completion is the record, without the deleted data.
 *
 * Writes: never the application (no grants); the trigger inserts, the worker
 * completes.
 */
export const locationErasure = pgTable(
  'location_erasure',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    reason: locationErasureReasonEnum('reason').notNull(),
    status: locationErasureStatusEnum('status').notNull(),
    /** Who revoked the consent; `NULL` once their account is deleted. */
    requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
    completedAt: timestamptz('completed_at'),
    /** Rows deleted per table (`schema.table` → count), once completed. */
    deletedRows: jsonb('deleted_rows').$type<LocationErasedRows>(),
  },
  (t) => [
    ...tenantConstraints('location_erasure', t),
    tenantReference('location_erasure', t.clubId, t.playerId, player),
    index('location_erasure_player_idx').on(t.clubId, t.playerId, t.createdAt),
    index('location_erasure_requested_by_idx').on(t.requestedBy),
    // One pending erasure per player: revoking again while it is pending adds nothing.
    uniqueIndex('location_erasure_pending_key')
      .on(t.clubId, t.playerId)
      .where(sql`${t.status} = 'pending'`),
    check(
      'location_erasure_completion',
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null)
          and (${t.status} = 'completed') = (${t.deletedRows} is not null)`,
    ),
  ],
);
