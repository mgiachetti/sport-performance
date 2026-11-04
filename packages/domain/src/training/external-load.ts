import { memberGuard, memberParser } from '../enum.js';
import { RPE_CR10_MAX, RPE_CR10_MIN } from '../load/srpe.js';
import { addDays, compareLocalDates, type LocalDate } from '../time.js';

/**
 * External load (B-511, ADR 0084): what a player trains outside the club
 * (another sport, physical education at school, training on their own),
 * reported by the player with its type, minutes and CR-10 RPE. It adds to
 * the player's daily load with the mark "reported by the player", so the
 * ACWR reflects the real load; it is never mixed up with the club's
 * sessions (a row of its own, counted apart in the derived series).
 */

/**
 * Kind of external activity:
 *
 * - `physical_education`: the school's physical education class;
 * - `other_sport`: training or a match of another sport or club;
 * - `own_training`: training on their own (running, gym, a personal coach);
 * - `other`: anything else with physical load.
 */
export const EXTERNAL_LOAD_ACTIVITIES = [
  'physical_education',
  'other_sport',
  'own_training',
  'other',
] as const;
export type ExternalLoadActivity = (typeof EXTERNAL_LOAD_ACTIVITIES)[number];

export const isExternalLoadActivity = memberGuard(EXTERNAL_LOAD_ACTIVITIES);
export const parseExternalLoadActivity = memberParser(
  EXTERNAL_LOAD_ACTIVITIES,
  'invalid_argument',
  'external load activity',
);

/** Shortest and longest activity accepted, in minutes. */
export const EXTERNAL_LOAD_MINUTES_MIN = 1;
export const EXTERNAL_LOAD_MINUTES_MAX = 600;
/** Longest free-text detail of the activity ("Fútbol", "Natación"), in characters. */
export const EXTERNAL_LOAD_DETAIL_MAX_LENGTH = 60;
/** The RPE is the session's CR-10, in whole points (as the club's sessions). */
export const EXTERNAL_LOAD_RPE_MIN = RPE_CR10_MIN;
export const EXTERNAL_LOAD_RPE_MAX = RPE_CR10_MAX;

/**
 * Club days on which a player may report, correct or archive an activity:
 * today and the 6 days before. A weekend match is still reported on
 * Monday; an older one is not, because the load series it changes has
 * already been read by the staff for that week. Never a future day.
 */
export const EXTERNAL_LOAD_REPORT_WINDOW_DAYS = 7;

export function isWithinExternalLoadWindow(day: LocalDate, today: LocalDate): boolean {
  if (compareLocalDates(day, today) > 0) return false;
  return compareLocalDates(day, addDays(today, -(EXTERNAL_LOAD_REPORT_WINDOW_DAYS - 1))) >= 0;
}

/** First club day of the window that ends `today`. */
export function externalLoadWindowStart(today: LocalDate): LocalDate {
  return addDays(today, -(EXTERNAL_LOAD_REPORT_WINDOW_DAYS - 1));
}

export type ExternalLoadProblem = 'minutes_out_of_range' | 'rpe_out_of_range';

/** What is wrong with the minutes and RPE of an activity (empty when valid). */
export function externalLoadIssues(input: {
  readonly minutes: number;
  readonly rpe: number;
}): ExternalLoadProblem[] {
  const issues: ExternalLoadProblem[] = [];
  if (
    !Number.isInteger(input.minutes) ||
    input.minutes < EXTERNAL_LOAD_MINUTES_MIN ||
    input.minutes > EXTERNAL_LOAD_MINUTES_MAX
  ) {
    issues.push('minutes_out_of_range');
  }
  if (
    !Number.isInteger(input.rpe) ||
    input.rpe < EXTERNAL_LOAD_RPE_MIN ||
    input.rpe > EXTERNAL_LOAD_RPE_MAX
  ) {
    issues.push('rpe_out_of_range');
  }
  return issues;
}

/**
 * Load of an external activity, the same sRPE as a club session (Foster
 * et al. 2001): `RPE × minutes`, in arbitrary units. `null` when the input
 * is outside the accepted ranges.
 */
export function externalLoadAu(input: {
  readonly minutes: number;
  readonly rpe: number;
}): number | null {
  return externalLoadIssues(input).length === 0 ? input.rpe * input.minutes : null;
}
