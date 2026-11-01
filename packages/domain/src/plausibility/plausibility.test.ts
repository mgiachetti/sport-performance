import { describe, expect, it } from 'vitest';
import {
  CANONICAL_METRICS,
  DEFAULT_PLAUSIBLE_AGE_GROUP_BOUNDS_YEARS,
  DEFAULT_PLAUSIBLE_RANGES,
  DomainValidationError,
  SEXES,
  checkPlausibleValue,
  createPlausibilityChecker,
  decimalAgeYears,
  isCanonicalMetricCode,
  mergePlausibleRanges,
  parseLocalDate,
  parseMetricCode,
  validatePlausibleRanges,
  type CanonicalMetric,
  type MetricCode,
  type PlausibleRange,
  type Sex,
} from '../index.js';

const metric = (code: string): MetricCode => parseMetricCode(code);

function range(overrides: Partial<PlausibleRange> & { metricCode?: MetricCode }): PlausibleRange {
  return {
    metricCode: metric('jump_cm'),
    sex: null,
    minAgeYears: null,
    maxAgeYears: null,
    minValue: 10,
    maxValue: 50,
    ...overrides,
  };
}

describe('checkPlausibleValue with the defaults', () => {
  it('flags a 40 m sprint in 3 s as below the range (the issue example)', () => {
    const result = checkPlausibleValue({
      metricCode: metric('sprint_40_s'),
      value: 3,
      sex: 'male',
      ageYears: 15.4,
    });
    expect(result.status).toBe('below');
  });

  it('accepts typical youth values', () => {
    const typical: [string, number, Sex, number][] = [
      ['sprint_40_s', 5.9, 'male', 15.2],
      ['sprint_40_s', 6.8, 'female', 14.1],
      ['height_cm', 172, 'male', 15.5],
      ['weight_kg', 58, 'female', 16],
      ['cmj_height_cm', 38, 'male', 17.3],
      ['vift_kmh', 18.5, 'male', 18],
      ['bronco_time_s', 300, 'male', 18],
      ['rpe_score', 7, 'female', 13.5],
    ];
    for (const [code, value, sex, ageYears] of typical) {
      expect(
        checkPlausibleValue({ metricCode: metric(code), value, sex, ageYears }).status,
        code,
      ).toBe('within');
    }
  });

  it('suggests moving the decimal separator when it was dropped', () => {
    const result = checkPlausibleValue({
      metricCode: metric('sprint_40_s'),
      value: 512,
      sex: 'male',
      ageYears: 16,
    });
    expect(result).toMatchObject({ status: 'above', suggestedValues: [5.12] });
  });

  it('suggests centimetres when the height was typed in metres', () => {
    const result = checkPlausibleValue({
      metricCode: metric('height_cm'),
      value: 1.72,
      sex: 'female',
      ageYears: 15,
    });
    expect(result).toMatchObject({ status: 'below', suggestedValues: [172] });
  });

  it('works with the decimal age from the birth date', () => {
    const ageYears = decimalAgeYears(parseLocalDate('2011-03-15'), parseLocalDate('2026-04-10'));
    expect(
      checkPlausibleValue({ metricCode: metric('height_cm'), value: 168, sex: 'male', ageYears }),
    ).toEqual({
      status: 'within',
      bounds: { minValue: 140, maxValue: 210, resolvedByAge: true },
    });
  });

  it('returns no_range for metrics without a range', () => {
    expect(
      checkPlausibleValue({ metricCode: metric('dist_m'), value: 1, sex: 'male', ageYears: 15 }),
    ).toEqual({ status: 'no_range' });
  });
});

