import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DEFAULT_CLUB_TIME_ZONE,
  DomainValidationError,
  addDays,
  ageInCompletedYears,
  compareLocalDates,
  dayBoundsInTimeZone,
  dayBoundsRangeInTimeZone,
  daysBetween,
  decimalAgeYears,
  isLocalDate,
  isTimeZone,
  isoWeekday,
  localDate,
  localDateInTimeZone,
  localDateParts,
  localDateRange,
  parseLocalDate,
  parseTimeZone,
  startOfIsoWeek,
  type LocalDate,
  type TimeZone,
} from './index.js';

const d = (value: string): LocalDate => parseLocalDate(value);
const BUENOS_AIRES = parseTimeZone('America/Argentina/Buenos_Aires');
const SANTIAGO = parseTimeZone('America/Santiago');
const MADRID = parseTimeZone('Europe/Madrid');
const UTC = parseTimeZone('UTC');
const HOUR_MS = 3_600_000;

describe('TimeZone', () => {
  it.each(['America/Argentina/Buenos_Aires', 'America/Santiago', 'Europe/Madrid', 'UTC'])(
    'accepts %s and keeps the spelling',
    (zone) => {
      expect(isTimeZone(zone)).toBe(true);
      expect(parseTimeZone(zone)).toBe(zone);
    },
  );

  it.each(['Europe/Isle_of_Man', 'America/Port-au-Prince', 'America/Argentina/ComodRivadavia'])(
    'accepts the IANA spelling of %s',
    (zone) => {
      expect(parseTimeZone(zone)).toBe(zone);
    },
  );

  it.each([
    '',
    'Mars/Olympus',
    '+03:00',
    '-03:00',
    'America/',
    'GMT-3 ',
    3,
    null,
    // Fixed offsets and names without a region.
    'Etc/GMT+3',
    'Etc/UTC',
    'etc/gmt+3',
    'EST',
    'MST',
    'HST',
    'EST5EDT',
    'GMT',
    'Universal',
    'SystemV/AST4',
    // Intl accepts these case-insensitively; only the IANA spelling is stored.
    'america/argentina/buenos_aires',
    'America/Argentina/buenos_aires',
    'AMERICA/SANTIAGO',
    'europe/madrid',
    'Europe/Isle_Of_Man',
    'utc',
  ])('rejects %j', (zone) => {
    expect(isTimeZone(zone)).toBe(false);
    expect(() => parseTimeZone(zone)).toThrow(
      expect.objectContaining({ code: 'invalid_time_zone' }),
    );
  });

  it('defaults to the first tenant zone', () => {
    expect(isTimeZone(DEFAULT_CLUB_TIME_ZONE)).toBe(true);
    expect(DEFAULT_CLUB_TIME_ZONE).toBe('America/Argentina/Buenos_Aires');
  });
});

