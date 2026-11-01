/**
 * @sport-performance/domain: pure domain model and formulas. No I/O.
 *
 * Every closed enumeration follows the same shape: a `UPPER_CASE` constant as
 * the source of truth, a derived type, an `isX` guard and a `parseX` parser
 * that throws {@link DomainValidationError}.
 */

/** Workspace package identifier (used by the app skeletons). */
export const packageName = '@sport-performance/domain' as const;

export type { Brand } from './brand.js';
export { DomainValidationError, type DomainErrorCode } from './errors.js';

export { SPORTS, isSport, parseSport, type Sport } from './sport.js';
export { SEXES, isSex, parseSex, type Sex } from './sex.js';
export {
  STAGES,
  STAGE_PROFILES,
  compareStages,
  isStage,
  parseStage,
  type Stage,
  type StageProfile,
  type StrengthAssessment,
} from './stage.js';
export {
  DEFAULT_AGE_BANDS,
  ageBandForBirthYear,
  ageInSeasonYear,
  type AgeBand,
  type DefaultAgeBandCode,
} from './category.js';
export { maximalLoadTestsAllowed, strengthAssessmentFor } from './stage-rules.js';

export {
  STANDARD_GRAVITY_MS2,
  UNITS,
  UNIT_CODES,
  cmToM,
  isUnitCode,
  kmhToMs,
  mToCm,
  minutesToSeconds,
  msToKmh,
  msecToSeconds,
  parseUnitCode,
  ratioToPct,
  secondsToMinutes,
  secondsToMsec,
  type UnitCode,
  type UnitDefinition,
  type UnitDimension,
} from './units.js';

export {
  CANONICAL_METRICS,
  CANONICAL_METRIC_CODES,
  CANONICAL_TEST_CODES,
  UNITLESS_NAME_METRIC_CODES,
  canonicalMetricCode,
  canonicalMetricsOfTest,
  canonicalTestCode,
  isCanonicalMetricCode,
  isMetricCode,
  isTestCode,
  isWellFormedCode,
  parseMetricCode,
  parseTestCode,
  type CanonicalMetric,
  type CanonicalMetricCode,
  type CanonicalTestCode,
  type MetricCode,
  type MetricDirection,
  type MetricSource,
  type TestCode,
} from './codes.js';

export {
  MEASUREMENT_METHODS,
  WELLNESS_ITEMS,
  isMeasurementMethod,
  isWellnessItem,
  parseMeasurementMethod,
  parseWellnessItem,
  type MeasurementMethod,
  type WellnessItem,
} from './measurement.js';

export {
  isUuid,
  parseCategoryId,
  parseClubId,
  parsePlayerId,
  parseUserId,
  parseUuid,
  type CategoryId,
  type ClubId,
  type PlayerId,
  type UserId,
  type Uuid,
} from './ids.js';

export {
  DEFAULT_CLUB_TIME_ZONE,
  addDays,
  ageInCompletedYears,
  compareLocalDates,
  dayBoundsInTimeZone,
  dayBoundsRangeInTimeZone,
  daysBetween,
  decimalAgeYears,
  isLocalDate,
  isTimeZone,
  isoWeekday,
  localDate,
  localDateInTimeZone,
  localDateParts,
  localDateRange,
  parseLocalDate,
  parseTimeZone,
  startOfIsoWeek,
  type DayBounds,
  type Instant,
  type LocalDate,
  type LocalDateParts,
  type LocalDayBounds,
  type TimeZone,
} from './time.js';

export {
  DEFAULT_PLAUSIBLE_AGE_GROUP_BOUNDS_YEARS,
  DEFAULT_PLAUSIBLE_RANGES,
  checkPlausibleValue,
  createPlausibilityChecker,
  mergePlausibleRanges,
  validatePlausibleRanges,
  type PlausibilityChecker,
  type PlausibilityInput,
  type PlausibilityResult,
  type PlausibleBounds,
  type PlausibleRange,
} from './plausibility/index.js';
export * from './player-stage/index.js';
export * from './physical-tests/index.js';
export * from './load/index.js';
export * from './maturation/index.js';
export * from './alerts/index.js';
