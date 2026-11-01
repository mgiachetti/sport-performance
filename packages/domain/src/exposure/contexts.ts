import { memberGuard, memberParser } from '../enum.js';

/**
 * Where exposure is accrued: club training sessions and matches (B-318).
 * Incidence is always reported per context because match incidence is an
 * order of magnitude higher than training incidence (Fuller et al. 2007).
 */
export const EXPOSURE_CONTEXTS = ['training', 'match'] as const;
export type ExposureContext = (typeof EXPOSURE_CONTEXTS)[number];

export const isExposureContext = memberGuard(EXPOSURE_CONTEXTS);
export const parseExposureContext = memberParser(
  EXPOSURE_CONTEXTS,
  'invalid_argument',
  'exposure context',
);

/**
 * Activity in which an injury happened. `other` is outside club activity
 * (school, another sport): there is no recorded exposure for it, so it never
 * enters a rate and is reported apart.
 */
export const INJURY_CONTEXTS = ['training', 'match', 'other'] as const;
export type InjuryContext = (typeof INJURY_CONTEXTS)[number];

export const isInjuryContext = memberGuard(INJURY_CONTEXTS);
export const parseInjuryContext = memberParser(
  INJURY_CONTEXTS,
  'invalid_argument',
  'injury context',
);
