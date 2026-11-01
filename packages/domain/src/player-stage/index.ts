/**
 * Player stage (B-204): stage assignment from category plus maturity offset,
 * staff pins and bio-banding.
 */
export {
  DEFAULT_FEMALE_STAGE_ASSIGNMENT_PARAMS,
  DEFAULT_MALE_STAGE_ASSIGNMENT_PARAMS,
  DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX,
  PHV_OFFSET_YEARS_RANGE,
  assertPhvOffsetYears,
  parseStageAssignmentParams,
  type StageAssignmentParams,
} from './params.js';
export {
  AUTOMATIC_STAGE_REASONS,
  STAGE_BASES,
  STAGE_REASONS,
  activeStagePin,
  assignPlayerStage,
  automaticPlayerStage,
  createPlayerStageAssigner,
  maturationStageForPhvOffset,
  projectPhvOffsetYears,
  type AssignPlayerStageInput,
  type AutomaticStageAssignment,
  type AutomaticStageReason,
  type PhvOffsetEstimate,
  type StageAssignment,
  type StageBasis,
  type StageReason,
  type StagePin,
} from './assign.js';
export {
  BIO_BAND_INDICATORS,
  DEFAULT_BIO_BANDING_SCHEMES,
  DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING,
  DEFAULT_PHV_OFFSET_BIO_BANDING,
  bioBandFor,
  createBioBandLookup,
  groupByBioBand,
  isBioBandIndicator,
  parseBioBandIndicator,
  parseBioBandScheme,
  type BioBand,
  type BioBandGroup,
  type BioBandGrouping,
  type BioBandIndicator,
  type BioBandScheme,
} from './bio-banding.js';
