import {
  PLAYER_REPORT_FAILURE_CODES,
  PLAYER_REPORT_STATUSES,
  type PlayerId,
  type PlayerReportFailureCode,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns.js';
import { file } from './files.js';
import { player } from './players.js';
import { testWindow } from './testing.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/** Life of a player report: pending, ready, failed (B-602). */
export const playerReportStatusEnum = pgEnum('player_report_status', PLAYER_REPORT_STATUSES);

/** Codes of the failures, from the domain (no personal data). */
const failureCodes = sql.raw(PLAYER_REPORT_FAILURE_CODES.map((code) => `'${code}'`).join(', '));

/**
 * The PDF report of a player for a test window (B-602, ADR 0069).
 *
 * - The API inserts it (`created_by` is who asked for it) with `content`: the
 *   snapshot of what the report shows, read when it was asked for with the
 *   rules of the player profile (ADR 0060) and versioned by `format_version`
 *   (`playerReportContentSchema` of `@sport-performance/contracts`). A trigger
 *   notifies the worker on commit.
 * - The worker renders it, uploads the PDF and records the `pdf_report` file
 *   (`file_id`, `generated_at`, `ready`), or gives up after its attempts
 *   (`failed` with `failure_code`). `next_attempt_at` delays a retry.
 * - The snapshot, the player and the window never change (`player_report_guard`);
 *   a finished report never changes status. Asking again makes a new report.
 *
 * Goes with the player: exported and erased with them (ADR 0051).
 */
export const playerReport = pgTable(
  'player_report',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    testWindowId: uuid('test_window_id').notNull(),
    status: playerReportStatusEnum('status').notNull().default('pending'),
    /** Version of `content` (`PLAYER_REPORT_FORMAT_VERSION` when it was written). */
    formatVersion: smallint('format_version').notNull(),
    /** What the report shows, frozen when it was asked for. */
    content: jsonb('content').notNull().$type<Readonly<Record<string, unknown>>>(),
    /** The PDF, once ready. */
    fileId: uuid('file_id'),
    generatedAt: timestamptz('generated_at'),
    attempts: smallint('attempts').notNull().default(0),
    /** A pending report is not taken before this instant (retry backoff). */
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    failureCode: text('failure_code').$type<PlayerReportFailureCode>(),
  },
  (t) => [
    ...tenantConstraints('player_report', t),
    tenantReference('player_report', t.clubId, t.playerId, player),
    tenantReference('player_report', t.clubId, t.testWindowId, testWindow),
    tenantReference('player_report', t.clubId, t.fileId, file),
    index('player_report_player_idx').on(t.clubId, t.playerId, t.createdAt),
    index('player_report_test_window_id_idx').on(t.clubId, t.testWindowId),
    index('player_report_file_id_idx')
      .on(t.clubId, t.fileId)
      .where(sql`${t.fileId} is not null`),
    // The worker's queue: what is pending and due.
    index('player_report_due_idx')
      .on(t.clubId, t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    check('player_report_format_version', sql`${t.formatVersion} >= 1`),
    check('player_report_content_object', sql`jsonb_typeof(${t.content}) = 'object'`),
    check('player_report_attempts', sql`${t.attempts} >= 0`),
    check(
      'player_report_ready',
      sql`(${t.status} = 'ready') = (${t.fileId} is not null and ${t.generatedAt} is not null)`,
    ),
    check(
      'player_report_failed',
      sql`(${t.status} = 'failed') = (${t.failureCode} is not null) and (${t.failureCode} is null or ${t.failureCode} in (${failureCodes}))`,
    ),
  ],
);
