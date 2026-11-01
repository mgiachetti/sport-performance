import { DomainValidationError, describeValue } from '../errors.js';
import { WELLNESS_ITEMS, type WellnessItem } from '../measurement.js';
import type { Sex } from '../sex.js';
import type { Sport } from '../sport.js';
import type { Stage } from '../stage.js';
import { addDays, compareLocalDates, daysBetween, isLocalDate, type LocalDate } from '../time.js';
import {
  alertMessageKey,
  alertSuggestionKey,
  compareAlertSeverities,
  type AlertMessageKey,
  type AlertRule,
  type AlertRuleKind,
  type AlertRuleOf,
  type AlertSeverity,
  type AlertSuggestionKey,
} from './rules.js';

// ---------------------------------------------------------------------------
// Input: a player's state on one club day

/**
 * ACWR of the evaluated day, as computed by the load module (B-202).
 * `ratio` is `null` when it cannot be computed (no chronic load yet).
 */
export interface AcwrInput {
  readonly ratio: number | null;
  /** Days of load history up to and including the evaluated day. */
  readonly historyDays: number;
}

/** Mean wellness score of one day (1–5, higher is better); see {@link meanWellnessScore}. */
export interface WellnessDailyScore {
  readonly date: LocalDate;
  readonly meanScore: number;
}

/** One CMJ result (best of its attempts). Several on one day count as their best. */
export interface CmjMeasurement {
  readonly date: LocalDate;
  readonly heightCm: number;
}

export interface CmjInput {
  readonly measurements: readonly CmjMeasurement[];
  /**
   * Baseline pinned by staff (for example the pre-season test). When set it is
   * used instead of the rolling baseline.
   */
  readonly baselineHeightCm?: number | null;
}

/** Growth velocity from the maturation module (B-203). */
export interface GrowthInput {
  readonly velocityCmYear: number | null;
  /** Date of the latest height measurement the velocity is based on. */
  readonly measuredOn: LocalDate;
}

/**
 * Everything the engine needs for one player on one club day ("the day" in
 * the club's time zone). Each block is optional: a missing block skips its
 * rules with reason `no_data`, it never raises an alert.
 *
 * Histories may include entries after `date`; they are ignored, so the full
 * history can be passed when re-evaluating a past day.
 */
export interface PlayerDailyState {
  readonly date: LocalDate;
  readonly sport?: Sport;
  readonly sex?: Sex;
  readonly stage?: Stage;
  readonly acwr?: AcwrInput | null;
  /** One entry per day at most. */
  readonly wellness?: readonly WellnessDailyScore[];
  readonly cmj?: CmjInput | null;
  readonly growth?: GrowthInput | null;
}

// ---------------------------------------------------------------------------
// Output

/**
 * A raised alert. No UI text: the client renders `messageKey` and
 * `suggestionKey` from `packages/i18n`, interpolating `values`.
 */
export interface Alert {
  readonly ruleCode: string;
  readonly kind: AlertRuleKind;
  readonly severity: AlertSeverity;
  /** The evaluated club day. */
  readonly date: LocalDate;
  /** Day of the underlying data (wellness, CMJ or height measurement); equals `date` for ACWR. */
  readonly observedOn: LocalDate;
  readonly messageKey: AlertMessageKey;
  readonly suggestionKey: AlertSuggestionKey;
  /** Observed value, threshold crossed and context, unrounded, for interpolation. */
  readonly values: Readonly<Record<string, number>>;
}

/**
 * Why a rule produced no alert even though it could not be fully evaluated
 * (a rule evaluated with a value inside its thresholds is not listed).
 */
export const ALERT_SKIP_REASONS = [
  /** The rule is disabled. */
  'disabled',
  /** The player is outside the rule's `appliesTo`. */
  'not_applicable',
  /** The input the rule needs is missing. */
  'no_data',
  /** The latest data is older than the rule's `maxMeasurementAgeDays`. */
  'stale_data',
  /** Not enough history (ACWR < `minHistoryDays`, wellness < `minSamples`, CMJ baseline). */
  'insufficient_history',
  /** The player's own wellness history has no variation: a z-score is undefined. */
  'no_variance',
] as const;
export type AlertSkipReason = (typeof ALERT_SKIP_REASONS)[number];

