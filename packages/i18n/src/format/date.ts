import {
  type Instant,
  type LocalDate,
  type TimeZone,
  localDateParts,
} from '@sport-performance/domain';
import { DEFAULT_LOCALE, type Locale } from '../locale.js';
import { PLACEHOLDER } from './number.js';

export interface DateFormatOptions {
  /**
   * IANA time zone of the club (`America/Argentina/Buenos_Aires`). Required: "the day" is always
   * computed in the club time zone, never in the device or server one.
   */
  readonly timeZone: TimeZone;
  readonly locale?: Locale;
}

export interface LongDateOptions {
  readonly locale?: Locale;
  /** Include the weekday (`lunes 3 de marzo de 2026`). Default `true`. */
  readonly weekday?: boolean;
  /** Include the year. Default `true`. */
  readonly year?: boolean;
}

type PartName = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'weekday';
type Parts = Partial<Record<PartName, string>>;

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormat(
  locale: Locale,
  timeZone: TimeZone,
  kind: 'numeric' | 'long',
): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${timeZone}|${kind}`;
  let format = dateTimeFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(
      locale,
      kind === 'numeric'
        ? {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }
        : { timeZone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
    );
    dateTimeFormats.set(cacheKey, format);
  }
  return format;
}

function toDate(instant: Instant): Date {
  const date = typeof instant === 'number' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  return date;
}

function partsOf(format: Intl.DateTimeFormat, date: Date): Parts {
  const parts: Parts = {};
  for (const part of format.formatToParts(date)) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'weekday'
    ) {
      parts[part.type] = part.value;
    }
  }
  return parts;
}

function numericParts(
  instant: Instant,
  options: DateFormatOptions,
): Required<Omit<Parts, 'weekday'>> {
  const parts = partsOf(
    getDateTimeFormat(options.locale ?? DEFAULT_LOCALE, options.timeZone, 'numeric'),
    toDate(instant),
  );
  const pad = (value: string | undefined): string => (value ?? '').padStart(2, '0');
  return {
    year: (parts.year ?? '').padStart(4, '0'),
    month: pad(parts.month),
    day: pad(parts.day),
    // Some engines render midnight as "24" even with h23; normalize.
    hour: parts.hour === '24' ? '00' : pad(parts.hour),
    minute: pad(parts.minute),
  };
}

/** `dd/mm/aaaa` in the club time zone (`03/03/2026`). `null`/`undefined` → {@link PLACEHOLDER}. */
export function formatDate(
  instant: Instant | null | undefined,
  options: DateFormatOptions,
): string {
  if (instant === null || instant === undefined) return PLACEHOLDER;
  const { day, month, year } = numericParts(instant, options);
  return `${day}/${month}/${year}`;
}

/** `HH:mm`, 24-hour clock, in the club time zone (`18:05`). */
export function formatTime(
  instant: Instant | null | undefined,
  options: DateFormatOptions,
): string {
  if (instant === null || instant === undefined) return PLACEHOLDER;
  const { hour, minute } = numericParts(instant, options);
  return `${hour}:${minute}`;
}

/** `dd/mm/aaaa HH:mm` in the club time zone (`03/03/2026 18:05`). */
export function formatDateTime(
  instant: Instant | null | undefined,
  options: DateFormatOptions,
): string {
  if (instant === null || instant === undefined) return PLACEHOLDER;
  const { day, month, year, hour, minute } = numericParts(instant, options);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function assembleLong(parts: Parts, options: LongDateOptions): string {
  const date = `${parts.day ?? ''} de ${parts.month ?? ''}`;
  const withYear = (options.year ?? true) ? `${date} de ${parts.year ?? ''}` : date;
  return (options.weekday ?? true) ? `${parts.weekday ?? ''} ${withYear}` : withYear;
}

/** Long date in the club time zone: `martes 3 de marzo de 2026`. */
export function formatDateLong(
  instant: Instant | null | undefined,
  options: DateFormatOptions & LongDateOptions,
): string {
  if (instant === null || instant === undefined) return PLACEHOLDER;
  const format = getDateTimeFormat(options.locale ?? DEFAULT_LOCALE, options.timeZone, 'long');
  return assembleLong(partsOf(format, toDate(instant)), options);
}

/**
 * `dd/mm/aaaa` for a calendar date (`2010-03-01` → `01/03/2010`). Pure string handling: it never
 * goes through a time zone, so a birth date cannot shift by one day. To get "the day" of an
 * instant in the club time zone, use `localDateInTimeZone` from `@sport-performance/domain`.
 */
export function formatLocalDate(value: LocalDate | null | undefined): string {
  if (value === null || value === undefined) return PLACEHOLDER;
  const { year, month, day } = localDateParts(value);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`;
}

/** Long form of a calendar date: `lunes 1 de marzo de 2010`. */
export function formatLocalDateLong(
  value: LocalDate | null | undefined,
  options: LongDateOptions = {},
): string {
  if (value === null || value === undefined) return PLACEHOLDER;
  const { year, month, day } = localDateParts(value);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  noonUtc.setUTCFullYear(year); // Date.UTC maps years 0–99 to 1900–1999
  const format = getDateTimeFormat(options.locale ?? DEFAULT_LOCALE, 'UTC' as TimeZone, 'long');
  return assembleLong(partsOf(format, noonUtc), options);
}
