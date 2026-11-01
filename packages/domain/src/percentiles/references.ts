import type { MetricCode, MetricDirection } from '../codes.js';
import { DomainValidationError, describeValue } from '../errors.js';
import type { MeasurementMethod } from '../measurement.js';
import type { Sex } from '../sex.js';
import type { Sport } from '../sport.js';
import { compareLocalDates, type LocalDate } from '../time.js';
import type { UnitCode } from '../units.js';
import { assertFinite } from './distribution.js';

/**
 * A first-team value used as the reference line of the player profile
 * (B-004, B-321). Loaded by the club (manually or from a Catapult import);
 * the domain only selects and compares.
 *
 * Scope: `positionCode` makes it position-specific, otherwise `lineCode`
 * makes it line-specific, otherwise it applies to the whole squad.
 */
export interface FirstTeamReference {
  readonly metricCode: MetricCode;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly positionCode?: string;
  readonly lineCode?: string;
  readonly value: number;
  readonly unit: UnitCode;
  /** How the first team measured it, when known. */
  readonly method?: MeasurementMethod;
  /** First day the reference applies (references are replaced, not edited). */
  readonly validFrom: LocalDate;
  /** Where it comes from ("Catapult 2026 preseason"), for the tooltip. */
  readonly source: string;
}

export interface FirstTeamReferenceQuery {
  readonly metricCode: MetricCode;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly positionCode?: string;
  readonly lineCode?: string;
  /** Date of the value being compared; later references are ignored. */
  readonly asOf: LocalDate;
}

/** How specific the selected reference is. */
export type ReferenceScope = 'position' | 'line' | 'squad';

export function referenceScope(reference: FirstTeamReference): ReferenceScope {
  if (reference.positionCode !== undefined) return 'position';
  if (reference.lineCode !== undefined) return 'line';
  return 'squad';
}

const SCOPE_RANK: Readonly<Record<ReferenceScope, number>> = { position: 2, line: 1, squad: 0 };

/**
 * The reference that applies to a query: same metric, sport and sex; the most
 * specific scope that matches (position, then line, then squad); and, within
 * it, the latest `validFrom` not after `asOf`. `undefined` when none applies.
 * A position or line reference never applies to another position or line.
 */
export function selectFirstTeamReference<R extends FirstTeamReference>(
  references: readonly R[],
  query: FirstTeamReferenceQuery,
): R | undefined {
  let selected: R | undefined;
  for (const ref of references) {
    if (ref.metricCode !== query.metricCode || ref.sport !== query.sport) continue;
    if (ref.sex !== query.sex) continue;
    if (compareLocalDates(ref.validFrom, query.asOf) > 0) continue;
    const scope = referenceScope(ref);
    if (scope === 'position' && ref.positionCode !== query.positionCode) continue;
    if (scope === 'line' && ref.lineCode !== query.lineCode) continue;
    if (selected === undefined || isPreferred(ref, selected)) selected = ref;
  }
  return selected;
}

function isPreferred(candidate: FirstTeamReference, current: FirstTeamReference): boolean {
  const byScope = SCOPE_RANK[referenceScope(candidate)] - SCOPE_RANK[referenceScope(current)];
  if (byScope !== 0) return byScope > 0;
  return compareLocalDates(candidate.validFrom, current.validFrom) > 0;
}

/** A youth value to compare against the first-team reference. */
export interface ReferenceComparisonInput {
  readonly value: number;
  readonly unit: UnitCode;
  readonly method?: MeasurementMethod;
}

export interface ReferenceComparison {
  readonly referenceValue: number;
  readonly scope: ReferenceScope;
  /** `value − reference`, in the metric's unit. */
  readonly differenceAbs: number;
  /** `(value − reference) / reference × 100`; `null` when the reference is 0. */
  readonly differencePct: number | null;
  /** `value / reference × 100`; `null` when the reference is 0. */
  readonly valuePctOfReference: number | null;
  /**
   * Whether the value reaches the reference by the metric direction
   * (`>=` for higher is better, `<=` for lower is better); `null` for
   * neutral metrics.
   */
  readonly meetsReference: boolean | null;
  /** Both methods are known and differ: the UI must warn (principle 4). */
  readonly methodMismatch: boolean;
}

/**
 * Compares a value with a first-team reference. Units must match exactly
 * (values arrive in the metric's canonical unit); a mismatch is an error, not
 * a silent conversion.
 */
export function compareToFirstTeamReference(
  input: ReferenceComparisonInput,
  reference: FirstTeamReference,
  direction: MetricDirection,
): ReferenceComparison {
  assertFinite(input.value, 'value');
  assertFinite(reference.value, 'reference.value');
  if (input.unit !== reference.unit) {
    throw new DomainValidationError(
      'invalid_argument',
      `Unit mismatch: value in ${describeValue(input.unit)}, reference in ${describeValue(reference.unit)}.`,
      input.unit,
    );
  }
  const differenceAbs = input.value - reference.value;
  const hasBase = reference.value !== 0;
  return {
    referenceValue: reference.value,
    scope: referenceScope(reference),
    differenceAbs,
    differencePct: hasBase ? (differenceAbs / Math.abs(reference.value)) * 100 : null,
    valuePctOfReference: hasBase ? (input.value / reference.value) * 100 : null,
    meetsReference:
      direction === 'neutral'
        ? null
        : direction === 'higher_is_better'
          ? input.value >= reference.value
          : input.value <= reference.value,
    methodMismatch:
      input.method !== undefined &&
      reference.method !== undefined &&
      input.method !== reference.method,
  };
}