export interface SkippedAlertRule {
  readonly ruleCode: string;
  readonly kind: AlertRuleKind;
  readonly reason: AlertSkipReason;
}

export interface AlertEvaluation {
  readonly date: LocalDate;
  /** Most severe first; ties keep the order of the rule set. */
  readonly alerts: readonly Alert[];
  /** In rule-set order. */
  readonly skipped: readonly SkippedAlertRule[];
}

// ---------------------------------------------------------------------------
// Helpers

/**
 * Tolerance for strict comparisons, so values that equal a threshold up to
 * floating-point error (for example a 7.000000000000001 % drop) do not cross it.
 */
const EPSILON = 1e-9;

const isAbove = (value: number, threshold: number): boolean => value > threshold + EPSILON;
const isBelow = (value: number, threshold: number): boolean => value < threshold - EPSILON;
const isAtOrAbove = (value: number, threshold: number): boolean => value >= threshold - EPSILON;

const WELLNESS_MIN_SCORE = 1;
const WELLNESS_MAX_SCORE = 5;

function invalid(label: string, value: unknown, expectation: string): never {
  throw new DomainValidationError(
    'invalid_argument',
    `Invalid ${label}: ${describeValue(value)}. Expected ${expectation}.`,
    value,
  );
}

function assertDate(value: unknown, label: string): asserts value is LocalDate {
  if (!isLocalDate(value)) invalid(label, value, 'a LocalDate (YYYY-MM-DD)');
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    invalid(label, value, 'a finite number');
}

function assertWellnessScore(value: unknown, label: string): asserts value is number {
  assertFinite(value, label);
  if (value < WELLNESS_MIN_SCORE || value > WELLNESS_MAX_SCORE) {
    invalid(
      label,
      value,
      `a score between ${String(WELLNESS_MIN_SCORE)} and ${String(WELLNESS_MAX_SCORE)}`,
    );
  }
}

/**
 * Mean of the wellness items answered on a day (1–5 each, higher is better;
 * items asked as "how tired are you" are stored already oriented). Stages ask
 * 3 or 5 items, so only answered items count. Throws if none was answered.
 */
export function meanWellnessScore(
  scores: Readonly<Partial<Record<WellnessItem, number | null>>>,
): number {
  let sum = 0;
  let count = 0;
  for (const item of WELLNESS_ITEMS) {
    const score = scores[item];
    if (score === undefined || score === null) continue;
    assertWellnessScore(score, `wellness score "${item}"`);
    sum += score;
    count += 1;
  }
  if (count === 0) invalid('wellness scores', scores, 'at least one answered item');
  return sum / count;
}

