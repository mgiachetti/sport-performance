/**
 * The migration `pod_metrics` (B-919, ADR 0110) writes the domain's pod
 * metric defaults and the new sprint codes as SQL literals for the clubs
 * bootstrapped before. ADR 0027 forbids writing a default twice, so this test
 * keeps both copies equal.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_METRICS,
  DEFAULT_POD_METRIC_PARAMS,
  POD_METRICS_ALGORITHM_VERSION,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../migrate.js';
import { DEFAULT_SEED_VALID_FROM } from './bootstrap.js';
import { DEFAULT_CATAPULT_ALIASES } from './catapult-aliases.js';
import { DEFAULT_POD_METRIC_CONFIG_NOTES, podMetricConfigSeed } from './pod-metrics.js';

function podMetricsMigration(): string {
  const files = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('_pod_metrics.sql'));
  expect(files).toHaveLength(1);
  return readFileSync(join(MIGRATIONS_FOLDER, files[0] ?? ''), 'utf8');
}

describe('pod_metrics migration', () => {
  const sql = podMetricsMigration();

  it('seeds the domain defaults, unverified, from the seeded first day', () => {
    const literals = [...sql.matchAll(/'(\{[^']*\})'::jsonb/g)].map(
      (m): unknown => JSON.parse(m[1] ?? '') as unknown,
    );
    expect(literals).toEqual([DEFAULT_POD_METRIC_PARAMS]);
    expect(sql).toContain(`'${POD_METRICS_ALGORITHM_VERSION}'`);
    expect(sql).toContain(`'${DEFAULT_POD_METRIC_CONFIG_NOTES}'`);
    expect(sql).toContain(`DATE '${DEFAULT_SEED_VALID_FROM}'`);
    expect(podMetricConfigSeed(DEFAULT_SEED_VALID_FROM)).toMatchObject({
      params: DEFAULT_POD_METRIC_PARAMS,
      verification: 'unverified',
      sport: null,
      sex: null,
    });
  });

  it('adds the sprint codes as the dictionary defines them', () => {
    for (const code of ['sprints_n', 'sprint_dist_m'] as const) {
      const metric = CANONICAL_METRICS[code];
      const aliases = DEFAULT_CATAPULT_ALIASES[code].map((a) => `'${a}'`).join(', ');
      expect(sql).toContain(
        `('${code}', '${metric.unit}', '${metric.direction}', '${metric.description}', ARRAY[${aliases}]::text[])`,
      );
      expect(metric.source).toBe('field');
    }
  });
});
