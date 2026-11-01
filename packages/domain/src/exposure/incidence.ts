import { describeValue } from '../errors.js';
import { memberGuard, memberParser } from '../enum.js';
import type { PlayerId } from '../ids.js';
import { daysBetween, type LocalDate } from '../time.js';
import { isInjuryContext, type ExposureContext, type InjuryContext } from './contexts.js';
import { exposureHours, type ExposureEntry } from './exposure.js';
import { assertLocalDate, invalid, periodFilter, type DatePeriod } from './period.js';
import {
  assertConfidenceLevel,
  assertPositive,
  poissonRateConfidenceInterval,
  type ConfidenceInterval,
} from './poisson.js';

/**
 * Which recorded injuries count as cases (IOC 2020 consensus, Bahr et al.):
 * - `time_loss`: the player missed at least `minTimeLossDays` of full
 *   participation. The rugby standard (Fuller et al. 2007).
 * - `medical_attention`: every recorded injury, with or without time lost.
 */
export const INJURY_DEFINITIONS = ['time_loss', 'medical_attention'] as const;
export type InjuryDefinition = (typeof INJURY_DEFINITIONS)[number];

export const isInjuryDefinition = memberGuard(INJURY_DEFINITIONS);
export const parseInjuryDefinition = memberParser(
  INJURY_DEFINITIONS,
  'invalid_argument',
  'injury definition',
);

/** Per-club configuration of the injury statistics. */
export interface InjuryIncidenceParams {
  readonly definition: InjuryDefinition;
  /** With `time_loss`, minimum days lost (see {@link injuryTimeLoss}) to count a closed injury. */
  readonly minTimeLossDays: number;
  /** Rates are expressed per this many exposure hours. */
  readonly ratePerHours: number;
  /** Level of the exact Poisson confidence interval of each rate. */
  readonly confidenceLevel: number;
}

/**
 * Defaults, as data to seed per club: time-loss injuries of at least one day,
 * rates per 1000 h with a 95% confidence interval (Fuller et al. 2007).
 */
export const DEFAULT_INJURY_INCIDENCE_PARAMS: Readonly<InjuryIncidenceParams> = Object.freeze({
  definition: 'time_loss',
  minTimeLossDays: 1,
  ratePerHours: 1000,
  confidenceLevel: 0.95,
});

/**
 * One injury as the medical module records it (B-304). Only what the
 * statistics need: no diagnosis, so the caller can hand it to roles that see
 * aggregates.
 */
export interface InjuryRecord {
  readonly playerId: PlayerId;
  /** Club day the injury happened. Assigns the injury to a period. */
  readonly onsetDate: LocalDate;
  readonly context: InjuryContext;
  /** Club day of return to full participation; absent or `null` while the injury is open. */
  readonly returnDate?: LocalDate | null | undefined;
}

export interface InjuryTimeLoss {
  /**
   * Days lost (severity, Fuller et al. 2007): days from onset (day 0) to the
   * return to full participation. Returning the next day is 1 day. For an
   * injury still open at `asOfDate` (no return date, or a return after it),
   * days up to `asOfDate` (right-censored), so statistics as of a past day are
   * reproducible.
   */
  readonly daysLost: number;
  /** The player had not returned to full participation by `asOfDate`. */
  readonly ongoing: boolean;
}

/** Days lost by one injury as of `asOfDate` (which cannot be before the onset). */
export function injuryTimeLoss(injury: InjuryRecord, asOfDate: LocalDate): InjuryTimeLoss {
  assertLocalDate(asOfDate, 'asOfDate');
  assertInjury(injury, 'injury');
  return timeLoss(injury, asOfDate, 'injury');
}

