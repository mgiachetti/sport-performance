import { DomainValidationError } from '../errors.js';
import {
  addDays,
  compareLocalDates,
  localDateRange,
  parseLocalDate,
  startOfIsoWeek,
  type LocalDate,
} from '../time.js';
import { acuteChronicWorkloadRatio, ewmaLambda, nextEwmaAu } from './ewma.js';
import { fosterMonotony } from './monotony.js';
import {
  DEFAULT_LOAD_PARAMETERS,
  resolveLoadParameters,
  type LoadParameters,
  type StandardDeviationKind,
} from './parameters.js';
import { assertLoadAu } from './validate.js';

/**
 * A load on a club day: one session (`srpe_au`) or a day's total. The date is
 * the club's day (`localDateInTimeZone(sessionStart, club.timeZone)`).
 */
export interface DatedLoad {
  readonly date: LocalDate;
  readonly loadAu: number;
}

/** A day of a gap-free series. */
export interface DailyLoad extends DatedLoad {
  /**
   * Whether any load was recorded that day. `false` is a day without data
   * (counted as 0 load); a recorded rest day is `loadAu: 0, hasData: true`.
   */
  readonly hasData: boolean;
}

/**
 * Sums the loads of each day (several sessions on the same day add up) and
 * sorts them by date. Input order does not matter.
 */
export function dailyLoadsFromSessions(sessions: readonly DatedLoad[]): DatedLoad[] {
  const totals = new Map<LocalDate, number>();
  sessions.forEach((session, index) => {
    const date = parseLocalDate(session.date);
    assertLoadAu(session.loadAu, `sessions[${String(index)}].loadAu`);
    totals.set(date, (totals.get(date) ?? 0) + session.loadAu);
  });
  return [...totals.entries()]
    .sort(([a], [b]) => compareLocalDates(a, b))
    .map(([date, loadAu]) => ({ date, loadAu }));
}

export interface DailyLoadRangeInput {
  readonly loads: readonly DatedLoad[];
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/**
 * Every day from `from` to `to` (both inclusive), with the day's summed load
 * and 0 on days without data. Loads outside the range are ignored.
 */
export function fillDailyLoads({ loads, from, to }: DailyLoadRangeInput): DailyLoad[] {
  const totals = new Map(dailyLoadsFromSessions(loads).map((day) => [day.date, day.loadAu]));
  return localDateRange(parseLocalDate(from), parseLocalDate(to)).map((date) => {
    const loadAu = totals.get(date);
    return loadAu === undefined
      ? { date, loadAu: 0, hasData: false }
      : { date, loadAu, hasData: true };
  });
}

/**
 * - `ok`: the ratio is valid and alert rules may use it.
 * - `insufficient_history`: fewer than `minHistoryDays` days of history; no
 *   ACWR is reported and no ACWR alert may fire.
 * - `zero_chronic_load`: enough history but no chronic load (the ratio is
 *   undefined).
 */
export type AcwrStatus = 'ok' | 'insufficient_history' | 'zero_chronic_load';

/**
 * - `ok`: monotony and strain are valid.
 * - `insufficient_history`: the window starts before the first day of history.
 * - `zero_variance`: every day of the window has the same load (including a
 *   window of rest), so the monotony is undefined.
 */
export type MonotonyStatus = 'ok' | 'insufficient_history' | 'zero_variance';

export interface DailyLoadMetrics extends DailyLoad {
  /**
   * Days from the first day of history to this day, both inclusive; 0 before
   * the history starts.
   */
  readonly historyDays: number;
  readonly acuteEwmaAu: number;
  readonly chronicEwmaAu: number;
  /** `null` unless `acwrStatus` is `ok`. */
  readonly acwr: number | null;
  readonly acwrStatus: AcwrStatus;
  /** Days without data in the last `acuteWindowDays` days of history. */
  readonly missingDaysInAcuteWindow: number;
  /** Days without data in the last `chronicWindowDays` days of history. */
  readonly missingDaysInChronicWindow: number;
  /** Load of the last `monotonyWindowDays` days of history (rolling weekly load). */
  readonly windowLoadAu: number;
  /** Foster's monotony over the rolling window; `null` unless `monotonyStatus` is `ok`. */
  readonly monotony: number | null;
  /** Window load × monotony; `null` unless `monotonyStatus` is `ok`. */
  readonly strainAu: number | null;
  readonly monotonyStatus: MonotonyStatus;
}

export interface LoadSeriesInput {
  /** Session or daily loads, in any order. Loads after `to` are ignored. */
  readonly loads: readonly DatedLoad[];
  /** Last day of the series (usually today in the club's zone). */
  readonly to: LocalDate;
  /**
   * First day returned (default: the first day of history). The EWMA is
   * always computed from the first day of history, whatever `from` is.
   */
  readonly from?: LocalDate | undefined;
  /**
   * First day of history: when monitoring started for the player. Default:
   * the first day with a load. Must not be after the first load.
   */
  readonly historyStart?: LocalDate | undefined;
  /** Club parameters; default {@link DEFAULT_LOAD_PARAMETERS}. */
  readonly parameters?: LoadParameters | undefined;
}

/**
 * Daily training load metrics of one player: EWMA acute and chronic load,
 * ACWR with its history status, missing days per window, and rolling Foster
 * monotony and strain. Days without data count as 0 load.
 */
export function computeLoadSeries(input: LoadSeriesInput): DailyLoadMetrics[] {
  const parameters = resolveLoadParameters(input.parameters ?? DEFAULT_LOAD_PARAMETERS);
  const to = parseLocalDate(input.to);
  const daily = dailyLoadsFromSessions(input.loads).filter(
    (day) => compareLocalDates(day.date, to) <= 0,
  );
  const historyStart = resolveHistoryStart(input.historyStart, daily);
  const from = input.from === undefined ? (historyStart ?? to) : parseLocalDate(input.from);
  if (compareLocalDates(from, to) > 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `computeLoadSeries: from (${from}) is after to (${to}).`,
      { from, to },
    );
  }

