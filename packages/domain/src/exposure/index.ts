/**
 * Exposure and injury incidence (B-210): exposure hours from participation
 * and injuries per 1000 h with exact Poisson intervals and burden.
 */
export {
  EXPOSURE_CONTEXTS,
  INJURY_CONTEXTS,
  isExposureContext,
  isInjuryContext,
  parseExposureContext,
  parseInjuryContext,
  type ExposureContext,
  type InjuryContext,
} from './contexts.js';
export type { DatePeriod } from './period.js';
export {
  MAX_EXPOSURE_ENTRY_MIN,
  exposureHours,
  exposureHoursByPlayer,
  minutesToHours,
  type ExposureEntry,
  type ExposureHours,
} from './exposure.js';
export {
  poissonMeanConfidenceInterval,
  poissonRateConfidenceInterval,
  type ConfidenceInterval,
} from './poisson.js';
export {
  DEFAULT_INJURY_INCIDENCE_PARAMS,
  INJURY_DEFINITIONS,
  incidencePer1000H,
  injuryIncidence,
  injuryTimeLoss,
  isInjuryDefinition,
  parseInjuryDefinition,
  ratePerExposureHours,
  type InjuryDefinition,
  type InjuryIncidence,
  type InjuryIncidenceInput,
  type InjuryIncidenceParams,
  type InjuryRate,
  type InjuryRecord,
  type InjuryTimeLoss,
} from './incidence.js';