function timeLoss(injury: InjuryRecord, asOfDate: LocalDate, label: string): InjuryTimeLoss {
  const { onsetDate, returnDate } = injury;
  if (asOfDate < onsetDate) {
    throw invalid(`${label} starts (${onsetDate}) after asOfDate (${asOfDate}).`, injury);
  }
  if (returnDate !== undefined && returnDate !== null && returnDate <= asOfDate) {
    return { daysLost: daysBetween(onsetDate, returnDate), ongoing: false };
  }
  return { daysLost: daysBetween(onsetDate, asOfDate), ongoing: true };
}

function assertInjury(injury: InjuryRecord, label: string): void {
  assertLocalDate(injury.onsetDate, `${label}.onsetDate`);
  if (!isInjuryContext(injury.context)) {
    throw invalid(
      `${label}.context must be training, match or other, got ${describeValue(injury.context)}.`,
      injury,
    );
  }
  const { returnDate } = injury;
  if (returnDate === undefined || returnDate === null) return;
  assertLocalDate(returnDate, `${label}.returnDate`);
  if (returnDate < injury.onsetDate) {
    throw invalid(
      `${label}.returnDate (${returnDate}) is before onsetDate (${injury.onsetDate}).`,
      injury,
    );
  }
}

function resolveParams(params: Partial<InjuryIncidenceParams> | undefined): InjuryIncidenceParams {
  const resolved: InjuryIncidenceParams = { ...DEFAULT_INJURY_INCIDENCE_PARAMS, ...params };
  if (!isInjuryDefinition(resolved.definition)) {
    throw invalid(
      `params.definition must be one of ${INJURY_DEFINITIONS.join(', ')}, got ${describeValue(resolved.definition)}.`,
      params,
    );
  }
  if (!Number.isSafeInteger(resolved.minTimeLossDays) || resolved.minTimeLossDays < 0) {
    throw invalid(
      `params.minTimeLossDays must be a non-negative integer, got ${describeValue(resolved.minTimeLossDays)}.`,
      params,
    );
  }
  assertPositive(resolved.ratePerHours, 'params.ratePerHours');
  assertConfidenceLevel(resolved.confidenceLevel);
  return resolved;
}

/**
 * Events per `ratePerHours` exposure hours. `null` without exposure: there is
 * no rate, not a rate of 0.
 */
export function ratePerExposureHours(
  count: number,
  exposureH: number,
  ratePerHours: number,
): number | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    throw invalid(`count must be a non-negative number, got ${describeValue(count)}.`, count);
  }
  if (typeof exposureH !== 'number' || !Number.isFinite(exposureH) || exposureH < 0) {
    throw invalid(
      `exposureH must be a non-negative number, got ${describeValue(exposureH)}.`,
      exposureH,
    );
  }
  assertPositive(ratePerHours, 'ratePerHours');
  return exposureH === 0 ? null : (count / exposureH) * ratePerHours;
}

/** Injuries per 1000 exposure hours; `null` without exposure. */
export function incidencePer1000H(injuryCount: number, exposureH: number): number | null {
  return ratePerExposureHours(injuryCount, exposureH, 1000);
}

/** Incidence and burden of one context (or of training and match together). */
export interface InjuryRate {
  /** Cases (injuries that meet the definition) with onset in the period. */
  readonly injuryCount: number;
  /** Of `injuryCount`, those still open at `asOfDate`. */
  readonly ongoingInjuryCount: number;
  readonly exposureH: number;
  /** Cases per `ratePerHours` h; `null` without exposure. */
  readonly incidence: number | null;
  /** Exact Poisson interval of `incidence`; `null` without exposure. */
  readonly incidenceConfidenceInterval: ConfidenceInterval | null;
  /** Days lost by the cases (open ones counted up to `asOfDate`). */
  readonly daysLost: number;
  /** Burden: days lost per `ratePerHours` h (IOC 2020); `null` without exposure. */
  readonly burden: number | null;
}

