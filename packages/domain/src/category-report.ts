import type { MetricDirection } from './codes.js';
import { changeIsImprovement } from './player-report.js';

/**
 * The PDF report of a category for a test window (B-603, ADR 0073), for the
 * staff and the club's sub-committee: how the group evolved, how much of the
 * battery was done and how many wellness and RPE questionnaires were
 * answered. Aggregates only: never a name, an id or a value of one player.
 * The staff asks for it; the API freezes what it shows (a versioned
 * snapshot) and the worker renders it into a `category_report` file, like
 * the player report (ADR 0071). Its life (`pending`, `ready`, `failed`), its
 * failure codes and its attempts are the player report's.
 */

/**
 * Version of the snapshot of a category report (`category_report.content`).
 * A change that a renderer of the previous version could not read bumps it;
 * the worker refuses a version it does not know (`invalid_content`).
 */
export const CATEGORY_REPORT_FORMAT_VERSION = 1;

/** Columns of the group's evolution: the report's window and up to this many − 1 before it. */
export const CATEGORY_REPORT_EVOLUTION_COLUMNS = 6;

/**
 * Fewest players behind an average or a count of changes: below it the
 * report tells neither the value nor how many there are (the minimum of the
 * category average of the player profile, ADR 0060). A report goes beyond
 * the platform (to the sub-committee), so nothing in it may come down to one
 * or two players.
 */
export const CATEGORY_REPORT_MIN_PLAYERS = 5;

/** How the players who have a value in two windows changed between them. */
export interface PairedChange {
  /** Players with a comparable value in both windows. */
  readonly paired: number;
  readonly improved: number;
  readonly worsened: number;
  /** The same value, or a metric without a better direction. */
  readonly unchanged: number;
}

/**
 * The change of each player between two windows, counted: `null` with fewer
 * than {@link CATEGORY_REPORT_MIN_PLAYERS} pairs (neither the counts nor how
 * many there are). The caller pairs only comparable values (the same
 * protocol version, principle 4).
 */
export function pairedChange(
  direction: MetricDirection,
  pairs: readonly { readonly previous: number; readonly current: number }[],
): PairedChange | null {
  if (pairs.length < CATEGORY_REPORT_MIN_PLAYERS) return null;
  let improved = 0;
  let worsened = 0;
  for (const { previous, current } of pairs) {
    const better = changeIsImprovement(direction, current, previous);
    if (better === true) improved += 1;
    else if (better === false) worsened += 1;
  }
  return {
    paired: pairs.length,
    improved,
    worsened,
    unchanged: pairs.length - improved - worsened,
  };
}

/**
 * The mean of one value per player, or `null` with fewer than
 * {@link CATEGORY_REPORT_MIN_PLAYERS} of them.
 */
export function groupAverage(values: readonly number[]): number | null {
  if (values.length < CATEGORY_REPORT_MIN_PLAYERS) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Answered over expected, as a percentage; `null` when nothing was expected. */
export function responseRatePct(answered: number, expected: number): number | null {
  if (!Number.isSafeInteger(answered) || !Number.isSafeInteger(expected) || answered < 0) {
    return null;
  }
  if (expected <= 0) return null;
  return (Math.min(answered, expected) / expected) * 100;
}