describe('LocalDate', () => {
  it.each(['2026-03-01', '2024-02-29', '0001-01-01', '9999-12-31'])('accepts %s', (value) => {
    expect(isLocalDate(value)).toBe(true);
    expect(parseLocalDate(value)).toBe(value);
  });

  it.each([
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-4-1',
    '2026-03-01T00:00:00Z',
    '0000-01-01',
    '20260301',
    '',
    20260301,
    new Date(0),
  ])('rejects %j', (value) => {
    expect(isLocalDate(value)).toBe(false);
    expect(() => parseLocalDate(value)).toThrow(DomainValidationError);
  });

  it('builds from and splits into parts', () => {
    expect(localDate(2026, 3, 1)).toBe('2026-03-01');
    expect(localDate(33, 7, 4)).toBe('0033-07-04');
    expect(localDateParts(d('2026-03-01'))).toEqual({ year: 2026, month: 3, day: 1 });
    expect(() => localDate(2026, 2, 30)).toThrow(DomainValidationError);
    expect(() => localDate(2026.5, 1, 1)).toThrow(DomainValidationError);
  });

  it('is not assignable from a plain string', () => {
    expectTypeOf<string>().not.toExtend<LocalDate>();
    expectTypeOf<LocalDate>().toExtend<string>();
    expectTypeOf<TimeZone>().not.toExtend<LocalDate>();
  });

  it('compares chronologically', () => {
    expect(compareLocalDates(d('2026-02-28'), d('2026-03-01'))).toBe(-1);
    expect(compareLocalDates(d('2026-03-01'), d('2026-03-01'))).toBe(0);
    expect(compareLocalDates(d('2027-01-01'), d('2026-12-31'))).toBe(1);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays(d('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
    expect(addDays(d('2026-03-01'), 0)).toBe('2026-03-01');
    expect(addDays(d('2026-01-01'), 365)).toBe('2027-01-01');
  });

  it('rejects fractional days and leaving the supported range', () => {
    expect(() => addDays(d('2026-01-01'), 0.5)).toThrow(DomainValidationError);
    expect(() => addDays(d('9999-12-31'), 1)).toThrow(DomainValidationError);
    expect(() => addDays(d('0001-01-01'), -1)).toThrow(DomainValidationError);
  });

  it('counts days between dates', () => {
    expect(daysBetween(d('2026-03-01'), d('2026-03-29'))).toBe(28);
    expect(daysBetween(d('2026-03-29'), d('2026-03-01'))).toBe(-28);
    expect(daysBetween(d('2024-01-01'), d('2025-01-01'))).toBe(366);
    // Calendar days are independent of any DST change.
    expect(daysBetween(d('2024-03-30'), d('2024-04-01'))).toBe(2);
  });

  it('lists an inclusive range of days', () => {
    expect(localDateRange(d('2026-02-27'), d('2026-03-02'))).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(localDateRange(d('2026-03-01'), d('2026-03-01'))).toEqual(['2026-03-01']);
    expect(localDateRange(d('2026-01-01'), d('2026-01-28'))).toHaveLength(28);
    expect(() => localDateRange(d('2026-03-02'), d('2026-03-01'))).toThrow(DomainValidationError);
  });

  it('computes ISO weekdays and week starts', () => {
    expect(isoWeekday(d('1970-01-01'))).toBe(4);
    expect(isoWeekday(d('2026-11-02'))).toBe(1);
    expect(isoWeekday(d('2026-11-01'))).toBe(7);
    expect(isoWeekday(d('1969-12-29'))).toBe(1);
    expect(startOfIsoWeek(d('2026-11-01'))).toBe('2026-10-26');
    expect(startOfIsoWeek(d('2026-11-02'))).toBe('2026-11-02');
    expect(startOfIsoWeek(d('2026-11-05'))).toBe('2026-11-02');
    expect(startOfIsoWeek(d('2027-01-01'))).toBe('2026-12-28');
  });
});

describe('localDateInTimeZone: "the day" is the club day', () => {
  it('maps a late-evening Buenos Aires instant to that evening, not to the UTC day', () => {
    const instant = new Date('2026-03-02T01:30:00Z'); // 22:30 on 1 March in Buenos Aires
    expect(localDateInTimeZone(instant, BUENOS_AIRES)).toBe('2026-03-01');
    expect(localDateInTimeZone(instant, UTC)).toBe('2026-03-02');
  });

  it('switches day exactly at club midnight', () => {
    const midnight = Date.parse('2026-03-02T03:00:00Z'); // 00:00 on 2 March in Buenos Aires
    expect(localDateInTimeZone(midnight - 1, BUENOS_AIRES)).toBe('2026-03-01');
    expect(localDateInTimeZone(midnight, BUENOS_AIRES)).toBe('2026-03-02');
  });

  it('accepts epoch milliseconds and dates before 1970', () => {
    expect(localDateInTimeZone(0, BUENOS_AIRES)).toBe('1969-12-31');
    expect(localDateInTimeZone(Date.parse('1960-06-15T12:00:00Z'), UTC)).toBe('1960-06-15');
  });

  it('rejects invalid instants', () => {
    expect(() => localDateInTimeZone(new Date(Number.NaN), BUENOS_AIRES)).toThrow(
      expect.objectContaining({ code: 'invalid_instant' }),
    );
    expect(() => localDateInTimeZone(Number.POSITIVE_INFINITY, UTC)).toThrow(DomainValidationError);
    expect(() => localDateInTimeZone(Date.parse('-000100-01-01T00:00:00Z'), UTC)).toThrow(
      DomainValidationError,
    );
  });
});

describe('dayBoundsInTimeZone', () => {
  it('is 24 h in Buenos Aires (no DST)', () => {
    const { start, end } = dayBoundsInTimeZone(d('2026-03-01'), BUENOS_AIRES);
    expect(start.toISOString()).toBe('2026-03-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-02T03:00:00.000Z');
  });

  it('covers the whole LocalDate range', () => {
    const first = dayBoundsInTimeZone(d('0001-01-01'), UTC);
    expect(first.start.toISOString()).toBe('0001-01-01T00:00:00.000Z');
    expect(first.end.toISOString()).toBe('0001-01-02T00:00:00.000Z');
    const last = dayBoundsInTimeZone(d('9999-12-31'), UTC);
    expect(last.start.toISOString()).toBe('9999-12-31T00:00:00.000Z');
    expect(last.end.toISOString()).toBe('+010000-01-01T00:00:00.000Z');
    for (const zone of [BUENOS_AIRES, SANTIAGO, MADRID]) {
      for (const day of [d('0001-01-01'), d('9998-12-31'), d('9999-12-31')]) {
        const { start, end } = dayBoundsInTimeZone(day, zone);
        expect(localDateInTimeZone(start, zone)).toBe(day);
        expect(localDateInTimeZone(end.getTime() - 1, zone)).toBe(day);
      }
      const first = dayBoundsInTimeZone(d('0001-01-01'), zone);
      expect(() => localDateInTimeZone(first.start.getTime() - 1, zone)).toThrow(
        expect.objectContaining({ code: 'invalid_instant' }),
      );
      const last = dayBoundsInTimeZone(d('9999-12-31'), zone);
      expect(() => localDateInTimeZone(last.end, zone)).toThrow(
        expect.objectContaining({ code: 'invalid_instant' }),
      );
    }
  });

  it('is 23 h when clocks spring forward (Madrid)', () => {
    const { start, end } = dayBoundsInTimeZone(d('2024-03-31'), MADRID);
    expect(start.toISOString()).toBe('2024-03-30T23:00:00.000Z');
    expect(end.toISOString()).toBe('2024-03-31T22:00:00.000Z');
  });

  it('is 25 h when clocks fall back (Madrid)', () => {
    const { start, end } = dayBoundsInTimeZone(d('2024-10-27'), MADRID);
    expect(start.toISOString()).toBe('2024-10-26T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR_MS);
  });

  it('starts at the transition when local midnight does not exist (Santiago)', () => {
    // On 2024-09-08 Chile jumped from 24:00 (−04) to 01:00 (−03).
    const { start, end } = dayBoundsInTimeZone(d('2024-09-08'), SANTIAGO);
    expect(start.toISOString()).toBe('2024-09-08T04:00:00.000Z');
    expect(end.toISOString()).toBe('2024-09-09T03:00:00.000Z');
    expect(localDateInTimeZone(start.getTime() - 1, SANTIAGO)).toBe('2024-09-07');
    expect(localDateInTimeZone(start, SANTIAGO)).toBe('2024-09-08');
    // The previous day ends exactly where this one starts.
    expect(dayBoundsInTimeZone(d('2024-09-07'), SANTIAGO).end).toEqual(start);
  });

  it('handles the 25 h day when Santiago falls back at midnight', () => {
    const { start, end } = dayBoundsInTimeZone(d('2024-04-06'), SANTIAGO);
    expect(start.toISOString()).toBe('2024-04-06T03:00:00.000Z');
    expect(end.toISOString()).toBe('2024-04-07T04:00:00.000Z');
  });

  it('is consistent with localDateInTimeZone on every day of a year', () => {
    for (const zone of [BUENOS_AIRES, SANTIAGO, MADRID]) {
      for (const day of localDateRange(d('2024-01-01'), d('2024-12-31'))) {
        const { start, end } = dayBoundsInTimeZone(day, zone);
        expect(localDateInTimeZone(start, zone)).toBe(day);
        expect(localDateInTimeZone(end.getTime() - 1, zone)).toBe(day);
        expect(localDateInTimeZone(start.getTime() - 1, zone)).toBe(addDays(day, -1));
      }
    }
  });
});

describe('dayBoundsRangeInTimeZone', () => {
  it('matches dayBoundsInTimeZone on every day, across DST changes', () => {
    for (const zone of [BUENOS_AIRES, SANTIAGO, MADRID]) {
      const range = dayBoundsRangeInTimeZone(d('2024-01-01'), d('2024-12-31'), zone);
      expect(range).toHaveLength(366);
      for (const bounds of range) {
        expect(bounds).toEqual({ date: bounds.date, ...dayBoundsInTimeZone(bounds.date, zone) });
      }
      expect(range.map((b) => b.date)).toEqual(localDateRange(d('2024-01-01'), d('2024-12-31')));
    }
  });

  it('returns one day for a single-day range and rejects reversed ranges', () => {
    expect(dayBoundsRangeInTimeZone(d('2026-03-01'), d('2026-03-01'), BUENOS_AIRES)).toEqual([
      { date: '2026-03-01', ...dayBoundsInTimeZone(d('2026-03-01'), BUENOS_AIRES) },
    ]);
    expect(() => dayBoundsRangeInTimeZone(d('2026-03-02'), d('2026-03-01'), UTC)).toThrow(
      DomainValidationError,
    );
  });
});

describe('ages', () => {
  it('computes decimal age as days / 365.25', () => {
    expect(decimalAgeYears(d('2012-03-01'), d('2026-03-01'))).toBeCloseTo(5113 / 365.25, 12);
    expect(decimalAgeYears(d('2012-03-01'), d('2012-03-01'))).toBe(0);
    expect(decimalAgeYears(d('2012-01-01'), d('2026-07-02'))).toBeCloseTo(14.5, 2);
  });

  it('computes completed years around the birthday', () => {
    expect(ageInCompletedYears(d('2012-03-15'), d('2026-03-14'))).toBe(13);
    expect(ageInCompletedYears(d('2012-03-15'), d('2026-03-15'))).toBe(14);
    expect(ageInCompletedYears(d('2012-12-31'), d('2026-01-01'))).toBe(13);
  });

  it('turns a year older on 1 March for 29 February birthdays in non-leap years', () => {
    expect(ageInCompletedYears(d('2012-02-29'), d('2026-02-28'))).toBe(13);
    expect(ageInCompletedYears(d('2012-02-29'), d('2026-03-01'))).toBe(14);
    expect(ageInCompletedYears(d('2012-02-29'), d('2028-02-29'))).toBe(16);
  });

  it('rejects dates before birth', () => {
    expect(() => decimalAgeYears(d('2012-03-01'), d('2012-02-29'))).toThrow(DomainValidationError);
    expect(() => ageInCompletedYears(d('2012-03-01'), d('2011-03-01'))).toThrow(
      DomainValidationError,
    );
  });
});
