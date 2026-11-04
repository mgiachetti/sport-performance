import type { RosterImportRowOutcome } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { tenantColumns, tenantConstraints } from './tenant.js';

/**
 * Record of a roster import (padrón, B-330, ADR 0047): who imported, when,
 * how many rows were created, updated or skipped, what happened to their
 * guardians, and the outcome of each row with the player's id. Never the
 * names, birth dates or emails of the spreadsheet: those live in the profiles
 * they created, under their own access rules.
 *
 * `client_uuid` is the batch's: re-sending the same import returns this
 * record (`request_sha256` tells a retry from another import with the same
 * `clientUuid`). A record, not data to edit: the application has no `UPDATE`
 * (migration 0022) and nothing deletes it. Only the administration reads it.
 */
export const rosterImport = pgTable(
  'roster_import',
  {
    ...tenantColumns(),
    /** SHA-256 (hex) of the canonical request body: a retry has the same one. */
    requestSha256: text('request_sha256').notNull(),
    rowCount: integer('row_count').notNull(),
    createdCount: integer('created_count').notNull(),
    updatedCount: integer('updated_count').notNull(),
    skippedCount: integer('skipped_count').notNull(),
    guardiansLinkedCount: integer('guardians_linked_count').notNull(),
    invitationsToSendCount: integer('invitations_to_send_count').notNull(),
    /** One {@link RosterImportRowOutcome} per row, in the order of the request. */
    outcomes: jsonb('outcomes').notNull().$type<RosterImportRowOutcome[]>(),
  },
  (t) => [
    ...tenantConstraints('roster_import', t),
    index('roster_import_created_at_idx').on(t.clubId, t.createdAt),
    check('roster_import_request_sha256_format', sql`${t.requestSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'roster_import_counts',
      sql`${t.rowCount} >= 1 and ${t.createdCount} >= 0 and ${t.updatedCount} >= 0 and ${t.skippedCount} >= 0 and ${t.createdCount} + ${t.updatedCount} + ${t.skippedCount} = ${t.rowCount} and ${t.guardiansLinkedCount} >= 0 and ${t.invitationsToSendCount} >= 0`,
    ),
    check(
      'roster_import_outcomes_array',
      sql`jsonb_typeof(${t.outcomes}) = 'array' and jsonb_array_length(${t.outcomes}) = ${t.rowCount}`,
    ),
  ],
);
