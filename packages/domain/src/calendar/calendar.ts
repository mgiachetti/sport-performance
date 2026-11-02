import { memberGuard, memberParser } from '../enum.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { addDays, compareLocalDates, daysBetween, localDate, type LocalDate } from '../time.js';

/**
 * The club's calendar (B-317): seasons per sport, testing windows V1–V4,
 * scheduled test days and the fixture (matches).
 *
 * Every date is a calendar day of the club (`LocalDate`, in the club's time
 * zone). Seasons and windows are calendar spans: `startsOn` and `endsOn`, both
 * inclusive.
 *
 * A season is the planning year of a sport, so it holds its four windows:
 * the competition runs March–October, but V1 is in February (pre-season) and
 * V4 in November (CLAUDE.md, "Calendario"); the club sets the exact dates.
 */

/** A calendar span: both ends inclusive. */
export interface DateSpan {
  readonly startsOn: LocalDate;
  readonly endsOn: LocalDate;
}

/** Longest season: one year (366 days, leap years included). */
export const SEASON_MAX_DAYS = 366;

/** Window numbers: 1 = V1 … 4 = V4. */
export const TEST_WINDOW_NUMBERS = [1, 2, 3, 4] as const;
export type TestWindowNumber = (typeof TEST_WINDOW_NUMBERS)[number];

export function isTestWindowNumber(value: unknown): value is TestWindowNumber {
  return typeof value === 'number' && (TEST_WINDOW_NUMBERS as readonly number[]).includes(value);
}

/** `V1` … `V4`: how the staff names the windows. */
export function testWindowLabel(number: TestWindowNumber): `V${TestWindowNumber}` {
  return `V${String(number)}` as `V${TestWindowNumber}`;
}

/**
 * Month of each window in the reference calendar (CLAUDE.md): V1 February
 * (full battery + mobility + reaction and neck baselines), V2 April, V3 July
 * (full battery), V4 November. A suggestion for the club, which sets the dates.
 */
export const DEFAULT_TEST_WINDOW_MONTHS: Readonly<Record<TestWindowNumber, number>> = {
  1: 2,
  2: 4,
  3: 7,
  4: 11,
};

/** The reference windows of a year, each spanning its whole month. */
export function defaultTestWindows(
  year: number,
): readonly (DateSpan & { readonly number: TestWindowNumber })[] {
  return TEST_WINDOW_NUMBERS.map((number) => {
    const month = DEFAULT_TEST_WINDOW_MONTHS[number];
    const startsOn = localDate(year, month, 1);
    const nextMonth = month === 12 ? localDate(year + 1, 1, 1) : localDate(year, month + 1, 1);
    return { number, startsOn, endsOn: addDays(nextMonth, -1) };
  });
}

/** Days of a span, both ends counted (a one-day span has 1). */
export function spanDays(span: DateSpan): number {
  return daysBetween(span.startsOn, span.endsOn) + 1;
}

/** Whether two spans share at least one day. */
export function spansOverlap(a: DateSpan, b: DateSpan): boolean {
  return (
    compareLocalDates(a.startsOn, b.endsOn) <= 0 && compareLocalDates(b.startsOn, a.endsOn) <= 0
  );
}

/** Whether `date` falls in the span. */
export function spanContainsDate(span: DateSpan, date: LocalDate): boolean {
  return compareLocalDates(span.startsOn, date) <= 0 && compareLocalDates(date, span.endsOn) <= 0;
}

/** Whether `inner` lies entirely within `outer`. */
export function spanContainsSpan(outer: DateSpan, inner: DateSpan): boolean {
  return spanContainsDate(outer, inner.startsOn) && spanContainsDate(outer, inner.endsOn);
}

/**
 * Problems of a season span:
 * - `ends_before_start`: `endsOn` is before `startsOn`;
 * - `too_long`: more than {@link SEASON_MAX_DAYS} days.
 */
export type SeasonSpanProblem = 'ends_before_start' | 'too_long';

export function seasonSpanProblem(span: DateSpan): SeasonSpanProblem | null {
  if (compareLocalDates(span.endsOn, span.startsOn) < 0) return 'ends_before_start';
  if (spanDays(span) > SEASON_MAX_DAYS) return 'too_long';
  return null;
}

