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
  DOMINANT_SIDES,
  HEIGHT_SOURCES,
  PARENTS,
  PLAYER_LEAVE_REASONS,
  isDominantSide,
  isHeightSource,
  isParent,
  isPlayerLeaveReason,
  parseDominantSide,
  parseHeightSource,
  parseParent,
  parsePlayerLeaveReason,
  type DominantSide,
  type HeightSource,
  type Parent,
  type PlayerLeaveReason,
} from './player.js';
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
// Derived values for the panel (B-326).
export * from './derived/index.js';
export * from './alerts/index.js';
// Speed zones (B-209).
export * from './speed-zones/index.js';
export * from './battery/index.js';
export {
  CLUB_MODULES,
  DEFAULT_CLUB_MODULES,
  applyClubModuleChanges,
  isClubModule,
  parseClubModule,
  resolveClubModules,
  type ClubModule,
  type ClubModules,
} from './club-modules.js';
export * from './exposure/index.js';
export * from './calendar/index.js';
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
  CONSENT_STATES,
  CONSENT_TYPES,
  consentSignerOfRole,
  consentStates,
  currentConsentTypes,
  isConsentSigner,
  isConsentType,
  isCurrentConsent,
  parseConsentSigner,
  parseConsentType,
  requiredConsentSigner,
  type ConsentRecord,
  type ConsentSigner,
  type ConsentState,
  type ConsentType,
  type ConsentTypeState,
  type CurrentConsentDocument,
} from './consent.js';
// Guardians and accounts of minors without email (B-310).
export {
  GUARDIAN_RELATIONSHIPS,
  NO_EMAIL_ACCOUNT_DOMAIN,
  isGuardianRelationship,
  isUndeliverableEmail,
  noEmailAccountAddress,
  parseGuardianRelationship,
  type GuardianRelationship,
} from './guardian.js';
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
// Training sessions, drills, participation and the RPE window (B-318).
export * from './training/index.js';
// Wellness check-in (B-319).
export * from './wellness/index.js';

export {
  CLIENT_UPLOAD_FILE_KINDS,
  FILE_KINDS,
  FILE_KIND_POLICIES,
  FILE_NAME_MAX_LENGTH,
  FILE_STATUSES,
  FILE_UPLOAD_URL_MAX_TTL_S,
  PENDING_UPLOAD_RETENTION_HOURS,
  SHA256_BASE64_PATTERN,
  SIGNED_URL_CLOCK_SKEW_S,
  deletedFileExpiresAt,
  fileExpiresAt,
  fileObjectKey,
  fileUploadProblems,
  isFileKind,
  isFileStatus,
  parseFileKind,
  parseFileStatus,
  pendingUploadExpiresAt,
  sanitizeFileName,
  type ClientUploadFileKind,
  type FileKind,
  type FileKindPolicy,
  type FileRetention,
  type FileStatus,
  type FileSubject,
} from './files.js';
// App versions and compatibility (B-324).
export * from './app-version/index.js';
