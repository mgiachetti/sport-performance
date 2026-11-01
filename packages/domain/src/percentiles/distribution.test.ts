import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  percentileRank,
  summarizeDistribution,
  valueAtPercentile,
} from '../index.js';

describe('percentileRank', () => {
  const cmjCm = [30, 32, 34, 36, 38, 40, 42, 44, 46, 48];

  it('uses the mid-rank definition for higher is better', () => {
    // 4 worse, 1 equal, N = 10 → (4 + 0.5) / 10.
    expect(percentileRank(38, cmjCm, 'higher_is_better')).toBeCloseTo(45);
    expect(percentileRank(48, cmjCm, 'higher_is_better')).toBeCloseTo(95);
    expect(percentileRank(30, cmjCm, 'higher_is_better')).toBeCloseTo(5);
  });

  it('inverts the order for lower is better (faster sprint ranks higher)', () => {
    const t40S = [5.2, 5.4, 5.6, 5.8, 6.0];
    expect(percentileRank(5.2, t40S, 'lower_is_better')).toBeCloseTo(90);
    expect(percentileRank(6.0, t40S, 'lower_is_better')).toBeCloseTo(10);
  });

  it('ranks neutral metrics ascending', () => {
    expect(percentileRank(3, [1, 2, 3, 4], 'neutral')).toBeCloseTo(62.5);
  });

  it('counts ties as half', () => {
    expect(percentileRank(10, [10, 10, 10, 10], 'higher_is_better')).toBe(50);
  });

  it('ranks a value outside the group (first-team reference)', () => {
    expect(percentileRank(60, cmjCm, 'higher_is_better')).toBe(100);
    expect(percentileRank(20, cmjCm, 'higher_is_better')).toBe(0);
    expect(percentileRank(39, cmjCm, 'higher_is_better')).toBe(50);
  });

  it('does not depend on input order', () => {
    const shuffled = [44, 30, 48, 36, 32, 40, 46, 34, 42, 38];
    expect(percentileRank(38, shuffled, 'higher_is_better')).toBeCloseTo(45);
  });

  it('rejects empty groups and non-finite values', () => {
    expect(() => percentileRank(1, [], 'higher_is_better')).toThrow(DomainValidationError);
    expect(() => percentileRank(Number.NaN, [1], 'higher_is_better')).toThrow(
      DomainValidationError,
    );
    expect(() => percentileRank(1, [1, Number.POSITIVE_INFINITY], 'higher_is_better')).toThrow(
      DomainValidationError,
    );
  });
});

describe('valueAtPercentile', () => {
  const values = [1, 2, 3, 4, 5];

  it('interpolates linearly (PERCENTILE.INC)', () => {
    expect(valueAtPercentile(values, 0, 'higher_is_better')).toBe(1);
    expect(valueAtPercentile(values, 50, 'higher_is_better')).toBe(3);
    expect(valueAtPercentile(values, 100, 'higher_is_better')).toBe(5);
    expect(valueAtPercentile(values, 10, 'higher_is_better')).toBeCloseTo(1.4);
    expect(valueAtPercentile([10, 20], 25, 'higher_is_better')).toBeCloseTo(12.5);
  });

  it('returns the better end at high percentiles for lower is better', () => {
    expect(valueAtPercentile(values, 90, 'lower_is_better')).toBeCloseTo(1.4);
    expect(valueAtPercentile(values, 100, 'lower_is_better')).toBe(1);
  });

  it('handles a single value', () => {
    expect(valueAtPercentile([7], 33, 'higher_is_better')).toBe(7);
  });

  it.each([-1, 101, Number.NaN])('rejects percentile %d', (p) => {
    expect(() => valueAtPercentile(values, p, 'higher_is_better')).toThrow(DomainValidationError);
  });

  it('rejects an empty group', () => {
    expect(() => valueAtPercentile([], 50, 'higher_is_better')).toThrow(DomainValidationError);
  });
});

describe('summarizeDistribution', () => {
  it('summarises size, mean, range and P10–P90', () => {
    const summary = summarizeDistribution([5, 1, 4, 2, 3], 'higher_is_better');
    expect(summary).toEqual({
      sampleSize: 5,
      mean: 3,
      min: 1,
      max: 5,
      p10: expect.closeTo(1.4) as number,
      p25: 2,
      p50: 3,
      p75: 4,
      p90: expect.closeTo(4.6) as number,
    });
  });

  it('is direction-aware for lower is better', () => {
    const summary = summarizeDistribution([5, 1, 4, 2, 3], 'lower_is_better');
    expect(summary.p90).toBeCloseTo(1.4);
    expect(summary.p25).toBe(4);
    expect(summary.min).toBe(1);
  });
});