/** A window of a season, as the checks need it. `id` is opaque (a database id). */
export interface TestWindowSpan extends DateSpan {
  readonly id: string;
  readonly number: TestWindowNumber;
}

/**
 * A problem of one window against its season and the other windows:
 * - `ends_before_start`: its own span is inverted;
 * - `outside_season`: it does not lie within the season;
 * - `duplicate_number`: another window has its number;
 * - `overlaps`: it shares days with another window (`otherId`);
 * - `out_of_order`: it is not after the windows with a lower number, or
 *   not before those with a higher one (V2 comes after V1).
 */
export type TestWindowProblem =
  | { readonly kind: 'ends_before_start'; readonly id: string }
  | { readonly kind: 'outside_season'; readonly id: string }
  | { readonly kind: 'duplicate_number'; readonly id: string; readonly otherId: string }
  | { readonly kind: 'overlaps'; readonly id: string; readonly otherId: string }
  | { readonly kind: 'out_of_order'; readonly id: string; readonly otherId: string };

/**
 * Checks the windows of a season (the active ones). Every pair is checked
 * once; the problems come in a stable order: per window, in input order.
 * An empty list means the plan is valid.
 */
export function testWindowProblems(
  season: DateSpan,
  windows: readonly TestWindowSpan[],
): TestWindowProblem[] {
  const problems: TestWindowProblem[] = [];
  windows.forEach((window, index) => {
    if (compareLocalDates(window.endsOn, window.startsOn) < 0) {
      problems.push({ kind: 'ends_before_start', id: window.id });
      return;
    }
    if (!spanContainsSpan(season, window)) problems.push({ kind: 'outside_season', id: window.id });
    for (const other of windows.slice(index + 1)) {
      if (compareLocalDates(other.endsOn, other.startsOn) < 0) continue;
      if (other.number === window.number) {
        problems.push({ kind: 'duplicate_number', id: window.id, otherId: other.id });
      } else if (spansOverlap(window, other)) {
        problems.push({ kind: 'overlaps', id: window.id, otherId: other.id });
      } else {
        const [earlier, later] = window.number < other.number ? [window, other] : [other, window];
        if (compareLocalDates(earlier.endsOn, later.startsOn) >= 0) {
          problems.push({ kind: 'out_of_order', id: window.id, otherId: other.id });
        }
      }
    }
  });
  return problems;
}

/**
 * Where a match is played, from the club's point of view. `neutral` is a
 * third venue (tournaments, finals).
 */
export const FIXTURE_VENUES = ['home', 'away', 'neutral'] as const;
export type FixtureVenue = (typeof FIXTURE_VENUES)[number];
export const isFixtureVenue = memberGuard(FIXTURE_VENUES);
export const parseFixtureVenue = memberParser(FIXTURE_VENUES, 'invalid_argument', 'fixture venue');

/**
 * State of a match of the fixture. A played match is a `training_session`
 * of kind `match` (B-318), with its participation and load.
 */
export const FIXTURE_STATUSES = ['scheduled', 'postponed', 'cancelled'] as const;
export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];
export const isFixtureStatus = memberGuard(FIXTURE_STATUSES);
export const parseFixtureStatus = memberParser(
  FIXTURE_STATUSES,
  'invalid_argument',
  'fixture status',
);

/** Lifecycle of a scheduled test day (B-317 schedules it, B-320 runs it). */
export const TEST_SESSION_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type TestSessionStatus = (typeof TEST_SESSION_STATUSES)[number];
export const isTestSessionStatus = memberGuard(TEST_SESSION_STATUSES);
export const parseTestSessionStatus = memberParser(
  TEST_SESSION_STATUSES,
  'invalid_argument',
  'test session status',
);

/** Wall-clock time of the club, minutes precision: `HH:MM`, 00:00 to 23:59. */
export const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isLocalTime(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_TIME_PATTERN.test(value);
}

/** Parses `HH:MM` (or `HH:MM:SS` with zero seconds, as Postgres prints a `time`) into `HH:MM`. */
export function parseLocalTime(value: unknown): string {
  if (typeof value === 'string') {
    const short = /^\d{2}:\d{2}:00$/.test(value) ? value.slice(0, 5) : value;
    if (isLocalTime(short)) return short;
  }
  throw new DomainValidationError(
    'invalid_argument',
    `Invalid local time: ${describeValue(value)}. Expected HH:MM.`,
    value,
  );
}
