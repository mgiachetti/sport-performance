/** Maturation (B-203): maturity offset, Khamis-Roche, growth velocity and peak zone. */

export {
  COEFFICIENT_VERIFICATION_STATUSES,
  isCoefficientVerificationStatus,
  type CoefficientProvenance,
  type CoefficientVerificationStatus,
} from './provenance.js';

export {
  DEFAULT_MATURITY_OFFSET_EQUATION,
  MATURITY_OFFSET_EQUATIONS,
  MATURITY_OFFSET_MODELS,
  MATURITY_OFFSET_TERMS,
  MATURITY_OFFSET_WARNINGS,
  isMaturityOffsetEquation,
  maturityOffset,
  maturityOffsetModel,
  maturityOffsetRequiredInputs,
  parseMaturityOffsetEquation,
  predictMaturityOffset,
  type MaturityOffsetEquation,
  type MaturityOffsetInput,
  type MaturityOffsetModel,
  type MaturityOffsetResult,
  type MaturityOffsetTerm,
  type MaturityOffsetWarning,
} from './maturity-offset.js';

export {
  CM_PER_INCH,
  DEFAULT_KHAMIS_ROCHE_PARAMS,
  KG_PER_POUND,
  KHAMIS_ROCHE_AGE_MODES,
  assertValidKhamisRocheTable,
  isKhamisRocheAgeMode,
  khamisRocheAgeRangeYears,
  khamisRocheCoefficients,
  khamisRocheSupportsAge,
  predictAdultHeight,
  type AdultHeightInput,
  type AdultHeightResult,
  type KhamisRocheAgeMode,
  type KhamisRocheParams,
  type KhamisRocheRow,
  type KhamisRocheTable,
} from './khamis-roche.js';
export { KHAMIS_ROCHE_1994_TABLE } from './khamis-roche-1994.js';

export {
  DEFAULT_GROWTH_VELOCITY_PARAMS,
  growthVelocityCmYear,
  latestGrowthVelocity,
  type GrowthVelocityParams,
  type GrowthVelocityResult,
  type HeightMeasurement,
} from './growth-velocity.js';

export {
  DEFAULT_PEAK_ZONE_PARAMS,
  peakHeightVelocityZone,
  type PeakZoneCriterionStatus,
  type PeakZoneInput,
  type PeakZoneParams,
  type PeakZoneResult,
} from './peak-zone.js';
