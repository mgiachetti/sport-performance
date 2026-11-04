import type { MetricDirection } from './codes.js';
import { memberGuard, memberParser } from './enum.js';

/**
 * The PDF report of a player for a test window (B-602, ADR 0071), for the
 * player and their family. The staff asks for it; the API freezes what it
 * shows (a versioned snapshot, read with the same rules as the player
 * profile) and the worker renders it into a `pdf_report` file.
 */

/**
 * Life of a report: `pending` (asked for, waiting for the worker), `ready`
 * (its PDF is a `pdf_report` file) or `failed` (the worker gave up after
 * {@link PLAYER_REPORT_MAX_ATTEMPTS}; asking again makes a new report).
 * `packages/db` builds the `player_report_status` enum from this constant.
 */
export const PLAYER_REPORT_STATUSES = ['pending', 'ready', 'failed'] as const;
export type PlayerReportStatus = (typeof PLAYER_REPORT_STATUSES)[number];
export const isPlayerReportStatus = memberGuard(PLAYER_REPORT_STATUSES);
export const parsePlayerReportStatus = memberParser(
  PLAYER_REPORT_STATUSES,
  'invalid_argument',
  'player report status',
);

/**
 * Why the worker gave up on a report, without personal data:
 * - `invalid_content`: the snapshot does not parse with the renderer's format
 *   (a format version the worker does not know).
 * - `render_failed`: the PDF could not be laid out.
 * - `too_large`: the PDF is bigger than the `pdf_report` file policy allows.
 * - `storage_failed`: the bucket did not take the object.
 * - `attempts_exhausted`: every attempt was claimed and none finished (the
 *   worker died while rendering it, for example): the claim gives up on it.
 * - `internal_error`: an unexpected error outside the layout (the database
 *   while recording the file or the outcome, for example).
 */
export const PLAYER_REPORT_FAILURE_CODES = [
  'invalid_content',
  'render_failed',
  'too_large',
  'storage_failed',
  'attempts_exhausted',
  'internal_error',
] as const;
export type PlayerReportFailureCode = (typeof PLAYER_REPORT_FAILURE_CODES)[number];
export const isPlayerReportFailureCode = memberGuard(PLAYER_REPORT_FAILURE_CODES);

/** Attempts of the worker before a report is `failed` (each one retried with backoff). */
export const PLAYER_REPORT_MAX_ATTEMPTS = 3;

/** Minutes before a failed attempt is tried again: `attempt × this` (5, 10 minutes). */
export const PLAYER_REPORT_RETRY_MINUTES = 5;

/**
 * Version of the snapshot of a report (`player_report.content`). A change
 * that a renderer of the previous version could not read bumps it; the
 * worker refuses a version it does not know (`invalid_content`).
 */
export const PLAYER_REPORT_FORMAT_VERSION = 1;

/** Columns of the evolution table: the report's window and up to this many before it. */
export const PLAYER_REPORT_EVOLUTION_COLUMNS = 6;

/**
 * Relative change from `previous` to `current`, as a percentage (`+3.2`,
 * `−1.5`); `null` when there is no previous value or it is zero.
 */
export function relativeChangePct(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0 || !Number.isFinite(previous)) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Whether a change is an improvement for a metric with this direction:
 * `true` better, `false` worse, `null` neutral metrics or no change.
 */
export function changeIsImprovement(
  direction: MetricDirection,
  current: number,
  previous: number,
): boolean | null {
  if (direction === 'neutral' || current === previous) return null;
  return direction === 'higher_is_better' ? current > previous : current < previous;
}
