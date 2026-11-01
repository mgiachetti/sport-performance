import { type TimeZone, parseLocalDate, parseTimeZone } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateLong,
  formatDateTime,
  formatLocalDate,
  formatLocalDateLong,
  formatTime,
} from './date.js';
import { PLACEHOLDER } from './number.js';

const club = { timeZone: parseTimeZone('America/Argentina/Buenos_Aires') }; // UTC-3, no DST
const utc = parseTimeZone('UTC');
const madrid = parseTimeZone('Europe/Madrid');

describe('formatDate / formatTime / formatDateTime', () => {
  it('formats dd/mm/aaaa and HH:mm in the club time zone', () => {
    const instant = new Date('2026-03-03T21:05:00Z');
    expect(formatDate(instant, club)).toBe('03/03/2026');
    expect(formatTime(instant, club)).toBe('18:05');
    expect(formatDateTime(instant, club)).toBe('03/03/2026 18:05');
  });

  it('computes the day in the club time zone, not UTC', () => {
    const lateNight = Date.UTC(2026, 2, 4, 2, 30); // 04/03 02:30 UTC = 03/03 23:30 in Buenos Aires
    expect(formatDate(lateNight, club)).toBe('03/03/2026');
    expect(formatDate(lateNight, { timeZone: utc })).toBe('04/03/2026');
    expect(formatDate(lateNight, { timeZone: madrid })).toBe('04/03/2026');
  });

  it('uses a 24-hour clock with 00 at midnight', () => {
    expect(formatTime(Date.UTC(2026, 0, 1, 3, 0), club)).toBe('00:00');
    expect(formatTime(Date.UTC(2026, 0, 1, 2, 59), club)).toBe('23:59');
    expect(formatTime(Date.UTC(2026, 0, 1, 15, 7), club)).toBe('12:07');
  });

  it('handles year boundaries', () => {
    expect(formatDateTime(Date.UTC(2027, 0, 1, 2, 0), club)).toBe('31/12/2026 23:00');
  });

  it('renders a placeholder for missing values and throws for invalid dates', () => {
    expect(formatDate(null, club)).toBe(PLACEHOLDER);
    expect(formatTime(undefined, club)).toBe(PLACEHOLDER);
    expect(formatDateTime(null, club)).toBe(PLACEHOLDER);
    expect(() => formatDate(new Date('nope'), club)).toThrow(RangeError);
    expect(() => formatDate(Number.NaN, club)).toThrow(RangeError);
  });

  it('rejects unknown time zones', () => {
    // The `TimeZone` brand normally rules this out; an unchecked cast still fails loudly.
    expect(() => formatDate(0, { timeZone: 'Mars/Olympus' as TimeZone })).toThrow(RangeError);
  });
});

describe('formatDateLong', () => {
  it('writes weekday, day, month and year in Spanish', () => {
    const instant = Date.UTC(2026, 2, 3, 15);
    expect(formatDateLong(instant, club)).toBe('martes 3 de marzo de 2026');
    expect(formatDateLong(instant, { ...club, weekday: false })).toBe('3 de marzo de 2026');
    expect(formatDateLong(instant, { ...club, year: false })).toBe('martes 3 de marzo');
  });

  it('uses the club day', () => {
    expect(formatDateLong(Date.UTC(2026, 2, 4, 2, 30), club)).toBe('martes 3 de marzo de 2026');
    expect(formatDateLong(null, club)).toBe(PLACEHOLDER);
  });
});

describe('local dates', () => {
  it('formats calendar dates without time zone shifts', () => {
    expect(formatLocalDate(parseLocalDate('2010-03-01'))).toBe('01/03/2010');
    expect(formatLocalDate(parseLocalDate('2012-02-29'))).toBe('29/02/2012');
    expect(formatLocalDate(parseLocalDate('0099-01-01'))).toBe('01/01/0099');
    expect(formatLocalDate(null)).toBe(PLACEHOLDER);
  });

  it('writes long calendar dates', () => {
    expect(formatLocalDateLong(parseLocalDate('2010-03-01'))).toBe('lunes 1 de marzo de 2010');
    expect(formatLocalDateLong(parseLocalDate('2026-12-31'), { weekday: false })).toBe(
      '31 de diciembre de 2026',
    );
    expect(formatLocalDateLong(undefined)).toBe(PLACEHOLDER);
  });
});
