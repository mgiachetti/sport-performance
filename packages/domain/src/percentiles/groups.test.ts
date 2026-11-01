import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERCENTILE_SETTINGS,
  DomainValidationError,
  PERCENTILE_GROUP_DIMENSIONS,
  buildPercentileGroup,
  canonicalMetricCode,
  computePercentile,
  assertPercentileSettings,
  parseLocalDate,
  parsePlayerId,
  resolvePlayerAggregation,
  type PercentileGroup,
  type PercentileSample,
  type PercentileSettings,
  type PercentileSubject,
  type PlayerId,
} from '../index.js';

const CMJ = canonicalMetricCode('cmj_height_cm');
const T40 = canonicalMetricCode('sprint_40_s');

function player(n: number): PlayerId {
  return parsePlayerId(`00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`);
}

function sample(
  n: number,
  value: number,
  overrides: Partial<PercentileSample> = {},
): PercentileSample {
  return {
    playerId: player(n),
    metricCode: CMJ,
    sport: 'rugby',
    sex: 'male',
    categoryCode: 'm15',
    positionCode: 'wing',
    lineCode: 'backs',
    seasonYear: 2026,
    measuredOn: parseLocalDate('2026-04-10'),
    method: 'app',
    value,
    ...overrides,
  };
}

const subject: PercentileSubject = {
  playerId: player(0),
  metricCode: CMJ,
  sport: 'rugby',
  sex: 'male',
  categoryCode: 'm15',
  positionCode: 'wing',
  lineCode: 'backs',
  seasonYear: 2026,
  method: 'app',
  value: 40,
};

const groupOptions = { direction: 'higher_is_better', methodPolicy: 'same_method' } as const;
const oneSeason = (...dimensions: PercentileGroup['grouping']['dimensions']) => ({
  dimensions,
  seasonsAccumulated: 1,
});

function group(
  samples: readonly PercentileSample[],
  grouping = oneSeason('sex', 'category', 'position'),
  s: PercentileSubject = subject,
  options: Parameters<typeof buildPercentileGroup>[3] = groupOptions,
): PercentileGroup {
  const g = buildPercentileGroup(samples, s, grouping, options);
  if (g === 'missing_dimension') throw new Error('unexpected missing_dimension');
  return g;
}