  const result: DailyLoadMetrics[] = [];
  for (
    let date = from;
    compareLocalDates(date, to) <= 0 &&
    (historyStart === undefined || compareLocalDates(date, historyStart) < 0);
    date = addDays(date, 1)
  ) {
    result.push(beforeHistory(date));
  }
  if (historyStart === undefined || compareLocalDates(historyStart, to) > 0) return result;

  const days = fillDailyLoads({ loads: daily, from: historyStart, to });
  const acuteLambda = ewmaLambda(parameters.acuteWindowDays);
  const chronicLambda = ewmaLambda(parameters.chronicWindowDays);
  // missingPrefix[i] = days without data among days[0, i).
  const missingPrefix = [0];
  const loadPrefix = [0];
  days.forEach((day, i) => {
    missingPrefix.push((missingPrefix[i] ?? 0) + (day.hasData ? 0 : 1));
    loadPrefix.push((loadPrefix[i] ?? 0) + day.loadAu);
  });
  const windowSum = (prefix: readonly number[], end: number, windowDays: number): number =>
    (prefix[end + 1] ?? 0) - (prefix[Math.max(0, end + 1 - windowDays)] ?? 0);

  let acuteEwmaAu = 0;
  let chronicEwmaAu = 0;
  days.forEach((day, i) => {
    if (i === 0 && parameters.ewmaSeed === 'first_day') {
      acuteEwmaAu = day.loadAu;
      chronicEwmaAu = day.loadAu;
    } else {
      acuteEwmaAu = nextEwmaAu(acuteEwmaAu, day.loadAu, acuteLambda);
      chronicEwmaAu = nextEwmaAu(chronicEwmaAu, day.loadAu, chronicLambda);
    }
    if (compareLocalDates(day.date, from) < 0) return;

    const historyDays = i + 1;
    const ratio = acuteChronicWorkloadRatio(acuteEwmaAu, chronicEwmaAu);
    const acwrStatus: AcwrStatus =
      historyDays < parameters.minHistoryDays
        ? 'insufficient_history'
        : ratio === null
          ? 'zero_chronic_load'
          : 'ok';

    const windowDays = parameters.monotonyWindowDays;
    let monotony: number | null = null;
    let strainAu: number | null = null;
    let monotonyStatus: MonotonyStatus = 'insufficient_history';
    if (historyDays >= windowDays) {
      const summary = fosterMonotony(
        days.slice(i + 1 - windowDays, i + 1).map((d) => d.loadAu),
        parameters.monotonyStandardDeviation,
      );
      monotony = summary.monotony;
      strainAu = summary.strainAu;
      monotonyStatus = monotony === null ? 'zero_variance' : 'ok';
    }

    result.push({
      ...day,
      historyDays,
      acuteEwmaAu,
      chronicEwmaAu,
      acwr: acwrStatus === 'ok' ? ratio : null,
      acwrStatus,
      missingDaysInAcuteWindow: windowSum(missingPrefix, i, parameters.acuteWindowDays),
      missingDaysInChronicWindow: windowSum(missingPrefix, i, parameters.chronicWindowDays),
      windowLoadAu: windowSum(loadPrefix, i, windowDays),
      monotony,
      strainAu,
      monotonyStatus,
    });
  });
  return result;
}

/**
 * - `ok`: the seven days are within the history and not after `to`.
 * - `incomplete_week`: part of the week is before the history or after `to`
 *   (for example, the current week); totals cover the known days only.
 * - `zero_variance`: the same load every day, so the monotony is undefined.
 */
