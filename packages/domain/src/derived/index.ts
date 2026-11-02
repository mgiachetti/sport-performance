/**
 * Values the worker derives for the panel (B-326): club parameters, wellness
 * against the player's own baseline and maturation per measurement. The
 * load series itself is `computeLoadSeries` (B-202).
 */
export {
  DEFAULT_DERIVED_PARAMETERS,
  DEFAULT_MATURATION_PARAMS,
  DEFAULT_WELLNESS_BASELINE_PARAMS,
  MAX_WELLNESS_BASELINE_DAYS,
  resolveDerivedParameters,
  type DerivedParameters,
  type MaturationParams,
  type WellnessBaselineParams,
} from './parameters.js';
export {
  wellnessBaselineSeries,
  type WellnessBaselineDay,
  type WellnessDay,
} from './wellness-baseline.js';
export {
  deriveMaturation,
  maturityOffsetEquationChain,
  type AnthropometryInput,
  type MaturationInput,
  type MaturationResult,
} from './maturation.js';
