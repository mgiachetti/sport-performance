import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors.js';
import type { LocalDate } from '../time.js';
import {
  FIXTURE_STATUSES,
  FIXTURE_VENUES,
  SEASON_MAX_DAYS,
  TEST_SESSION_STATUSES,
  defaultTestWindows,
  isFixtureVenue,
  isLocalTime,
  isTestWindowNumber,
  parseFixtureStatus,
  parseLocalTime,
  parseTestSessionStatus,
  seasonSpanProblem,
  spanContainsDate,
  spanContainsSpan,
  spanDays,
  spansOverlap,
  testWindowLabel,
  testWindowProblems,
  type TestWindowNumber,
  type TestWindowSpan,
} from './calendar.js';

const d = (value: string) => value as LocalDate;
const span = (startsOn: string, endsOn: string) => ({ startsOn: d(startsOn), endsOn: d(endsOn) });
const win = (id: string, number: TestWindowNumber, from: string, to: string): TestWindowSpan => ({
  id,
  number,
  ...span(from, to),
});

describe('spans', () => {
  it('count both ends', () => {
    expect(spanDays(span('2027-02-01', '2027-02-01'))).toBe(1);
    expect(spanDays(span('2027-02-01', '2027-02-28'))).toBe(28);
  });

  it('overlap when they share a day, ends included', () => {
    expect(spansOverlap(span('2027-02-01', '2027-02-10'), span('2027-02-10', '2027-02-20'))).toBe(
      true,
    );
    expect(spansOverlap(span('2027-02-01', '2027-02-10'), span('2027-02-11', '2027-02-20'))).toBe(
      false,
    );
    expect(spansOverlap(span('2027-02-05', '2027-02-06'), span('2027-02-01', '2027-02-28'))).toBe(
      true,
    );
  });

  it('contain dates and spans inclusively', () => {
    const season = span('2027-02-01', '2027-11-30');
    expect(spanContainsDate(season, d('2027-02-01'))).toBe(true);
    expect(spanContainsDate(season, d('2027-11-30'))).toBe(true);
    expect(spanContainsDate(season, d('2027-12-01'))).toBe(false);
    expect(spanContainsSpan(season, span('2027-11-01', '2027-11-30'))).toBe(true);
    expect(spanContainsSpan(season, span('2027-11-01', '2027-12-01'))).toBe(false);
  });
});

describe('seasonSpanProblem', () => {
  it('accepts a planning year, a leap one included', () => {
    expect(seasonSpanProblem(span('2027-02-01', '2027-11-30'))).toBeNull();
    expect(seasonSpanProblem(span('2028-01-01', '2028-12-31'))).toBeNull();
    expect(seasonSpanProblem(span('2027-03-01', '2027-03-01'))).toBeNull();
  });

  it('rejects inverted and longer than a year', () => {
    expect(seasonSpanProblem(span('2027-11-30', '2027-02-01'))).toBe('ends_before_start');
    expect(SEASON_MAX_DAYS).toBe(366);
    expect(seasonSpanProblem(span('2027-01-01', '2028-01-01'))).toBeNull();
    expect(seasonSpanProblem(span('2027-01-01', '2028-01-02'))).toBe('too_long');
  });
});

describe('test windows', () => {
  it('are labelled V1 to V4', () => {
    expect([1, 2, 3, 4].map((n) => testWindowLabel(n as TestWindowNumber))).toEqual([
      'V1',
      'V2',
      'V3',
      'V4',
    ]);
    expect(isTestWindowNumber(4)).toBe(true);
    expect(isTestWindowNumber(5)).toBe(false);
    expect(isTestWindowNumber('1')).toBe(false);
  });

  it('suggest February, April, July and November', () => {
    expect(defaultTestWindows(2028)).toEqual([
      { number: 1, startsOn: '2028-02-01', endsOn: '2028-02-29' },
      { number: 2, startsOn: '2028-04-01', endsOn: '2028-04-30' },
      { number: 3, startsOn: '2028-07-01', endsOn: '2028-07-31' },
      { number: 4, startsOn: '2028-11-01', endsOn: '2028-11-30' },
    ]);
  });

  const season = span('2027-02-01', '2027-11-30');

  it('accept the reference calendar inside its season', () => {
    const windows = defaultTestWindows(2027).map((w) => ({ ...w, id: `v${String(w.number)}` }));
    expect(testWindowProblems(season, windows)).toEqual([]);
    // Only some windows (a club that tests twice a year).
    expect(
      testWindowProblems(
        season,
        windows.filter((w) => w.number % 2 === 1),
      ),
    ).toEqual([]);
  });

  it('report windows outside the season, inverted or with a repeated number', () => {
    expect(
      testWindowProblems(season, [
        win('a', 1, '2027-01-25', '2027-02-10'),
        win('b', 2, '2027-04-10', '2027-04-01'),
        win('c', 3, '2027-07-01', '2027-07-15'),
        win('d', 3, '2027-08-01', '2027-08-15'),
      ]),
    ).toEqual([
      { kind: 'outside_season', id: 'a' },
      { kind: 'ends_before_start', id: 'b' },
      { kind: 'duplicate_number', id: 'c', otherId: 'd' },
    ]);
  });

  it('report overlaps and windows out of order', () => {
    expect(
      testWindowProblems(season, [
        win('v1', 1, '2027-02-01', '2027-02-28'),
        win('v2', 2, '2027-02-20', '2027-03-10'),
        win('v4', 4, '2027-06-01', '2027-06-10'),
        win('v3', 3, '2027-07-01', '2027-07-31'),
      ]),
    ).toEqual([
      { kind: 'overlaps', id: 'v1', otherId: 'v2' },
      { kind: 'out_of_order', id: 'v4', otherId: 'v3' },
    ]);
  });
});

describe('vocabularies', () => {
  it('have the fixture venues and statuses and the test session lifecycle', () => {
    expect(FIXTURE_VENUES).toEqual(['home', 'away', 'neutral']);
    expect(FIXTURE_STATUSES).toEqual(['scheduled', 'postponed', 'cancelled']);
    expect(TEST_SESSION_STATUSES).toEqual(['scheduled', 'in_progress', 'completed', 'cancelled']);
    expect(isFixtureVenue('home')).toBe(true);
    expect(isFixtureVenue('local')).toBe(false);
    expect(parseFixtureStatus('postponed')).toBe('postponed');
    expect(() => parseTestSessionStatus('done')).toThrow(DomainValidationError);
  });
});

describe('local times', () => {
  it('are HH:MM on a 24 h clock', () => {
    expect(isLocalTime('00:00')).toBe(true);
    expect(isLocalTime('15:30')).toBe(true);
    expect(isLocalTime('23:59')).toBe(true);
    for (const bad of ['24:00', '9:30', '15:60', '15:30:00', '', 1530]) {
      expect(isLocalTime(bad), String(bad)).toBe(false);
    }
  });

  it('parse the Postgres form with zero seconds', () => {
    expect(parseLocalTime('15:30:00')).toBe('15:30');
    expect(parseLocalTime('08:05')).toBe('08:05');
    expect(() => parseLocalTime('15:30:15')).toThrow(DomainValidationError);
    expect(() => parseLocalTime(null)).toThrow(DomainValidationError);
  });
});
