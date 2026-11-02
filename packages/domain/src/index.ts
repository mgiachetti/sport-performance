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
  DEVICE_BROWSERS,
  DEVICE_OPERATING_SYSTEMS,
  SESSION_CLIENT_TYPES,
  isDeviceBrowser,
  isDeviceOperatingSystem,
  isSessionClientType,
  type DeviceBrowser,
  type DeviceOperatingSystem,
  type SessionClientType,
} from './session-device.js';
export { ROLES, isRole, parseRole, type Role } from './role.js';
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
  MEMBERSHIP_ROLES,
  isMembershipRole,
  parseMembershipRole,
  type MembershipRole,
} from './roles.js';
export {
  STAFF_ASSIGNMENT_ROLES,
  STAFF_ASSIGNMENT_STATUSES,
  endedValidTo,
  isEmptyValidity,
  isStaffAssignmentRole,
  staffAssignmentStatus,
  validitiesOverlap,
  type AssignmentValidity,
  type StaffAssignmentRole,
  type StaffAssignmentStatus,
} from './staff-assignment.js';
export {
  TEST_NOT_DONE_REASONS,
  TEST_RESULT_STATUSES,
  isTestNotDoneReason,
  isTestResultStatus,
  parseTestNotDoneReason,
  parseTestResultStatus,
  type TestNotDoneReason,
  type TestResultStatus,
} from './test-result.js';
export {
  CHANGE_OPERATIONS,
  CHANGE_REASON_MAX_LENGTH,
  CHANGE_SOURCES,
  CHANGE_TRACKED_TABLES,
  isChangeOperation,
  isChangeSource,
  isChangeTrackedTable,
  parseChangeOperation,
  parseChangeReason,
  parseChangeSource,
  parseChangeTrackedTable,
  type ChangeOperation,
  type ChangeSource,
  type ChangeTrackedTable,
} from './change-history.js';

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
// Speed zones (B-209).
export * from './speed-zones/index.js';
export * from './exposure/index.js';
// Percentiles by group and first-team references (B-208).
export {
  SUMMARY_PERCENTILES,
  percentileRank,
  summarizeDistribution,
  valueAtPercentile,
  type DistributionSummary,
  type SummaryPercentile,
} from './percentiles/distribution.js';
export {
  DEFAULT_PERCENTILE_SETTINGS,
  METHOD_POLICIES,
  PERCENTILE_GROUP_DIMENSIONS,
  PLAYER_AGGREGATIONS,
  assertPercentileSettings,
  buildPercentileGroup,
  computePercentile,
  isMethodPolicy,
  isPercentileGroupDimension,
  isPlayerAggregation,
  resolvePlayerAggregation,
  type MethodPolicy,
  type PercentileAttempt,
  type PercentileGroup,
  type PercentileGroupDimension,
  type PercentileGroupOptions,
  type PercentileGrouping,
  type PercentileResult,
  type PercentileSample,
  type PercentileSettings,
  type PercentileSubject,
  type PlayerAggregation,
} from './percentiles/groups.js';
export {
  DEFAULT_POSITION_LINES,
  HOCKEY_LINE_CODES,
  RUGBY_LINE_CODES,
  lineForPosition,
  type HockeyLineCode,
  type PositionLine,
  type RugbyLineCode,
} from './percentiles/positions.js';
export {
  compareToFirstTeamReference,
  referenceScope,
  selectFirstTeamReference,
  type FirstTeamReference,
  type FirstTeamReferenceQuery,
  type ReferenceComparison,
  type ReferenceComparisonInput,
  type ReferenceScope,
} from './percentiles/references.js';
// Consents (B-312) and the permission matrix (B-303).
export {
  AGE_OF_MAJORITY_YEARS,
  CONSENT_SIGNERS,
  CONSENT_TYPES,
  isConsentSigner,
  isConsentType,
  parseConsentSigner,
  parseConsentType,
  type ConsentSigner,
  type ConsentType,
} from './consent.js';
export * from './permissions/index.js';
// Medical module vocabularies (B-304, ADR 0008, ADR 0029).
export {
  AVAILABILITY_STATUSES,
  CONCUSSION_GRTP_STAGES,
  CONCUSSION_LAST_RECORDED_STAGE,
  CONCUSSION_STAGE_OUTCOMES,
  INJURY_BODY_REGIONS,
  INJURY_MECHANISMS,
  INJURY_ONSETS,
  INJURY_SIDES,
  MEDICAL_ACCESS_ACTIONS,
  MEDICAL_NOTE_VISIBILITIES,
  concussionAvailability,
  isAvailabilityStatus,
  isConcussionStageOutcome,
  isInjuryBodyRegion,
  isInjuryMechanism,
  isInjuryOnset,
  isInjurySide,
  isMedicalAccessAction,
  isMedicalNoteVisibility,
  notDoneReasonForViewer,
  parseAvailabilityStatus,
  worstAvailability,
  type AvailabilityStatus,
  type ConcussionAvailability,
  type ConcussionStageOutcome,
  type InjuryBodyRegion,
  type InjuryMechanism,
  type InjuryOnset,
  type InjurySide,
  type MedicalAccessAction,
  type MedicalNoteVisibility,
} from './medical.js';
