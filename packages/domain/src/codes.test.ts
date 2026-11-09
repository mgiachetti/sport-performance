import { describe, expect, it } from 'vitest';
import {
  CANONICAL_METRICS,
  CANONICAL_METRIC_CODES,
  CANONICAL_TEST_CODES,
  DomainValidationError,
  FIELD_METRIC_CODES,
  UNITLESS_NAME_METRIC_CODES,
  canonicalMetricCode,
  canonicalMetricsOfTest,
  canonicalTestCode,
  isCanonicalMetricCode,
  isMetricCode,
  isTestCode,
  isUnitCode,
  parseMetricCode,
  parseTestCode,
  type CanonicalMetric,
  type MetricCode,
} from './index.js';

describe('code parsing', () => {
  it.each(['hsr_abs_m', 'cmj', 'sprint_40', 'ift_3015', 'cod505_left_s', 'a1'])(
    'accepts %s',
    (code) => {
      expect(isMetricCode(code)).toBe(true);
      expect(isTestCode(code)).toBe(true);
      expect(parseMetricCode(code)).toBe(code);
      expect(parseTestCode(code)).toBe(code);
    },
  );

  it.each([
    '',
    'HSR',
    'hsrAbsM',
    '_dist',
    'dist_',
    'dist__m',
    '1dist',
    'dist-m',
    'dist m',
    'distancia_ñ',
    'a'.repeat(65),
    'player_load_au',
    'playerload',
    42,
    null,
  ])('rejects %j', (code) => {
    expect(isMetricCode(code)).toBe(false);
    expect(() => parseMetricCode(code)).toThrow(DomainValidationError);
    expect(() => parseTestCode(code)).toThrow(
      expect.objectContaining({ code: 'invalid_test_code' }),
    );
  });

  it('accepts codes up to 64 characters', () => {
    expect(isMetricCode('a'.repeat(64))).toBe(true);
  });
});

describe('canonical tests', () => {
  it('are the battery from CLAUDE.md', () => {
    expect(CANONICAL_TEST_CODES).toEqual([
      'anthro',
      'sprint_40',
      'cmj',
      'cod_505',
      'ift_3015',
      'bronco',
      'strength',
      'mobility',
      'reaction',
      'neck',
    ]);
  });

  it('are well formed and produce at least one canonical metric', () => {
    for (const test of CANONICAL_TEST_CODES) {
      expect(isTestCode(canonicalTestCode(test))).toBe(true);
      expect(canonicalMetricsOfTest(test).length).toBeGreaterThan(0);
    }
  });

  it('list their metrics', () => {
    expect(canonicalMetricsOfTest('sprint_40')).toEqual([
      'sprint_10_s',
      'sprint_20_s',
      'sprint_40_s',
      'sprint_vmax_ms',
    ]);
    expect(canonicalMetricsOfTest('cmj')).toEqual(['cmj_height_cm']);
  });
});

describe('canonical metrics', () => {
  const entries = Object.entries(CANONICAL_METRICS) as [string, CanonicalMetric][];

  it('includes the Catapult-equivalent field codes', () => {
    const fieldCodes = entries.filter(([, m]) => m.source === 'field').map(([code]) => code);
    expect(fieldCodes).toEqual([
      'dist_m',
      'dist_m_min',
      'hsr_abs_m',
      'hsr_rel_m',
      'vmax_ms',
      'vmax_pct',
      'acc_n',
      'dec_n',
      'sprints_n',
      'sprint_dist_m',
      'accel_load_au',
      'contacts_n',
      'scrums_n',
      'kicks_n',
      'time_to_feet_s',
      'big_time_s',
      'hr_avg',
      'hr_max',
      'trimp',
    ]);
  });

  it.each(entries)('%s is well formed and uses a known unit', (code, metric) => {
    expect(isMetricCode(code)).toBe(true);
    expect(isUnitCode(metric.unit)).toBe(true);
    expect(code.toLowerCase()).not.toContain('playerload');
  });

  it.each(entries)('%s carries its unit in the name', (code, metric) => {
    if ((UNITLESS_NAME_METRIC_CODES as readonly string[]).includes(code)) return;
    expect(code.endsWith(`_${metric.unit}`)).toBe(true);
  });

  it.each(entries)('%s links to a test only when it comes from a test', (_code, metric) => {
    if (metric.source === 'test') {
      expect(metric.test).toBeDefined();
      expect(CANONICAL_TEST_CODES).toContain(metric.test);
    } else {
      expect(metric.test).toBeUndefined();
    }
  });

  it('scopes rugby-only metrics', () => {
    expect(CANONICAL_METRICS.scrums_n.sports).toEqual(['rugby']);
    expect('sports' in CANONICAL_METRICS.dist_m).toBe(false);
  });

  it('marks improvement direction for best-attempt and percentiles', () => {
    expect(CANONICAL_METRICS.sprint_40_s.direction).toBe('lower_is_better');
    expect(CANONICAL_METRICS.cmj_height_cm.direction).toBe('higher_is_better');
  });

  it('narrows canonical codes and brands them as metric codes', () => {
    expect(isCanonicalMetricCode('hsr_abs_m')).toBe(true);
    expect(isCanonicalMetricCode('toString')).toBe(false);
    expect(isCanonicalMetricCode('club_custom_m')).toBe(false);
    const code: MetricCode = canonicalMetricCode('vmax_ms');
    expect(code).toBe('vmax_ms');
    expect(CANONICAL_METRIC_CODES).toHaveLength(entries.length);
  });

  it('lists the field metrics in dictionary order, and only them', () => {
    expect(FIELD_METRIC_CODES.slice(0, 4)).toEqual([
      'dist_m',
      'dist_m_min',
      'hsr_abs_m',
      'hsr_rel_m',
    ]);
    expect(FIELD_METRIC_CODES).toContain('accel_load_au');
    expect(FIELD_METRIC_CODES).not.toContain('cmj_height_cm');
    for (const code of FIELD_METRIC_CODES) {
      const metric: CanonicalMetric = CANONICAL_METRICS[code];
      expect(metric.source, code).toBe('field');
    }
  });
});
