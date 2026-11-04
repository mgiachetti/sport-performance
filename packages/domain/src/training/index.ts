/**
 * Training sessions and matches (B-318): drill and participation
 * vocabularies and the window of the player's RPE submission.
 */
export {
  CONTACT_LEVELS,
  FIELD_METRIC_SOURCES,
  NO_LOAD_PARTICIPATION_STATUSES,
  PARTICIPATION_STATUSES,
  isContactLevel,
  isFieldMetricSource,
  isParticipationStatus,
  parseContactLevel,
  parseParticipationStatus,
  participationCarriesLoad,
  type ContactLevel,
  type FieldMetricSource,
  type ParticipationStatus,
} from './vocabularies.js';
export {
  DEFAULT_RPE_WINDOW,
  MAX_RPE_WINDOW_CLUB_DAYS,
  rpeSubmissionWindow,
  rpeWindowState,
  type RpeWindow,
  type RpeWindowParameters,
  type RpeWindowSession,
  type RpeWindowState,
} from './rpe-window.js';
export {
  EXTERNAL_LOAD_ACTIVITIES,
  EXTERNAL_LOAD_DETAIL_MAX_LENGTH,
  EXTERNAL_LOAD_MINUTES_MAX,
  EXTERNAL_LOAD_MINUTES_MIN,
  EXTERNAL_LOAD_REPORT_WINDOW_DAYS,
  EXTERNAL_LOAD_RPE_MAX,
  EXTERNAL_LOAD_RPE_MIN,
  externalLoadAu,
  externalLoadIssues,
  externalLoadWindowStart,
  isExternalLoadActivity,
  isWithinExternalLoadWindow,
  parseExternalLoadActivity,
  type ExternalLoadActivity,
  type ExternalLoadProblem,
} from './external-load.js';
export {
  MATCH_PERIODS_MAX,
  SPORT_FIELD_RULES,
  SUBSTITUTION_MODES,
  periodMinutesIssues,
  periodMinutesTotal,
  recordsPeriodMinutes,
  sportFieldRules,
  sportRecordsContacts,
  type PeriodMinutesIssue,
  type PeriodMinutesProblem,
  type PitchDimensions,
  type SportFieldRules,
  type SubstitutionMode,
} from './field-rules.js';
export {
  catapultAliasIndex,
  catapultMetricOf,
  metricAppliesToSport,
  normalizeCatapultAlias,
  type CatapultAliasIndex,
  type CatapultAliasedMetric,
} from './catapult-aliases.js';
