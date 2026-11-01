import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROWTH_VELOCITY_PARAMS,
  DomainValidationError,
  growthVelocityCmYear,
  latestGrowthVelocity,
  parseLocalDate,
  type HeightMeasurement,
} from '../index.js';

const m = (date: string, heightCm: number): HeightMeasurement => ({
  date: parseLocalDate(date),
  heightCm,
});

describe('growthVelocityCmYear', () => {
  it('divides the change by years of 365.25 days', () => {
    // 2026-01-01 → 2027-01-01 is 365 days.
    expect(growthVelocityCmYear(m('2026-01-01', 150), m('2027-01-01', 158))).toBeCloseTo(
      (8 * 365.25) / 365,
      12,
    );
    // 2026-01-01 → 2026-04-02 is 91 days: 2 cm → 8.027 cm/year.
    expect(growthVelocityCmYear(m('2026-01-01', 150), m('2026-04-02', 152))).toBeCloseTo(
      (2 * 365.25) / 91,
      12,
    );
  });

  it('can be negative (measurement error) and is not hidden', () => {
    expect(growthVelocityCmYear(m('2026-01-01', 150), m('2026-07-02', 149.5))).toBeLessThan(0);
  });

  it('rejects same-day or reversed measurements and invalid heights', () => {
    expect(() => growthVelocityCmYear(m('2026-01-01', 150), m('2026-01-01', 151))).toThrow(
      DomainValidationError,
    );
    expect(() => growthVelocityCmYear(m('2026-02-01', 150), m('2026-01-01', 151))).toThrow(
      DomainValidationError,
    );
    expect(() => growthVelocityCmYear(m('2026-01-01', 0), m('2026-06-01', 151))).toThrow(
      DomainValidationError,
    );
  });
});

describe('latestGrowthVelocity', () => {
  it('defaults to 84-400 days', () => {
    expect(DEFAULT_GROWTH_VELOCITY_PARAMS).toEqual({ minIntervalDays: 84, maxIntervalDays: 400 });
  });

  it('pairs the latest measurement with the most recent one at least min days before', () => {
    const series = [
      m('2026-05-01', 155), // 6 weeks before: too close
      m('2026-01-15', 151),
      m('2026-03-01', 153), // 3 months before the latest: chosen
      m('2026-06-12', 156),
    ];
    const r = latestGrowthVelocity(series);
    expect(r).not.toBeNull();
    expect(r?.from.date).toBe('2026-03-01');
    expect(r?.to.date).toBe('2026-06-12');
    expect(r?.intervalDays).toBe(103);
    expect(r?.growthVelocityCmYear).toBeCloseTo((3 * 365.25) / 103, 12);
  });

  it('returns null without a pair in range', () => {
    expect(latestGrowthVelocity([])).toBeNull();
    expect(latestGrowthVelocity([m('2026-01-01', 150)])).toBeNull();
    expect(latestGrowthVelocity([m('2026-01-01', 150), m('2026-02-01', 151)])).toBeNull();
    expect(latestGrowthVelocity([m('2024-01-01', 140), m('2026-01-01', 150)])).toBeNull();
  });

  it('honours custom intervals', () => {
    const series = [m('2026-01-01', 150), m('2026-02-01', 151)];
    expect(latestGrowthVelocity(series, { minIntervalDays: 28 })?.growthVelocityCmYear).toBeCloseTo(
      365.25 / 31,
      12,
    );
  });

  it('rejects two measurements on the same day and invalid intervals', () => {
    expect(() => latestGrowthVelocity([m('2026-01-01', 150), m('2026-01-01', 150.2)])).toThrow(
      DomainValidationError,
    );
    expect(() => latestGrowthVelocity([], { minIntervalDays: 0 })).toThrow(DomainValidationError);
    expect(() => latestGrowthVelocity([], { minIntervalDays: 100, maxIntervalDays: 50 })).toThrow(
      DomainValidationError,
    );
    expect(() => latestGrowthVelocity([], { minIntervalDays: 1.5 })).toThrow(DomainValidationError);
  });
});
