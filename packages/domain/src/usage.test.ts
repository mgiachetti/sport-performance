import { describe, expect, it } from 'vitest';
import { daysBetween, isoWeekday, type LocalDate } from './time.js';
import {
  USAGE_ACTIVITY_RETENTION_DAYS,
  isUsageClient,
  isUsageSurface,
  trainingAdoptionRates,
  usageRate,
  usageRetainedFrom,
} from './usage.js';

const day = (value: string) => value as LocalDate;

describe('usageRetainedFrom', () => {
  it('keeps whole weeks: the first kept week is a Monday', () => {
    for (const today of ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-08']) {
      expect(isoWeekday(usageRetainedFrom(day(today)))).toBe(1);
    }
  });

  it('folds a week only once its Sunday is the retention days ago', () => {
    // 2026-11-04 - 91 days = 2026-08-05 (Wednesday): its week (03/08 to 09/08) is kept.
    expect(usageRetainedFrom(day('2026-11-04'))).toBe('2026-08-03');
    // 2026-11-08 - 91 days = 2026-08-09 (Sunday): that week is folded.
    expect(usageRetainedFrom(day('2026-11-08'))).toBe('2026-08-10');
    // A day earlier its Sunday is only 90 days ago.
    expect(usageRetainedFrom(day('2026-11-07'))).toBe('2026-08-03');
  });

  it('never folds a week younger than the retention, nor keeps one older than a week more', () => {
    for (const today of ['2026-11-02', '2026-11-04', '2026-11-08']) {
      const lastFoldedSunday = day(
        new Date(Date.parse(`${usageRetainedFrom(day(today))}T00:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
      const age = daysBetween(lastFoldedSunday, day(today));
      expect(age).toBeGreaterThanOrEqual(USAGE_ACTIVITY_RETENTION_DAYS);
      expect(age).toBeLessThan(USAGE_ACTIVITY_RETENTION_DAYS + 7);
    }
  });

  it('rejects a retention shorter than a week', () => {
    expect(() => usageRetainedFrom(day('2026-11-04'), 6)).toThrow(RangeError);
    expect(() => usageRetainedFrom(day('2026-11-04'), 7.5)).toThrow(RangeError);
  });
});

describe('usageRate', () => {
  it('is null without a whole and capped at 1', () => {
    expect(usageRate(0, 0)).toBeNull();
    expect(usageRate(3, 4)).toBe(0.75);
    expect(usageRate(5, 4)).toBe(1);
  });

  it('rejects negative or non-finite counts', () => {
    expect(() => usageRate(-1, 4)).toThrow(RangeError);
    expect(() => usageRate(1, Number.NaN)).toThrow(RangeError);
  });
});

describe('trainingAdoptionRates', () => {
  it('divides each outcome by what was expected', () => {
    expect(
      trainingAdoptionRates({
        attendedPlayerDays: 20,
        attendedPlayerDaysWithWellness: 15,
        attendedParticipations: 0,
        participationsWithRpe: 0,
      }),
    ).toEqual({ wellnessOnSessionDays: 0.75, rpe: null });
  });
});

describe('vocabularies', () => {
  it('guards surfaces and clients', () => {
    expect(isUsageSurface('panel')).toBe(true);
    expect(isUsageSurface('ranking')).toBe(false);
    expect(isUsageClient('app')).toBe(true);
    expect(isUsageClient('ios')).toBe(false);
  });
});
