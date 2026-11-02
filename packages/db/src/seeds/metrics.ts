import {
  CANONICAL_METRICS,
  CANONICAL_METRIC_CODES,
  type CanonicalMetric,
  type CanonicalMetricCode,
} from '@sport-performance/domain';
import type { NewMetricDefinition } from '../types.js';
import { DEFAULT_CATAPULT_ALIASES } from './catapult-aliases.js';

/** A seed row without the club (added by `bootstrapClub`). */
export type ClubSeedRow<T> = Omit<T, 'clubId'>;

/** Catapult aliases of a canonical metric (empty when it has none). */
export function catapultAliasesOf(code: CanonicalMetricCode): readonly string[] {
  const aliases: Partial<Readonly<Record<CanonicalMetricCode, readonly string[]>>> =
    DEFAULT_CATAPULT_ALIASES;
  return aliases[code] ?? [];
}

/**
 * The metric dictionary of a new club: every `CANONICAL_METRICS` entry, in
 * dictionary order, with its unit, source, direction, test, sports and
 * Catapult aliases. Canonical codes keep their definition (`is_canonical`).
 */
export function metricDefinitionSeeds(): ClubSeedRow<NewMetricDefinition>[] {
  return CANONICAL_METRIC_CODES.map((code) => {
    const metric: CanonicalMetric = CANONICAL_METRICS[code];
    return {
      code,
      unit: metric.unit,
      source: metric.source,
      direction: metric.direction,
      testCode: metric.test ?? null,
      sports: metric.sports === undefined ? null : [...metric.sports],
      description: metric.description,
      catapultAliases: [...catapultAliasesOf(code)],
      isCanonical: true,
    };
  });
}