function mean(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Sample standard deviation (n − 1). Requires at least two values. */
function sampleStandardDeviation(values: readonly number[]): number {
  const m = mean(values);
  const squares = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

/** The most severe level whose threshold the value crosses, or `null`. */
function severityFor(
  value: number,
  warning: number | null,
  critical: number | null,
  crosses: (value: number, threshold: number) => boolean,
): { readonly severity: AlertSeverity; readonly threshold: number } | null {
  if (critical !== null && crosses(value, critical)) {
    return { severity: 'critical', threshold: critical };
  }
  if (warning !== null && crosses(value, warning)) {
    return { severity: 'warning', threshold: warning };
  }
  return null;
}

function inScope(rule: AlertRule, state: PlayerDailyState): boolean {
  const scope = rule.appliesTo;
  if (scope === undefined) return true;
  const matches = <T>(allowed: readonly T[] | undefined, value: T | undefined): boolean =>
    allowed === undefined || (value !== undefined && allowed.includes(value));
  return (
    matches(scope.sports, state.sport) &&
    matches(scope.sexes, state.sex) &&
    matches(scope.stages, state.stage)
  );
}

// ---------------------------------------------------------------------------
// Evaluators

/** Either an alert (minus the fields common to every rule), a skip, or nothing. */
type Outcome =
  | {
      readonly type: 'alert';
      readonly severity: AlertSeverity;
      readonly observedOn: LocalDate;
      readonly values: Readonly<Record<string, number>>;
    }
  | { readonly type: 'skip'; readonly reason: AlertSkipReason }
  | { readonly type: 'ok' };

const OK: Outcome = { type: 'ok' };
const skip = (reason: AlertSkipReason): Outcome => ({ type: 'skip', reason });

/**
 * Validated, date-filtered view of the state shared by every rule, so each
 * history is checked and sorted once per evaluation.
 */
interface PreparedState {
  readonly date: LocalDate;
  readonly acwr: AcwrInput | null;
  /** Up to and including `date`, ascending, unique dates. */
  readonly wellness: readonly WellnessDailyScore[] | null;
  /** Best height per day up to and including `date`, ascending. */
  readonly cmjDaily: readonly CmjMeasurement[] | null;
  readonly cmjPinnedBaselineCm: number | null;
  readonly growth: GrowthInput | null;
}

function prepare(state: PlayerDailyState): PreparedState {
  const { date } = state;
  assertDate(date, 'state.date');

  let acwr: AcwrInput | null = null;
  if (state.acwr !== undefined && state.acwr !== null) {
    const { ratio, historyDays } = state.acwr;
    if (ratio !== null) {
      assertFinite(ratio, 'acwr.ratio');
      if (ratio < 0) invalid('acwr.ratio', ratio, 'a ratio >= 0');
    }
    assertFinite(historyDays, 'acwr.historyDays');
    if (!Number.isInteger(historyDays) || historyDays < 0) {
      invalid('acwr.historyDays', historyDays, 'an integer >= 0');
    }
    acwr = { ratio, historyDays };
  }

  let wellness: WellnessDailyScore[] | null = null;
  if (state.wellness !== undefined) {
    const seen = new Set<string>();
    wellness = [];
    for (const entry of state.wellness) {
      assertDate(entry.date, 'wellness.date');
      assertWellnessScore(entry.meanScore, 'wellness.meanScore');
      if (seen.has(entry.date)) invalid('wellness.date', entry.date, 'one entry per day');
      seen.add(entry.date);
      if (compareLocalDates(entry.date, date) <= 0) wellness.push(entry);
    }
    wellness.sort((a, b) => compareLocalDates(a.date, b.date));
  }

  let cmjDaily: CmjMeasurement[] | null = null;
  let cmjPinnedBaselineCm: number | null = null;
  if (state.cmj !== undefined && state.cmj !== null) {
    const best = new Map<LocalDate, number>();
    for (const m of state.cmj.measurements) {
      assertDate(m.date, 'cmj.date');
      assertFinite(m.heightCm, 'cmj.heightCm');
      if (m.heightCm <= 0) invalid('cmj.heightCm', m.heightCm, 'a height > 0 cm');
      if (compareLocalDates(m.date, date) > 0) continue;
      best.set(m.date, Math.max(best.get(m.date) ?? 0, m.heightCm));
    }
    cmjDaily = [...best]
      .map(([d, heightCm]) => ({ date: d, heightCm }))
      .sort((a, b) => compareLocalDates(a.date, b.date));
    const pinned = state.cmj.baselineHeightCm;
    if (pinned !== undefined && pinned !== null) {
      assertFinite(pinned, 'cmj.baselineHeightCm');
      if (pinned <= 0) invalid('cmj.baselineHeightCm', pinned, 'a height > 0 cm');
      cmjPinnedBaselineCm = pinned;
    }
  }

  let growth: GrowthInput | null = null;
  if (state.growth !== undefined && state.growth !== null) {
    const { velocityCmYear, measuredOn } = state.growth;
    assertDate(measuredOn, 'growth.measuredOn');
    if (velocityCmYear !== null) assertFinite(velocityCmYear, 'growth.velocityCmYear');
    growth = { velocityCmYear, measuredOn };
  }

  return { date, acwr, wellness, cmjDaily, cmjPinnedBaselineCm, growth };
}

function evaluateAcwr(
  rule: AlertRuleOf<'acwr_high'> | AlertRuleOf<'acwr_low'>,
  state: PreparedState,
): Outcome {
  const { acwr } = state;
  if (acwr === null) return skip('no_data');
  // CLAUDE.md: with less than 28 days of history, "insufficient history", no ACWR alerts.
  if (acwr.historyDays < rule.params.minHistoryDays) return skip('insufficient_history');
  if (acwr.ratio === null) return skip('no_data');
  const level =
    rule.kind === 'acwr_high'
      ? severityFor(
          acwr.ratio,
          rule.params.warningAboveRatio,
          rule.params.criticalAboveRatio,
          isAbove,
        )
      : severityFor(
          acwr.ratio,
          rule.params.warningBelowRatio,
          rule.params.criticalBelowRatio,
          isBelow,
        );
  if (level === null) return OK;
  return {
    type: 'alert',
    severity: level.severity,
    observedOn: state.date,
    values: {
      acwrRatio: acwr.ratio,
      thresholdRatio: level.threshold,
      historyDays: acwr.historyDays,
    },
  };
}

function todaysWellness(state: PreparedState): WellnessDailyScore | null {
  const last = state.wellness?.at(-1);
  return last?.date === state.date ? last : null;
}

function evaluateWellnessLow(rule: AlertRuleOf<'wellness_low'>, state: PreparedState): Outcome {
  const today = todaysWellness(state);
  if (today === null) return skip('no_data');
  const level = severityFor(
    today.meanScore,
    rule.params.warningBelowScore,
    rule.params.criticalBelowScore,
    isBelow,
  );
  if (level === null) return OK;
  return {
    type: 'alert',
    severity: level.severity,
    observedOn: today.date,
    values: { wellnessScore: today.meanScore, thresholdScore: level.threshold },
  };
}

function evaluateWellnessZScore(
  rule: AlertRuleOf<'wellness_zscore_low'>,
  state: PreparedState,
): Outcome {
  const today = todaysWellness(state);
  if (today === null || state.wellness === null) return skip('no_data');
  const { windowDays, minSamples } = rule.params;
  const from = addDays(state.date, -windowDays);
  // The evaluated day is excluded: it is compared against the player's own past.
  const window = state.wellness
    .filter(
      (e) => compareLocalDates(e.date, from) >= 0 && compareLocalDates(e.date, state.date) < 0,
    )
    .map((e) => e.meanScore);
  if (window.length < minSamples) return skip('insufficient_history');
  const meanScore = mean(window);
  const sdScore = sampleStandardDeviation(window);
  if (sdScore < EPSILON) return skip('no_variance');
  const zScore = (today.meanScore - meanScore) / sdScore;
  const level = severityFor(
    zScore,
    rule.params.warningBelowZScore,
    rule.params.criticalBelowZScore,
    isBelow,
  );
  if (level === null) return OK;
  return {
    type: 'alert',
    severity: level.severity,
    observedOn: today.date,
    values: {
      wellnessScore: today.meanScore,
      meanScore,
      sdScore,
      zScore,
      thresholdZScore: level.threshold,
      samples: window.length,
    },
  };
}

function evaluateCmjDrop(rule: AlertRuleOf<'cmj_drop'>, state: PreparedState): Outcome {
  const daily = state.cmjDaily;
  const latest = daily?.at(-1);
  if (daily === null || latest === undefined) return skip('no_data');
  const { baselineWindowDays, minBaselineSamples, maxMeasurementAgeDays } = rule.params;
  if (daysBetween(latest.date, state.date) > maxMeasurementAgeDays) return skip('stale_data');

  let baselineHeightCm = state.cmjPinnedBaselineCm;
  let samples = 0;
  if (baselineHeightCm === null) {
    const from = addDays(latest.date, -baselineWindowDays);
    const window = daily
      .filter(
        (m) => compareLocalDates(m.date, from) >= 0 && compareLocalDates(m.date, latest.date) < 0,
      )
      .map((m) => m.heightCm);
    if (window.length < minBaselineSamples) return skip('insufficient_history');
    baselineHeightCm = mean(window);
    samples = window.length;
  }

  const dropPct = ((baselineHeightCm - latest.heightCm) / baselineHeightCm) * 100;
  const level = severityFor(
    dropPct,
    rule.params.warningDropPct,
    rule.params.criticalDropPct,
    isAbove,
  );
  if (level === null) return OK;
  return {
    type: 'alert',
    severity: level.severity,
    observedOn: latest.date,
    values: {
      heightCm: latest.heightCm,
      baselineHeightCm,
      dropPct,
      thresholdPct: level.threshold,
      // 0 when the baseline was pinned by staff.
      baselineSamples: samples,
    },
  };
}

function evaluateGrowthPeak(rule: AlertRuleOf<'growth_peak'>, state: PreparedState): Outcome {
  if (state.growth === null) return skip('no_data');
  const { velocityCmYear, measuredOn } = state.growth;
  if (velocityCmYear === null) return skip('no_data');
  // A measurement after the evaluated day does not exist yet for that day.
  if (compareLocalDates(measuredOn, state.date) > 0) return skip('no_data');
  if (daysBetween(measuredOn, state.date) > rule.params.maxMeasurementAgeDays) {
    return skip('stale_data');
  }
  const level = severityFor(
    velocityCmYear,
    rule.params.warningAtOrAboveCmYear,
    rule.params.criticalAtOrAboveCmYear,
    isAtOrAbove,
  );
  if (level === null) return OK;
  return {
    type: 'alert',
    severity: level.severity,
    observedOn: measuredOn,
    values: { velocityCmYear, thresholdCmYear: level.threshold },
  };
}

function evaluateRule(rule: AlertRule, state: PreparedState): Outcome {
  switch (rule.kind) {
    case 'acwr_high':
    case 'acwr_low':
      return evaluateAcwr(rule, state);
    case 'wellness_low':
      return evaluateWellnessLow(rule, state);
    case 'wellness_zscore_low':
      return evaluateWellnessZScore(rule, state);
    case 'cmj_drop':
      return evaluateCmjDrop(rule, state);
    case 'growth_peak':
      return evaluateGrowthPeak(rule, state);
  }
}

// ---------------------------------------------------------------------------
// Engine

/**
 * Evaluates a club's rule set (validated with `parseAlertRuleSet`) against a
 * player's state on one club day.
 *
 * Each rule raises at most one alert, at the most severe level it reaches.
 * Rules that cannot be evaluated are reported in `skipped` with a reason and
 * never raise an alert (missing data is not an alert). Throws
 * {@link DomainValidationError} if the state is malformed.
 */
export function evaluateAlertRules(
  rules: readonly AlertRule[],
  state: PlayerDailyState,
): AlertEvaluation {
  const prepared = prepare(state);
  const alerts: Alert[] = [];
  const skipped: SkippedAlertRule[] = [];

  for (const rule of rules) {
    const { code: ruleCode, kind } = rule;
    if (!rule.enabled) {
      skipped.push({ ruleCode, kind, reason: 'disabled' });
      continue;
    }
    if (!inScope(rule, state)) {
      skipped.push({ ruleCode, kind, reason: 'not_applicable' });
      continue;
    }
    const outcome = evaluateRule(rule, prepared);
    if (outcome.type === 'skip') {
      skipped.push({ ruleCode, kind, reason: outcome.reason });
    } else if (outcome.type === 'alert') {
      alerts.push({
        ruleCode,
        kind,
        severity: outcome.severity,
        date: prepared.date,
        observedOn: outcome.observedOn,
        messageKey: alertMessageKey(kind),
        suggestionKey: alertSuggestionKey(kind),
        values: outcome.values,
      });
    }
  }

  // Array.prototype.sort is stable: ties keep rule-set order.
  alerts.sort((a, b) => compareAlertSeverities(b.severity, a.severity));
  return { date: prepared.date, alerts, skipped };
}

/** The most severe level among the alerts, or `null` when there are none. */
export function highestAlertSeverity(alerts: readonly Alert[]): AlertSeverity | null {
  let highest: AlertSeverity | null = null;
  for (const alert of alerts) {
    if (highest === null || compareAlertSeverities(alert.severity, highest) > 0) {
      highest = alert.severity;
    }
  }
  return highest;
}
