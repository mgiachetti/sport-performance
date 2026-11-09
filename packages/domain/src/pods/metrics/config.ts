import { DomainValidationError } from '../../errors.js';
import type { ClubId } from '../../ids.js';
import type { Sex } from '../../sex.js';
import type { Sport } from '../../sport.js';
import { compareLocalDates, type LocalDate } from '../../time.js';
import { DEFAULT_POD_METRIC_PARAMS, type PodMetricParams } from './params.js';

/**
 * A club's pod metric definitions (`pod_metric_config`), scoped by sport and
 * sex (`null` = any) and dated like the speed zones (ADR 0041): from
 * `validFrom` (inclusive) to `validTo` (exclusive). Changing a definition
 * closes the row in force and opens another, so a past session is always
 * recomputed with the definitions it had. `verification` says whether the
 * values are the seeded defaults (`unverified`) or the club's OpenField
 * settings (`club_openfield`, B-002).
 */
export interface PodMetricConfig {
  readonly clubId: ClubId;
  readonly sport: Sport | null;
  readonly sex: Sex | null;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
  readonly params: PodMetricParams;
}

export const POD_METRIC_CONFIG_VERIFICATIONS = ['unverified', 'club_openfield'] as const;
export type PodMetricConfigVerification = (typeof POD_METRIC_CONFIG_VERIFICATIONS)[number];

export interface PodMetricConfigQuery {
  readonly clubId: ClubId;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly onDate: LocalDate;
}

/** Sport outranks sex, like the speed zones. */
export function podMetricConfigSpecificity(config: PodMetricConfig): number {
  return (config.sport === null ? 0 : 2) + (config.sex === null ? 0 : 1);
}

function applies(config: PodMetricConfig, query: PodMetricConfigQuery): boolean {
  return (
    config.clubId === query.clubId &&
    (config.sport === null || config.sport === query.sport) &&
    (config.sex === null || config.sex === query.sex) &&
    compareLocalDates(config.validFrom, query.onDate) <= 0 &&
    (config.validTo === null || compareLocalDates(query.onDate, config.validTo) < 0)
  );
}

/**
 * The most specific configuration in force for the player on the session's
 * day, or `null`. Two equally specific ones on the same day are a data error
 * and throw (the domain never picks one silently).
 */
export function resolvePodMetricConfig<C extends PodMetricConfig>(
  configs: readonly C[],
  query: PodMetricConfigQuery,
): C | null {
  let best: C | null = null;
  let bestSpecificity = -1;
  let tied = false;
  for (const config of configs) {
    if (!applies(config, query)) continue;
    const specificity = podMetricConfigSpecificity(config);
    if (specificity > bestSpecificity) {
      best = config;
      bestSpecificity = specificity;
      tied = false;
    } else if (specificity === bestSpecificity) tied = true;
  }
  if (tied) {
    throw new DomainValidationError(
      'invalid_argument',
      `Ambiguous pod metric definitions on ${query.onDate}: more than one with the same scope applies.`,
      query,
    );
  }
  return best;
}

/** The definitions in force, or the seeded defaults when the club has none. */
export function resolvePodMetricParams(
  configs: readonly PodMetricConfig[],
  query: PodMetricConfigQuery,
): PodMetricParams {
  return resolvePodMetricConfig(configs, query)?.params ?? DEFAULT_POD_METRIC_PARAMS;
}
