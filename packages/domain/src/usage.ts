/**
 * Usage metrics (B-707, ADR 0093): first-party, privacy-respecting
 * instrumentation to measure adoption during the pilot and after it. No
 * third-party SDK in the apps (the player app is for minors): the API records
 * the use of a few surfaces when it serves them, and the outcomes (wellness
 * answered, RPE reported, test days loaded) are counted from the data itself.
 *
 * What is recorded per use is the minimum to count distinct active members:
 * the membership, its role, the club day, the surface and the client (web or
 * app). Never the content read, the player looked at, the
 * IP or the device. Per-member rows live {@link USAGE_ACTIVITY_RETENTION_DAYS}
 * days; then the worker folds whole weeks into anonymous weekly counts and
 * deletes them.
 */
import { memberGuard } from './enum.js';
import { addDays, startOfIsoWeek, type LocalDate } from './time.js';

/**
 * The surfaces whose use is recorded, each on one canonical read (a profile
 * view triggers several requests; only one of them records):
 *
 * - `panel`: the weekly panel of the staff (web, and the staff board of the app).
 * - `player_profile`: a player's profile opened by the staff (daily monitoring).
 * - `test_day_sheet`: the sheet of a test day (loading or reviewing results).
 * - `player_home`: the player's own home in the app.
 * - `guardian_home`: a guardian's list of their children.
 * - `kiosk`: the roster of the club's kiosk (B-504).
 */
export const USAGE_SURFACES = [
  'panel',
  'player_profile',
  'test_day_sheet',
  'player_home',
  'guardian_home',
  'kiosk',
] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];
export const isUsageSurface = memberGuard(USAGE_SURFACES);

/** Which client served the use: the staff web or the mobile app (its client headers, ADR 0045). */
export const USAGE_CLIENTS = ['web', 'app'] as const;
export type UsageClient = (typeof USAGE_CLIENTS)[number];
export const isUsageClient = memberGuard(USAGE_CLIENTS);

/**
 * Days a per-member activity row is kept. Weeks that ended this many days
 * ago or earlier are folded into the weekly counts (without members) and
 * their rows deleted: a 4-week pilot and a season's quarter fit with distinct
 * members, longer trends keep the counts.
 */
export const USAGE_ACTIVITY_RETENTION_DAYS = 91;

/**
 * Monday of the first week whose per-member rows are kept on `today` (club
 * day): every week before it ended at least {@link USAGE_ACTIVITY_RETENTION_DAYS}
 * days ago and is folded into the weekly counts. Whole weeks only, so a week
 * is either in the activity rows or in the weekly counts, never split.
 */
export function usageRetainedFrom(
  today: LocalDate,
  retentionDays: number = USAGE_ACTIVITY_RETENTION_DAYS,
): LocalDate {
  if (!Number.isInteger(retentionDays) || retentionDays < 7) {
    throw new RangeError('usageRetainedFrom: retentionDays must be an integer of at least 7.');
  }
  // The last day that may be folded is `today - retentionDays`; a week is folded when its
  // Sunday is on or before it, so the first kept week is the one of the day after.
  return startOfIsoWeek(addDays(today, 1 - retentionDays));
}

/** A share of a whole, `null` when there is nothing to divide by. Between 0 and 1. */
export function usageRate(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || part < 0 || whole < 0) {
    throw new RangeError('usageRate: counts must be finite and not negative.');
  }
  if (whole === 0) return null;
  return Math.min(1, part / whole);
}

/** Counts of the training outcomes of one category and week (see the summary endpoint). */
export interface TrainingAdoptionCounts {
  /** Distinct player-days with a session the player attended (full or partial). */
  readonly attendedPlayerDays: number;
  /** Of those, the ones with a wellness check-in that club day. */
  readonly attendedPlayerDaysWithWellness: number;
  /** Participations attended (full or partial). */
  readonly attendedParticipations: number;
  /** Of those, the ones with an RPE. */
  readonly participationsWithRpe: number;
}

export interface TrainingAdoptionRates {
  /** Share of attended player-days with wellness that day (pre-training check-in). */
  readonly wellnessOnSessionDays: number | null;
  /** Share of attended participations with an RPE. */
  readonly rpe: number | null;
}

/** The adoption rates of the training outcomes; `null` where nothing was expected. */
export function trainingAdoptionRates(counts: TrainingAdoptionCounts): TrainingAdoptionRates {
  return {
    wellnessOnSessionDays: usageRate(
      counts.attendedPlayerDaysWithWellness,
      counts.attendedPlayerDays,
    ),
    rpe: usageRate(counts.participationsWithRpe, counts.attendedParticipations),
  };
}