describe('createPlausibilityChecker', () => {
  const check = createPlausibilityChecker([
    range({ sex: null, minValue: 10, maxValue: 50 }),
    range({ sex: 'female', maxAgeYears: 14, minValue: 5, maxValue: 30 }),
    range({
      metricCode: metric('mass_kg'),
      sex: 'male',
      maxAgeYears: 14,
      minValue: 20,
      maxValue: 80,
    }),
    range({
      metricCode: metric('mass_kg'),
      sex: 'male',
      minAgeYears: 14,
      minValue: 30,
      maxValue: 120,
    }),
  ]);

  it('treats both value bounds as inclusive', () => {
    const base = { metricCode: metric('jump_cm'), sex: 'male', ageYears: 15 } as const;
    expect(check({ ...base, value: 10 }).status).toBe('within');
    expect(check({ ...base, value: 50 }).status).toBe('within');
    expect(check({ ...base, value: 9.99 }).status).toBe('below');
    expect(check({ ...base, value: 50.01 }).status).toBe('above');
  });

  it('prefers the sex-specific range and falls back to the one without sex', () => {
    const base = { metricCode: metric('jump_cm'), value: 40 } as const;
    expect(check({ ...base, sex: 'female', ageYears: 13 }).status).toBe('above');
    expect(check({ ...base, sex: 'female', ageYears: 14 }).status).toBe('within');
    expect(check({ ...base, sex: 'male', ageYears: 13 }).status).toBe('within');
  });

  it('includes the lower age bound and excludes the upper one', () => {
    const base = { metricCode: metric('mass_kg'), value: 25, sex: 'male' } as const;
    expect(check({ ...base, ageYears: 13.999 })).toMatchObject({
      status: 'within',
      bounds: { minValue: 20, maxValue: 80 },
    });
    expect(check({ ...base, ageYears: 14 })).toMatchObject({
      status: 'below',
      bounds: { minValue: 30, maxValue: 120 },
    });
  });

  it('ignores ranges of the other sex', () => {
    expect(
      check({ metricCode: metric('mass_kg'), value: 25, sex: 'female', ageYears: 15 }),
    ).toEqual({ status: 'no_range' });
  });

  it('uses the envelope of every age range when the age is unknown', () => {
    expect(
      check({ metricCode: metric('mass_kg'), value: 110, sex: 'male', ageYears: null }),
    ).toEqual({
      status: 'within',
      bounds: { minValue: 20, maxValue: 120, resolvedByAge: false },
    });
    expect(
      check({ metricCode: metric('jump_cm'), value: 52, sex: 'female', ageYears: null }),
    ).toMatchObject({ status: 'above', bounds: { minValue: 5, maxValue: 50 } });
  });

  it('returns no_range when no age range covers the age', () => {
    const partial = createPlausibilityChecker([range({ minAgeYears: 12, maxAgeYears: 14 })]);
    expect(partial({ metricCode: metric('jump_cm'), value: 1, sex: 'male', ageYears: 20 })).toEqual(
      { status: 'no_range' },
    );
  });

  it('suggests only shifts within range, closest shift first, without float noise', () => {
    const wide = createPlausibilityChecker([range({ minValue: 0.5, maxValue: 600 })]);
    const result = wide({ metricCode: metric('jump_cm'), value: 0.07, sex: 'male', ageYears: 15 });
    expect(result).toMatchObject({ status: 'below', suggestedValues: [0.7, 7, 70] });

    const none = wide({ metricCode: metric('jump_cm'), value: 0, sex: 'male', ageYears: 15 });
    expect(none).toMatchObject({ status: 'below', suggestedValues: [] });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('throws for a non-finite value %d', (value) => {
    expect(() =>
      check({ metricCode: metric('jump_cm'), value, sex: 'male', ageYears: 15 }),
    ).toThrow(DomainValidationError);
  });

  it.each([-1, Number.NaN])('throws for an invalid age %d', (ageYears) => {
    expect(() =>
      check({ metricCode: metric('jump_cm'), value: 20, sex: 'male', ageYears }),
    ).toThrow(DomainValidationError);
  });

  it('throws for an invalid sex', () => {
    expect(() =>
      check({ metricCode: metric('jump_cm'), value: 20, sex: 'other' as Sex, ageYears: 15 }),
    ).toThrow(DomainValidationError);
  });

  it('validates the ranges up front', () => {
    expect(() => createPlausibilityChecker([range({ minValue: 5, maxValue: 1 })])).toThrow(
      DomainValidationError,
    );
  });
});

describe('validatePlausibleRanges', () => {
  it('accepts contiguous age ranges and the same ages for different sexes', () => {
    expect(() => {
      validatePlausibleRanges([
        range({ maxAgeYears: 14 }),
        range({ minAgeYears: 14 }),
        range({ sex: 'male' }),
        range({ sex: 'female' }),
        range({ minValue: 3, maxValue: 3, metricCode: metric('other_n') }),
      ]);
    }).not.toThrow();
  });

  it.each<[string, Partial<PlausibleRange>]>([
    ['malformed metric code', { metricCode: 'Jump CM' as MetricCode }],
    ['invalid sex', { sex: 'x' as Sex }],
    ['non-finite minValue', { minValue: Number.NaN }],
    ['non-finite maxValue', { maxValue: Number.POSITIVE_INFINITY }],
    ['minValue above maxValue', { minValue: 60, maxValue: 50 }],
    ['negative age', { minAgeYears: -1 }],
    ['non-finite age', { maxAgeYears: Number.NaN }],
    ['empty age interval', { minAgeYears: 14, maxAgeYears: 14 }],
    ['inverted age interval', { minAgeYears: 15, maxAgeYears: 14 }],
  ])('rejects a %s', (_label, overrides) => {
    expect(() => {
      validatePlausibleRanges([range(overrides)]);
    }).toThrow(DomainValidationError);
  });

  it.each<[string, Partial<PlausibleRange>, Partial<PlausibleRange>]>([
    ['overlapping age intervals', { maxAgeYears: 15 }, { minAgeYears: 14 }],
    ['an open range and a bounded one', {}, { minAgeYears: 14, maxAgeYears: 16 }],
    ['two sex-specific duplicates', { sex: 'male' }, { sex: 'male' }],
  ])('rejects %s for the same metric and sex', (_label, a, b) => {
    expect(() => {
      validatePlausibleRanges([range(a), range(b)]);
    }).toThrow(DomainValidationError);
  });
});

describe('mergePlausibleRanges', () => {
  const defaults = [
    range({ sex: 'male', minValue: 10, maxValue: 50 }),
    range({ sex: 'female', minValue: 8, maxValue: 40 }),
    range({ metricCode: metric('mass_kg'), minValue: 20, maxValue: 150 }),
  ];

  it('replaces every default range of an overridden metric and keeps the rest', () => {
    const club = range({ minValue: 15, maxValue: 70 });
    const merged = mergePlausibleRanges(defaults, [club]);
    expect(merged).toEqual([defaults[2], club]);
  });

  it('does not mutate the inputs', () => {
    const copy = [...defaults];
    mergePlausibleRanges(defaults, [range({})]);
    expect(defaults).toEqual(copy);
  });

  it('validates the merged result', () => {
    expect(() => mergePlausibleRanges(defaults, [range({}), range({})])).toThrow(
      DomainValidationError,
    );
  });
});

describe('DEFAULT_PLAUSIBLE_RANGES', () => {
  it('is valid and frozen', () => {
    expect(() => {
      validatePlausibleRanges(DEFAULT_PLAUSIBLE_RANGES);
    }).not.toThrow();
    expect(Object.isFrozen(DEFAULT_PLAUSIBLE_RANGES)).toBe(true);
  });

  it('uses only canonical metrics that are typed by hand', () => {
    for (const { metricCode } of DEFAULT_PLAUSIBLE_RANGES) {
      const code: string = metricCode;
      expect(isCanonicalMetricCode(code), code).toBe(true);
      if (!isCanonicalMetricCode(code)) continue;
      const canonical: CanonicalMetric = CANONICAL_METRICS[code];
      expect(canonical.source, code).not.toBe('field');
    }
  });

  it('covers every age for both sexes for each metric, without gaps', () => {
    const probeAges = [
      0,
      ...DEFAULT_PLAUSIBLE_AGE_GROUP_BOUNDS_YEARS.flatMap((age) => [age - 1e-9, age]),
      12,
      15.5,
      18,
      35,
    ];
    const check = createPlausibilityChecker();
    const metrics = new Set(DEFAULT_PLAUSIBLE_RANGES.map((r) => r.metricCode));
    for (const metricCode of metrics) {
      for (const sex of SEXES) {
        for (const ageYears of probeAges) {
          expect(
            check({ metricCode, value: 0, sex, ageYears }).status,
            `${metricCode} ${sex} ${String(ageYears)}`,
          ).not.toBe('no_range');
        }
      }
    }
  });

  it('keeps bounded scores within their scale', () => {
    const bounds = (code: string) =>
      DEFAULT_PLAUSIBLE_RANGES.filter((r) => r.metricCode === code).map((r) => [
        r.minValue,
        r.maxValue,
      ]);
    expect(bounds('technique_score')).toEqual([[1, 3]]);
    expect(bounds('rpe_score')).toEqual([[0, 10]]);
  });

  it('never has negative lower bounds', () => {
    for (const r of DEFAULT_PLAUSIBLE_RANGES)
      expect(r.minValue, r.metricCode).toBeGreaterThanOrEqual(0);
  });
});