describe('buildPercentileGroup', () => {
  it('matches every requested dimension, plus sport and metric', () => {
    const samples = [
      sample(1, 30),
      sample(2, 31, { sex: 'female' }),
      sample(3, 32, { categoryCode: 'm16' }),
      sample(4, 33, { positionCode: 'prop', lineCode: 'forwards' }),
      sample(5, 34, { sport: 'hockey' }),
      sample(6, 35, { metricCode: T40 }),
      sample(7, 36, { positionCode: 'centre' }),
    ];
    expect(group(samples).values).toEqual([30, 40]);
    expect(group(samples, oneSeason('sex', 'category', 'line')).values).toEqual([30, 36, 40]);
    expect(group(samples, oneSeason('category')).values).toEqual([30, 31, 33, 36, 40]);
    // Sport and metric are never mixed, even with no dimensions.
    expect(group(samples, oneSeason()).values).toEqual([30, 31, 32, 33, 36, 40]);
  });

  it('accumulates seasons backwards and never includes later seasons', () => {
    const samples = [
      sample(1, 30, { seasonYear: 2026 }),
      sample(2, 31, { seasonYear: 2025 }),
      sample(3, 32, { seasonYear: 2024 }),
      sample(4, 33, { seasonYear: 2023 }),
      sample(5, 34, { seasonYear: 2027 }),
    ];
    const g = group(samples, { dimensions: ['category'], seasonsAccumulated: 3 });
    expect(g.values).toEqual([30, 31, 32, 40]);
    expect([g.seasonFrom, g.seasonTo]).toEqual([2024, 2026]);
  });

  it('counts each player once, with the best result by default', () => {
    const samples = [sample(1, 30), sample(1, 35), sample(1, 33)];
    expect(group(samples).values).toEqual([35, 40]);
    const sprint = [sample(1, 5.6), sample(1, 5.4)];
    const t40Subject = { ...subject, value: 5.5 };
    expect(
      group(sprint, undefined, t40Subject, {
        direction: 'lower_is_better',
        methodPolicy: 'same_method',
      }).values,
    ).toEqual([5.4, 5.5]);
  });

  it('supports latest (same-day results averaged) and mean aggregation', () => {
    const samples = [
      sample(1, 30, { measuredOn: parseLocalDate('2026-02-10') }),
      sample(1, 34, { measuredOn: parseLocalDate('2026-07-10') }),
      sample(1, 36, { measuredOn: parseLocalDate('2026-07-10') }),
      sample(1, 50, { measuredOn: parseLocalDate('2026-04-10') }),
    ];
    const latest = { ...groupOptions, playerAggregation: 'latest' } as const;
    const mean = { ...groupOptions, playerAggregation: 'mean' } as const;
    expect(group(samples, undefined, subject, latest).values).toEqual([35, 40]);
    expect(group(samples, undefined, subject, mean).values).toEqual([37.5, 40]);
  });

  it('replaces the subject player results with the value being evaluated', () => {
    const samples = [sample(0, 99), sample(0, 12), sample(1, 30)];
    expect(group(samples).values).toEqual([30, 40]);
  });

  it('does not add a subject without playerId (first-team value) to the group', () => {
    const reference = omit(subject, 'playerId');
    const g = group([sample(1, 30), sample(2, 31)], undefined, { ...reference, value: 45 });
    expect(g.values).toEqual([30, 31]);
  });

  it('keeps only the subject method by default and flags mixed methods otherwise', () => {
    const samples = [sample(1, 30), sample(2, 31, { method: 'photocell' })];
    const same = group(samples);
    expect(same.values).toEqual([30, 40]);
    expect(same.mixedMethods).toBe(false);
    expect(same.methods).toEqual(['app']);

    const any = group(samples, undefined, subject, { ...groupOptions, methodPolicy: 'any_method' });
    expect(any.values).toEqual([30, 31, 40]);
    expect(any.mixedMethods).toBe(true);
    expect(any.methods).toEqual(['app', 'photocell']);
  });

  it('flags a non-player subject measured with another method (principle 4)', () => {
    const samples = Array.from({ length: 12 }, (_, i) =>
      sample(i + 1, 30 + i, { method: 'manual' }),
    );
    const reference = { ...omit(subject, 'playerId'), method: 'photocell' as const };
    const g = group(samples, undefined, reference, { ...groupOptions, methodPolicy: 'any_method' });
    expect(g.values).toHaveLength(12);
    expect(g.methods).toEqual(['manual', 'photocell']);
    expect(g.mixedMethods).toBe(true);
  });

  it('does not flag a non-player subject measured with the group method', () => {
    const reference = omit(subject, 'playerId');
    const g = group([sample(1, 30), sample(2, 31)], undefined, reference, {
      ...groupOptions,
      methodPolicy: 'any_method',
    });
    expect(g.methods).toEqual(['app']);
    expect(g.mixedMethods).toBe(false);
  });

  it('accepts a subject with unknown method only under any_method, and flags it', () => {
    const unknown = omit(subject, 'playerId', 'method');
    const anyMethod = { ...groupOptions, methodPolicy: 'any_method' } as const;
    const g = group([sample(1, 30), sample(2, 31)], undefined, unknown, anyMethod);
    expect(g.values).toEqual([30, 31]);
    expect(g.methods).toEqual(['app']);
    expect(g.mixedMethods).toBe(true);
    expect(group([], undefined, unknown, anyMethod).mixedMethods).toBe(false);
    expect(() => group([sample(1, 30)], undefined, unknown)).toThrow(DomainValidationError);
  });

  it('leaves out samples measured after asOf', () => {
    const samples = [
      sample(1, 30, { measuredOn: parseLocalDate('2026-03-01') }),
      sample(2, 31, { measuredOn: parseLocalDate('2026-05-01') }),
      sample(3, 32, { measuredOn: parseLocalDate('2026-09-01') }),
    ];
    const asOf = { ...subject, asOf: parseLocalDate('2026-05-01') };
    expect(group(samples, undefined, asOf).values).toEqual([30, 31, 40]);
    expect(group(samples).values).toEqual([30, 31, 32, 40]);
  });

  it('reports missing_dimension when the subject lacks it, and drops samples lacking it', () => {
    const noPosition = omit(subject, 'positionCode', 'lineCode');
    expect(buildPercentileGroup([], noPosition, oneSeason('position'), groupOptions)).toBe(
      'missing_dimension',
    );
    expect(buildPercentileGroup([], noPosition, oneSeason('line'), groupOptions)).toBe(
      'missing_dimension',
    );
    const samplePositionless = omit(sample(1, 30), 'positionCode');
    expect(group([samplePositionless, sample(2, 31)]).values).toEqual([31, 40]);
  });

  it('exposes values only, never player identities', () => {
    const g = group([sample(1, 30)]);
    expect(JSON.stringify(g)).not.toContain(player(1));
  });

  it('rejects invalid input', () => {
    expect(() => group([sample(1, Number.NaN)])).toThrow(DomainValidationError);
    expect(() => group([], { dimensions: ['sex'], seasonsAccumulated: 0 })).toThrow(
      DomainValidationError,
    );
    expect(() => group([], { dimensions: ['sex', 'sex'], seasonsAccumulated: 1 })).toThrow(
      DomainValidationError,
    );
    expect(() => group([], { dimensions: ['team' as never], seasonsAccumulated: 1 })).toThrow(
      DomainValidationError,
    );
    expect(() => group([], undefined, { ...subject, value: Number.POSITIVE_INFINITY })).toThrow(
      DomainValidationError,
    );
    expect(() => group([], undefined, { ...subject, seasonYear: 2026.5 })).toThrow(
      DomainValidationError,
    );
    expect(() => group([sample(1, 30, { seasonYear: Number.NaN })])).toThrow(DomainValidationError);
    expect(() => group([sample(1, 30, { seasonYear: 2025.5 })])).toThrow(DomainValidationError);
    expect(() => group([], undefined, { ...subject, method: 'laser' as never })).toThrow(
      DomainValidationError,
    );
  });
});

