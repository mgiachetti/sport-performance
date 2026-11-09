import {
  DEFAULT_POD_METRIC_PARAMS,
  POD_METRICS_ALGORITHM_VERSION,
  type LocalDate,
} from '@sport-performance/domain';
import type { NewPodMetricConfig } from '../types.js';
import type { ClubSeedRow } from './metrics.js';

/** Note of the seeded definitions: what they are and what replaces them (B-002). */
export const DEFAULT_POD_METRIC_CONFIG_NOTES =
  'Valores por defecto (convenciones publicadas de OpenField), sin verificar: reemplazar con la configuración de OpenField de primera (B-002).';

/**
 * The pod's metric definitions of a new club (B-919): one club-wide row with
 * the domain's defaults, `unverified` until the club loads its OpenField
 * settings. Migration `0056_pod_metrics` writes the same row for the clubs
 * bootstrapped before (a unit test keeps both equal).
 */
export function podMetricConfigSeed(validFrom: LocalDate): ClubSeedRow<NewPodMetricConfig> {
  return {
    sport: null,
    sex: null,
    algorithmVersion: POD_METRICS_ALGORITHM_VERSION,
    params: DEFAULT_POD_METRIC_PARAMS,
    verification: 'unverified',
    notes: DEFAULT_POD_METRIC_CONFIG_NOTES,
    validFrom,
  };
}
