import type { Brand } from './brand.js';
import { DomainValidationError, describeValue } from './errors.js';

/**
 * Time model.
 *
 * - An **instant** is a point on the UTC timeline (`Date` or epoch milliseconds).
 *   That is what the database and the sync queue store.
 * - A **{@link LocalDate}** is a calendar day with no time and no zone
 *   (`2026-03-01`). Daily aggregates (wellness, streaks, daily load, EWMA) are
 *   keyed by it.
 * - **"The day" is the club's day:** an instant is mapped to a `LocalDate` in
 *   the club's IANA {@link TimeZone}, never in the device's or the server's zone.
 */

/** IANA time zone name, canonicalised by the runtime (`America/Argentina/Buenos_Aires`). */
export type TimeZone = Brand<string, 'TimeZone'>;

/** ISO 8601 calendar date `YYYY-MM-DD` (years 0001–9999). Sorts lexicographically. */
export type LocalDate = Brand<string, 'LocalDate'>;

export type Instant = Date | number;

/** Default zone of the first tenant (ORC, Buenos Aires). Clubs configure their own. */
export const DEFAULT_CLUB_TIME_ZONE = 'America/Argentina/Buenos_Aires' as TimeZone;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

// ---------------------------------------------------------------------------
// TimeZone

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * Whether `value` is an IANA zone name known to the runtime. The name is kept
 * as given (runtimes disagree on canonical spellings, for example ICU still
 * resolves `America/Argentina/Buenos_Aires` to `America/Buenos_Aires`).
 * Fixed offsets (`+03:00`) are rejected: a club needs a region so that daylight
 * saving rules apply.
 */