export type WeekLoadStatus = 'ok' | 'incomplete_week' | 'zero_variance';

export interface WeekLoadSummary {
  /** Monday of the ISO week. */
  readonly weekStart: LocalDate;
  /** Sunday of the ISO week. */
  readonly weekEnd: LocalDate;
  /** Weekly load: sum of the known days. */
  readonly totalLoadAu: number;
  readonly daysWithData: number;
  /** Known days (within history and not after `to`) without data. */
  readonly missingDays: number;
  readonly meanDailyLoadAu: number | null;
  readonly sdDailyLoadAu: number | null;
  readonly monotony: number | null;
  readonly strainAu: number | null;
  readonly status: WeekLoadStatus;
}

export interface WeekLoadSummariesInput {
  readonly loads: readonly DatedLoad[];
  /** Any day of the first week. */
  readonly from: LocalDate;
  /** Any day of the last week; later days are unknown. */
  readonly to: LocalDate;
  /** Same meaning as in {@link LoadSeriesInput}. */
  readonly historyStart?: LocalDate | undefined;
  readonly standardDeviation?: StandardDeviationKind | undefined;
}

/**
 * Foster's weekly load, monotony and strain per ISO week (Monday to Sunday),
 * the way staff report them. Days without data count as 0.
 */
export function isoWeekLoadSummaries(input: WeekLoadSummariesInput): WeekLoadSummary[] {
  const from = parseLocalDate(input.from);
  const to = parseLocalDate(input.to);
  if (compareLocalDates(from, to) > 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `isoWeekLoadSummaries: from (${from}) is after to (${to}).`,
      { from, to },
    );
  }
  const standardDeviation =
    input.standardDeviation ?? DEFAULT_LOAD_PARAMETERS.monotonyStandardDeviation;
  const daily = dailyLoadsFromSessions(input.loads).filter(
    (day) => compareLocalDates(day.date, to) <= 0,
  );
  const historyStart = resolveHistoryStart(input.historyStart, daily);
  const firstWeek = startOfIsoWeek(from);
  const lastWeek = startOfIsoWeek(to);
  const days = fillDailyLoads({ loads: daily, from: firstWeek, to: addDays(lastWeek, 6) });

  const summaries: WeekLoadSummary[] = [];
  for (let start = 0; start < days.length; start += 7) {
    const week = days.slice(start, start + 7);
    const known = week.filter(
      (day) =>
        historyStart !== undefined &&
        compareLocalDates(day.date, historyStart) >= 0 &&
        compareLocalDates(day.date, to) <= 0,
    );
    const totalLoadAu = known.reduce((sum, day) => sum + day.loadAu, 0);
    const daysWithData = known.filter((day) => day.hasData).length;
    const base = {
      weekStart: addDays(firstWeek, start),
      weekEnd: addDays(firstWeek, start + 6),
      totalLoadAu,
      daysWithData,
      missingDays: known.length - daysWithData,
    };
    if (known.length < 7) {
      summaries.push({
        ...base,
        meanDailyLoadAu: known.length === 0 ? null : totalLoadAu / known.length,
        sdDailyLoadAu: null,
        monotony: null,
        strainAu: null,
        status: 'incomplete_week',
      });
      continue;
    }
    const summary = fosterMonotony(
      week.map((day) => day.loadAu),
      standardDeviation,
    );
    summaries.push({
      ...base,
      meanDailyLoadAu: summary.meanDailyLoadAu,
      sdDailyLoadAu: summary.sdDailyLoadAu,
      monotony: summary.monotony,
      strainAu: summary.strainAu,
      status: summary.monotony === null ? 'zero_variance' : 'ok',
    });
  }
  return summaries;
}

function resolveHistoryStart(
  explicit: LocalDate | undefined,
  daily: readonly DatedLoad[],
): LocalDate | undefined {
  const firstLoad = daily[0]?.date;
  if (explicit === undefined) return firstLoad;
  const historyStart = parseLocalDate(explicit);
  if (firstLoad !== undefined && compareLocalDates(firstLoad, historyStart) < 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `There is a load on ${firstLoad}, before historyStart (${historyStart}).`,
      { historyStart, firstLoad },
    );
  }
  return historyStart;
}

function beforeHistory(date: LocalDate): DailyLoadMetrics {
  return {
    date,
    loadAu: 0,
    hasData: false,
    historyDays: 0,
    acuteEwmaAu: 0,
    chronicEwmaAu: 0,
    acwr: null,
    acwrStatus: 'insufficient_history',
    missingDaysInAcuteWindow: 0,
    missingDaysInChronicWindow: 0,
    windowLoadAu: 0,
    monotony: null,
    strainAu: null,
    monotonyStatus: 'insufficient_history',
  };
}
