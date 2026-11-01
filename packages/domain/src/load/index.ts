/**
 * Training load (B-202): sRPE, EWMA acute and chronic load, ACWR, Foster's
 * monotony and strain. Pure functions; configurable parameters are inputs
 * with defaults in {@link DEFAULT_LOAD_PARAMETERS}.
 */
export {
  DEFAULT_LOAD_PARAMETERS,
  EWMA_SEEDS,
  MAX_LOAD_WINDOW_DAYS,
  STANDARD_DEVIATION_KINDS,
  isEwmaSeed,
  isStandardDeviationKind,
  resolveLoadParameters,
  type EwmaSeed,
  type LoadParameters,
  type StandardDeviationKind,
} from './parameters.js';
export {
  MAX_SESSION_DURATION_MIN,
  RPE_CR10_MAX,
  RPE_CR10_MIN,
  sessionRpeLoadAu,
  type SessionRpeInput,
} from './srpe.js';
export { acuteChronicWorkloadRatio, ewmaLambda, ewmaSeriesAu, nextEwmaAu } from './ewma.js';
export { fosterMonotony, type MonotonySummary } from './monotony.js';
export {
  computeLoadSeries,
  dailyLoadsFromSessions,
  fillDailyLoads,
  isoWeekLoadSummaries,
  type AcwrStatus,
  type DailyLoad,
  type DailyLoadMetrics,
  type DailyLoadRangeInput,
  type DatedLoad,
  type LoadSeriesInput,
  type MonotonyStatus,
  type WeekLoadStatus,
  type WeekLoadSummariesInput,
  type WeekLoadSummary,
} from './series.js';