export function isTimeZone(value: unknown): value is TimeZone {
  if (typeof value !== 'string' || !TIME_ZONE_PATTERN.test(value)) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

export function parseTimeZone(value: unknown): TimeZone {
  if (isTimeZone(value)) return value;
  throw new DomainValidationError(
    'invalid_time_zone',
    `Invalid IANA time zone: ${describeValue(value)}.`,
    value,
  );
}

// ---------------------------------------------------------------------------
// LocalDate

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface LocalDateParts {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function format(year: number, month: number, day: number): LocalDate {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}` as LocalDate;
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) return false;
  return isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function parseLocalDate(value: unknown): LocalDate {
  if (isLocalDate(value)) return value;
  throw new DomainValidationError(
    'invalid_local_date',
    `Invalid local date: ${describeValue(value)}. Expected an existing YYYY-MM-DD date.`,
    value,
  );
}

/** Builds a `LocalDate` from its parts (`month` is 1–12). */
export function localDate(year: number, month: number, day: number): LocalDate {
  if (!isValidCalendarDate(year, month, day)) {
    throw new DomainValidationError(
      'invalid_local_date',
      `Invalid local date: ${String(year)}-${String(month)}-${String(day)}.`,
      { year, month, day },
    );
  }
  return format(year, month, day);
}

export function localDateParts(date: LocalDate): LocalDateParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Days since 1970-01-01 (negative before). */
function toEpochDay(date: LocalDate): number {
  const { year, month, day } = localDateParts(date);
  return Math.round(utcMs(year, month, day) / MS_PER_DAY);
}

function fromEpochDay(epochDay: number): LocalDate {
  const date = new Date(epochDay * MS_PER_DAY);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) {
    throw new DomainValidationError(
      'invalid_local_date',
      'Date arithmetic left the supported range (years 0001–9999).',
      epochDay,
    );
  }
  return format(year, date.getUTCMonth() + 1, date.getUTCDate());
}

/** `Date.UTC` that also works for years 0–99 (which `Date.UTC` maps to 19xx). */
function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** Negative if `a` is before `b`, 0 if the same day, positive otherwise. */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  assertInteger(days, 'days');
  return fromEpochDay(toEpochDay(date) + days);
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/**
 * Every day from `from` to `to`, both inclusive. Used to fill days without
 * data (they count as 0 load). Throws if `to` is before `from`.
 */
export function localDateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const length = daysBetween(from, to) + 1;
  if (length < 1) {
    throw new DomainValidationError(
      'invalid_argument',
      `localDateRange: ${to} is before ${from}.`,
      { from, to },
    );
  }
  const start = toEpochDay(from);
  return Array.from({ length }, (_, i) => fromEpochDay(start + i));
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  // 1970-01-01 was a Thursday (ISO 4).
  const mod = (((toEpochDay(date) + 3) % 7) + 7) % 7;
  return mod + 1;
}

/** Monday of the ISO week containing `date` (weekly monotony and strain). */
export function startOfIsoWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

// ---------------------------------------------------------------------------
// Instants in the club's zone

/**
 * Supported instants: years 0002–9998 UTC. The margin around the `LocalDate`
 * range keeps every zone offset and the ±1 day DST probes inside it.
 */
const MIN_INSTANT_MS = utcMs(2, 1, 1);
const MAX_INSTANT_MS = utcMs(9999, 1, 1) - 1;

function toEpochMs(instant: Instant): number {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  if (!Number.isFinite(ms) || ms < MIN_INSTANT_MS || ms > MAX_INSTANT_MS) {
    throw new DomainValidationError(
      'invalid_instant',
      'Invalid instant: expected a finite time between years 0002 and 9998.',
      instant,
    );
  }
  return ms;
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function wallClock(epochMs: number, timeZone: TimeZone): WallClock {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(timeZone).formatToParts(toEpochMs(epochMs))) {
    values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/** UTC offset of `timeZone` at `epochMs`, in milliseconds (−3 h → −10 800 000). */
function offsetMs(epochMs: number, timeZone: TimeZone): number {
  const w = wallClock(epochMs, timeZone);
  const wallMs = utcMs(w.year, w.month, w.day, w.hour, w.minute, w.second);
  const truncated = epochMs - (((epochMs % 1000) + 1000) % 1000);
  return wallMs - truncated;
}

/** The club's calendar day of an instant. */
export function localDateInTimeZone(instant: Instant, timeZone: TimeZone): LocalDate {
  const w = wallClock(toEpochMs(instant), timeZone);
  return format(w.year, w.month, w.day);
}

/**
 * First instant of `date` in `timeZone`. Handles DST: when local midnight does
 * not exist (clocks jump from 23:59:59 to 01:00), the day starts at the jump.
 */
function startOfDayMs(date: LocalDate, timeZone: TimeZone): number {
  const { year, month, day } = localDateParts(date);
  const wallMidnight = utcMs(year, month, day);
  // At most one transition happens within ±1 day, so these two offsets
  // cover every candidate.
  const offsetBefore = offsetMs(wallMidnight - MS_PER_DAY, timeZone);
  const offsetAfter = offsetMs(wallMidnight + MS_PER_DAY, timeZone);
  const candidates = [wallMidnight - offsetBefore, wallMidnight - offsetAfter].filter(
    (t) => offsetMs(t, timeZone) === wallMidnight - t,
  );
  if (candidates.length > 0) return Math.min(...candidates);
  // Midnight falls in a DST gap: the day starts at the transition instant.
  return wallMidnight - offsetBefore;
}

export interface DayBounds {
  /** First instant of the day (inclusive). */
  readonly start: Date;
  /** First instant of the next day (exclusive). */
  readonly end: Date;
}

/**
 * The club's day as a half-open UTC interval `[start, end)`, for querying
 * instants that belong to `date`. Usually 24 h; 23 h or 25 h on DST changes.
 */
export function dayBoundsInTimeZone(date: LocalDate, timeZone: TimeZone): DayBounds {
  return {
    start: new Date(startOfDayMs(date, timeZone)),
    end: new Date(startOfDayMs(addDays(date, 1), timeZone)),
  };
}

// ---------------------------------------------------------------------------
// Age

/**
 * Decimal age in years, `days / 365.25` (the convention of the maturity-offset
 * equations, which take "edad decimal").
 */
export function decimalAgeYears(birthDate: LocalDate, onDate: LocalDate): number {
  const days = daysBetween(birthDate, onDate);
  assertNotBeforeBirth(days, birthDate, onDate);
  return days / DAYS_PER_YEAR;
}

/**
 * Age in completed years. Someone born on 29 February turns a year older on
 * 1 March in non-leap years.
 */
export function ageInCompletedYears(birthDate: LocalDate, onDate: LocalDate): number {
  assertNotBeforeBirth(daysBetween(birthDate, onDate), birthDate, onDate);
  const birth = localDateParts(birthDate);
  const on = localDateParts(onDate);
  const hadBirthday = on.month > birth.month || (on.month === birth.month && on.day >= birth.day);
  return on.year - birth.year - (hadBirthday ? 0 : 1);
}

function assertNotBeforeBirth(days: number, birthDate: LocalDate, onDate: LocalDate): void {
  if (days < 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `Date ${onDate} is before birth date ${birthDate}.`,
      { birthDate, onDate },
    );
  }
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be an integer, got ${describeValue(value)}.`,
      value,
    );
  }
}