export interface InjuryIncidence {
  readonly training: InjuryRate;
  readonly match: InjuryRate;
  /** Training and match together: all cases over all exposure hours. */
  readonly overall: InjuryRate;
  /** Cases outside club activity (`other`): no exposure, so not in any rate. */
  readonly otherContextInjuryCount: number;
  /** Recorded injuries in the period left out by the definition (e.g. no time lost). */
  readonly excludedByDefinitionCount: number;
  /** Parameters actually used (defaults merged with the overrides). */
  readonly params: InjuryIncidenceParams;
}

export interface InjuryIncidenceInput {
  /** Participation of the population (e.g. a category), see {@link exposureHours}. */
  readonly exposures: readonly ExposureEntry[];
  /** Injuries of the same population. */
  readonly injuries: readonly InjuryRecord[];
  /** Day the statistics are computed for; open injuries are counted up to it. */
  readonly asOfDate: LocalDate;
  /** Inclusive period; injuries are assigned by onset date, exposure by session date. */
  readonly period?: DatePeriod | undefined;
  readonly params?: Partial<InjuryIncidenceParams> | undefined;
}

interface CaseTally {
  count: number;
  ongoing: number;
  daysLost: number;
}

function rate(tally: CaseTally, exposureH: number, params: InjuryIncidenceParams): InjuryRate {
  const hasExposure = exposureH > 0;
  return {
    injuryCount: tally.count,
    ongoingInjuryCount: tally.ongoing,
    exposureH,
    incidence: ratePerExposureHours(tally.count, exposureH, params.ratePerHours),
    incidenceConfidenceInterval: hasExposure
      ? poissonRateConfidenceInterval(
          tally.count,
          exposureH,
          params.confidenceLevel,
          params.ratePerHours,
        )
      : null,
    daysLost: tally.daysLost,
    burden: ratePerExposureHours(tally.daysLost, exposureH, params.ratePerHours),
  };
}

/**
 * Injury incidence per 1000 exposure hours (training, match and overall) of a
 * population in a period, with exact Poisson confidence intervals and injury
 * burden (Fuller et al. 2007; Bahr et al. 2020).
 *
 * The caller passes exposures and injuries of the same population. Every
 * record is validated, also those outside the period.
 */
export function injuryIncidence(input: InjuryIncidenceInput): InjuryIncidence {
  const params = resolveParams(input.params);
  assertLocalDate(input.asOfDate, 'asOfDate');
  const inPeriod = periodFilter(input.period);
  const exposure = exposureHours(input.exposures, input.period);

  const tallies: Record<ExposureContext, CaseTally> = {
    training: { count: 0, ongoing: 0, daysLost: 0 },
    match: { count: 0, ongoing: 0, daysLost: 0 },
  };
  let otherContextInjuryCount = 0;
  let excludedByDefinitionCount = 0;

  input.injuries.forEach((injury, index) => {
    const label = `injuries[${String(index)}]`;
    assertInjury(injury, label);
    if (!inPeriod(injury.onsetDate)) return;
    const loss = timeLoss(injury, input.asOfDate, label);
    const isCase =
      params.definition === 'medical_attention' ||
      loss.ongoing ||
      loss.daysLost >= params.minTimeLossDays;
    if (!isCase) {
      excludedByDefinitionCount++;
      return;
    }
    if (injury.context === 'other') {
      otherContextInjuryCount++;
      return;
    }
    const tally = tallies[injury.context];
    tally.count++;
    if (loss.ongoing) tally.ongoing++;
    tally.daysLost += loss.daysLost;
  });

  const overallTally: CaseTally = {
    count: tallies.training.count + tallies.match.count,
    ongoing: tallies.training.ongoing + tallies.match.ongoing,
    daysLost: tallies.training.daysLost + tallies.match.daysLost,
  };

  return {
    training: rate(tallies.training, exposure.trainingH, params),
    match: rate(tallies.match, exposure.matchH, params),
    overall: rate(overallTally, exposure.totalH, params),
    otherContextInjuryCount,
    excludedByDefinitionCount,
    params,
  };
}
