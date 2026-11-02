/** Physical tests (B-205): scoring formulas of the test battery. */

export {
  ATTEMPT_AGGREGATIONS,
  DEFAULT_ATTEMPT_SCORING,
  aggregateAttempts,
  aggregateCanonicalMetricAttempts,
  isAttemptAggregation,
  parseAttemptAggregation,
  type AttemptAggregate,
  type AttemptAggregation,
  type AttemptAggregationOptions,
  type AttemptScoredMetricCode,
  type AttemptScoring,
} from './attempts.js';

export {
  cmjHeightCmFromFlightTimeS,
  flightTimeSFromFrames,
  scoreCmj,
  type CmjScore,
  type CmjScoreInput,
  type VideoFlightFrames,
} from './cmj.js';

export {
  SPRINT_VMAX_SEGMENT,
  assertSprint40Splits,
  scoreSprint40,
  segmentSpeedMs,
  sprintVmaxMs,
  type Sprint40Score,
  type Sprint40ScoreOptions,
  type Sprint40Splits,
  type SprintVmaxSegment,
} from './sprint.js';

export {
  cod505Asymmetry,
  cod505AsymmetryPct,
  scoreCod505,
  type Cod505Asymmetry,
  type Cod505FasterSide,
  type Cod505Score,
  type Cod505ScoreInput,
  type Cod505Times,
} from './cod505.js';

export {
  DEFAULT_E1RM_PROTOCOL,
  E1RM_SET_ISSUES,
  e1rmSetIssues,
  epleyE1rmKg,
  relativeStrengthKgKg,
  scoreE1rm,
  type E1rmProtocol,
  type E1rmScore,
  type E1rmSetIssue,
  type StrengthSet,
} from './strength.js';

export {
  DEFAULT_IFT_3015_PROTOCOL,
  intermittentRunDistanceM,
  vift3015Kmh,
  type IntermittentRunInput,
  type Ift3015Protocol,
} from './ift3015.js';

export {
  DEFAULT_TEST_SCORING_SETTINGS,
  RESULT_LEVEL_DERIVED_METRICS,
  STRENGTH_METRICS_BY_ASSESSMENT,
  TEST_COMPARISON_WARNINGS,
  TEST_ENTRY_KINDS,
  TEST_ENTRY_KINDS_BY_TEST,
  TEST_NOT_APPLICABLE_REASONS,
  batteryIncludesTest,
  deriveResultMetrics,
  entryKindsOfTest,
  isTestEntryKind,
  scoreResultMetrics,
  scoreTestEntry,
  strengthMetricAllowed,
  testApplicability,
  testComparisonWarnings,
  testScoringSettings,
  type BatteryPlayer,
  type BatteryRow,
  type ComparedMeasurement,
  type EntryMetricValue,
  type MetricScore,
  type MetricScoringRule,
  type ResultDerivationContext,
  type ResultMetricValue,
  type ScoredEntry,
  type TestApplicability,
  type TestComparisonWarning,
  type TestEntryInput,
  type TestEntryKind,
  type TestNotApplicableReason,
  type TestScoringSettings,
} from './recording.js';