describe('resolvePlayerAggregation', () => {
  it('defaults to best for directional metrics and latest for neutral ones', () => {
    expect(resolvePlayerAggregation('higher_is_better')).toBe('best');
    expect(resolvePlayerAggregation('lower_is_better')).toBe('best');
    expect(resolvePlayerAggregation('neutral')).toBe('latest');
    expect(resolvePlayerAggregation('neutral', 'mean')).toBe('mean');
  });

  it('rejects best for neutral metrics', () => {
    expect(() => resolvePlayerAggregation('neutral', 'best')).toThrow(DomainValidationError);
  });
});

describe('computePercentile', () => {
  /** `count` peers with CMJ 30, 31, …; overrides applied to every peer. */
  function peers(count: number, overrides: Partial<PercentileSample> = {}, from = 1) {
    return Array.from({ length: count }, (_, i) => sample(from + i, 30 + i, overrides));
  }

  it('reports the percentile with the most specific grouping that reaches the minimum', () => {
    // 9 wings + subject = 10 players.
    const result = computePercentile(peers(9), subject, 'higher_is_better');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Values 30..38 and 40: 9 worse + 0.5 · 1 equal, N = 10 → 95.
    expect(result.percentile).toBeCloseTo(95);
    expect(result.sampleSize).toBe(10);
    expect(result.minSampleSize).toBe(10);
    expect(result.grouping).toEqual(DEFAULT_PERCENTILE_SETTINGS.groupings[0]);
    expect(result.summary.sampleSize).toBe(10);
    expect(result.attempts).toEqual([
      { grouping: DEFAULT_PERCENTILE_SETTINGS.groupings[0], outcome: 'ok', sampleSize: 10 },
    ]);
  });

  it('falls back from position to line', () => {
    const samples = [...peers(4), ...peers(6, { positionCode: 'centre' }, 10)];
    const result = computePercentile(samples, subject, 'higher_is_better');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.grouping.dimensions).toEqual(['sex', 'category', 'line']);
    expect(result.sampleSize).toBe(11);
    expect(result.attempts.map((a) => [a.outcome, a.sampleSize])).toEqual([
      ['insufficient_sample', 5],
      ['ok', 11],
    ]);
  });

  it('falls back to accumulated seasons', () => {
    const samples = [...peers(4), ...peers(5, { seasonYear: 2025 }, 10)];
    const result = computePercentile(samples, subject, 'higher_is_better');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.grouping).toEqual({
      dimensions: ['sex', 'category', 'line'],
      seasonsAccumulated: 3,
    });
    expect([result.seasonFrom, result.seasonTo]).toEqual([2024, 2026]);
  });

  it('falls back to category and sex across positions and lines', () => {
    const samples = peers(9, { positionCode: 'prop', lineCode: 'forwards' });
    const result = computePercentile(samples, subject, 'higher_is_better');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.grouping.dimensions).toEqual(['sex', 'category']);
  });

  it('never reports a percentile below the minimum sample size', () => {
    const result = computePercentile(peers(8), subject, 'higher_is_better');
    expect(result).toEqual({
      status: 'insufficient_sample',
      minSampleSize: 10,
      largestSampleSize: 9,
      attempts: DEFAULT_PERCENTILE_SETTINGS.groupings.map((grouping) => ({
        grouping,
        outcome: 'insufficient_sample',
        sampleSize: 9,
      })),
    });
  });

  it('skips groupings whose dimension the subject lacks', () => {
    const noPosition = omit(subject, 'positionCode', 'lineCode');
    const result = computePercentile(peers(9), noPosition, 'higher_is_better');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      'missing_dimension',
      'missing_dimension',
      'missing_dimension',
      'ok',
    ]);
  });

  it('respects club settings', () => {
    const settings: PercentileSettings = {
      minSampleSize: 3,
      groupings: [{ dimensions: ['sex'], seasonsAccumulated: 2 }],
      methodPolicy: 'any_method',
      playerAggregation: 'mean',
    };
    const samples = [sample(1, 30), sample(1, 40, { method: 'video' }), sample(2, 20)];
    const result = computePercentile(samples, subject, 'higher_is_better', settings);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Group: 35 (mean of player 1), 20, 40 (subject) → 2 worse + 0.5 / 3.
    expect(result.percentile).toBeCloseTo((2.5 / 3) * 100);
    expect(result.mixedMethods).toBe(true);
    expect(result.methods).toEqual(['app', 'video']);
  });

  it('places a first-team reference (no playerId) within the youth group', () => {
    const reference = omit(subject, 'playerId');
    const result = computePercentile(peers(10), { ...reference, value: 39.5 }, 'higher_is_better');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sampleSize).toBe(10);
    expect(result.percentile).toBe(100);
  });

  it('is direction-aware for lower is better', () => {
    const samples = Array.from({ length: 9 }, (_, i) =>
      sample(i + 1, 5.3 + i * 0.1, { metricCode: T40 }),
    );
    const result = computePercentile(
      samples,
      { ...subject, metricCode: T40, value: 5.2 },
      'lower_is_better',
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.percentile).toBeCloseTo(95);
    expect(result.summary.p90).toBeLessThan(result.summary.p10);
  });

  it('rejects invalid settings', () => {
    const bad = (s: Partial<PercentileSettings>) => () => {
      computePercentile([], subject, 'higher_is_better', { ...DEFAULT_PERCENTILE_SETTINGS, ...s });
    };
    expect(bad({ minSampleSize: 0 })).toThrow(DomainValidationError);
    expect(bad({ minSampleSize: 2.5 })).toThrow(DomainValidationError);
    expect(bad({ groupings: [] })).toThrow(DomainValidationError);
    expect(bad({ methodPolicy: 'whatever' as never })).toThrow(DomainValidationError);
    expect(bad({ playerAggregation: 'max' as never })).toThrow(DomainValidationError);
    expect(() =>
      computePercentile([], subject, 'neutral', {
        ...DEFAULT_PERCENTILE_SETTINGS,
        playerAggregation: 'best',
      }),
    ).toThrow(DomainValidationError);
  });
});

describe('DEFAULT_PERCENTILE_SETTINGS', () => {
  it('is valid data', () => {
    expect(() => {
      assertPercentileSettings(DEFAULT_PERCENTILE_SETTINGS);
    }).not.toThrow();
    for (const g of DEFAULT_PERCENTILE_SETTINGS.groupings) {
      for (const d of g.dimensions) {
        expect(PERCENTILE_GROUP_DIMENSIONS).toContain(d);
      }
    }
  });

  it('always scopes by sex and category', () => {
    for (const g of DEFAULT_PERCENTILE_SETTINGS.groupings) {
      expect(g.dimensions).toContain('sex');
      expect(g.dimensions).toContain('category');
    }
  });

  it('is JSON-serialisable (ready to seed)', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_PERCENTILE_SETTINGS))).toEqual(
      DEFAULT_PERCENTILE_SETTINGS,
    );
  });
});

/** Test helper: a copy of `value` without `keys` (for optional fields). */
export function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) Reflect.deleteProperty(copy, key);
  return copy as Omit<T, K>;
}
