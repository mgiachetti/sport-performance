import type { MetricCode, MetricDirection } from '../codes.js';
import { memberGuard } from '../enum.js';
import { DomainValidationError, describeValue } from '../errors.js';
import type { PlayerId } from '../ids.js';
import type { MeasurementMethod } from '../measurement.js';
import type { Sex } from '../sex.js';
import type { Sport } from '../sport.js';
import { compareLocalDates, type LocalDate } from '../time.js';
import {
  assertFinite,
  assertPositiveInteger,
  percentileRank,
  summarizeDistribution,
  type DistributionSummary,
} from './distribution.js';

/**
 * Dimensions a comparison group can be scoped by. Sport and metric are always
 * matched (sports are never mixed); these are optional on top of them.
 * `line` is a group of positions (rugby forwards / backs).
 */
export const PERCENTILE_GROUP_DIMENSIONS = ['sex', 'category', 'line', 'position'] as const;
export type PercentileGroupDimension = (typeof PERCENTILE_GROUP_DIMENSIONS)[number];
export const isPercentileGroupDimension = memberGuard(PERCENTILE_GROUP_DIMENSIONS);

/**
 * How the several results of one player inside the season window become the
 * single value that player contributes to the group:
 * - `best`: best by the metric direction (not allowed for neutral metrics).
 * - `latest`: most recent `measuredOn`; same-day results are averaged.
 * - `mean`: arithmetic mean of every result in the window.
 */
export const PLAYER_AGGREGATIONS = ['best', 'latest', 'mean'] as const;
export type PlayerAggregation = (typeof PLAYER_AGGREGATIONS)[number];
export const isPlayerAggregation = memberGuard(PLAYER_AGGREGATIONS);

/**
 * Which measurement methods enter the group (product principle 4):
 * - `same_method`: only results measured with the subject's method.
 * - `any_method`: every method; the result flags `mixedMethods` so the UI warns.
 */
export const METHOD_POLICIES = ['same_method', 'any_method'] as const;
export type MethodPolicy = (typeof METHOD_POLICIES)[number];
export const isMethodPolicy = memberGuard(METHOD_POLICIES);

/** One way of building the comparison group. */
export interface PercentileGrouping {
  /** Dimensions matched against the subject, besides sport and metric. */
  readonly dimensions: readonly PercentileGroupDimension[];
  /**
   * Seasons accumulated, counting the subject's: `1` is the current season
   * only, `3` is the window `[season − 2, season]`. Later seasons never enter.
   */
  readonly seasonsAccumulated: number;
}

/** Club-configurable percentile parameters. Defaults in {@link DEFAULT_PERCENTILE_SETTINGS}. */
export interface PercentileSettings {
  /** Minimum distinct players (subject included) for a percentile to be reported. */
  readonly minSampleSize: number;
  /**
   * Fallback chain, tried in order: the first grouping that reaches
   * `minSampleSize` is used. Put the most specific grouping first.
   */
  readonly groupings: readonly PercentileGrouping[];
  readonly methodPolicy: MethodPolicy;
  /** Omitted: `best` for directional metrics, `latest` for neutral ones. */
  readonly playerAggregation?: PlayerAggregation;
}

/**
 * Default percentile settings, as data ready to seed (B-306). A minimum of 10
 * players is a conservative heuristic for youth squads (a percentile over
 * fewer players moves several points per player); clubs can change it.
 * The fallback widens from position to line, then accumulates seasons, then
 * drops the position scope while keeping category and sex.
 */
export const DEFAULT_PERCENTILE_SETTINGS = {
  minSampleSize: 10,
  groupings: [
    { dimensions: ['sex', 'category', 'position'], seasonsAccumulated: 1 },
    { dimensions: ['sex', 'category', 'line'], seasonsAccumulated: 1 },
    { dimensions: ['sex', 'category', 'line'], seasonsAccumulated: 3 },
    { dimensions: ['sex', 'category'], seasonsAccumulated: 3 },
  ],
  methodPolicy: 'same_method',
} as const satisfies PercentileSettings;

/** One stored result, as the comparison group sees it. */
export interface PercentileSample {
  readonly playerId: PlayerId;
  readonly metricCode: MetricCode;
  readonly sport: Sport;
  readonly sex: Sex;
  /** Age band code of the player in that season (`m15`). */
  readonly categoryCode: string;
  readonly positionCode?: string;
  /** Line of the position (`forwards`); see `lineForPosition`. */
  readonly lineCode?: string;
  readonly seasonYear: number;
  readonly measuredOn: LocalDate;
  readonly method: MeasurementMethod;
  /** In the metric's unit. */
  readonly value: number;
}

/**
 * The value being placed in a group. With `playerId`, the subject is a player
 * of the group: their other results are left out and they count once, with
 * `value`. Without it (a first-team value, a target), `value` is ranked
 * against the group without joining it.
 */
export interface PercentileSubject {
  readonly playerId?: PlayerId;
  readonly metricCode: MetricCode;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly categoryCode: string;
  readonly positionCode?: string;
  readonly lineCode?: string;
  readonly seasonYear: number;
  readonly method: MeasurementMethod;
  readonly value: number;
}

/** What happened with one grouping of the fallback chain. */
export interface PercentileAttempt {
  readonly grouping: PercentileGrouping;
  readonly outcome: 'ok' | 'insufficient_sample' | 'missing_dimension';
  /** Distinct players in the group (0 for `missing_dimension`). */
  readonly sampleSize: number;
}

/**
 * The comparison group of a subject for one grouping: one value per player and
 * the methods present. Values only, never player identities.
 */
export interface PercentileGroup {
  readonly grouping: PercentileGrouping;
  readonly seasonFrom: number;
  readonly seasonTo: number;
  readonly values: readonly number[];
  /** Distinct methods in the group, sorted. */
  readonly methods: readonly MeasurementMethod[];
  readonly mixedMethods: boolean;
}

export type PercentileResult =
  | {
      readonly status: 'ok';
      /** Mid-rank percentile, 0–100, direction-aware. Not rounded. */
      readonly percentile: number;
      readonly grouping: PercentileGrouping;
      readonly seasonFrom: number;
      readonly seasonTo: number;
      readonly sampleSize: number;
      readonly minSampleSize: number;
      readonly summary: DistributionSummary;
      readonly methods: readonly MeasurementMethod[];
      readonly mixedMethods: boolean;
      readonly attempts: readonly PercentileAttempt[];
    }
  | {
      readonly status: 'insufficient_sample';
      readonly minSampleSize: number;
      /** Largest group found across the attempts. */
      readonly largestSampleSize: number;
      readonly attempts: readonly PercentileAttempt[];
    };

/** Options to build one group. */
export interface PercentileGroupOptions {
  readonly direction: MetricDirection;
  readonly methodPolicy: MethodPolicy;
  readonly playerAggregation?: PlayerAggregation;
}

/**
 * Builds the comparison group of `subject` for one grouping, or returns
 * `'missing_dimension'` when the subject lacks a dimension the grouping needs
 * (for example, no position). Samples lacking it are left out of the group.
 */
export function buildPercentileGroup(
  samples: readonly PercentileSample[],
  subject: PercentileSubject,
  grouping: PercentileGrouping,
  options: PercentileGroupOptions,
): PercentileGroup | 'missing_dimension' {
  assertSubject(subject);
  assertGrouping(grouping);
  const aggregation = resolvePlayerAggregation(options.direction, options.playerAggregation);
  if (!isMethodPolicy(options.methodPolicy)) {
    throw invalid('methodPolicy', options.methodPolicy);
  }

  const dims = new Set(grouping.dimensions);
  if (dims.has('position') && subject.positionCode === undefined) return 'missing_dimension';
  if (dims.has('line') && subject.lineCode === undefined) return 'missing_dimension';

  const seasonTo = subject.seasonYear;
  const seasonFrom = seasonTo - grouping.seasonsAccumulated + 1;

  const byPlayer = new Map<PlayerId, PercentileSample[]>();
  for (const sample of samples) {
    if (sample.playerId === subject.playerId) continue;
    if (sample.metricCode !== subject.metricCode || sample.sport !== subject.sport) continue;
    if (sample.seasonYear < seasonFrom || sample.seasonYear > seasonTo) continue;
    if (dims.has('sex') && sample.sex !== subject.sex) continue;
    if (dims.has('category') && sample.categoryCode !== subject.categoryCode) continue;
    if (dims.has('position') && sample.positionCode !== subject.positionCode) continue;
    if (dims.has('line') && sample.lineCode !== subject.lineCode) continue;
    if (options.methodPolicy === 'same_method' && sample.method !== subject.method) continue;
    assertFinite(sample.value, 'sample.value');
    const list = byPlayer.get(sample.playerId);
    if (list) list.push(sample);
    else byPlayer.set(sample.playerId, [sample]);
  }

  const values: number[] = [];
  const methods = new Set<MeasurementMethod>();
  for (const playerSamples of byPlayer.values()) {
    values.push(aggregatePlayer(playerSamples, aggregation, options.direction));
    for (const s of playerSamples) methods.add(s.method);
  }
  if (subject.playerId !== undefined) {
    values.push(subject.value);
    methods.add(subject.method);
  }

  const sortedMethods = [...methods].sort();
  return {
    grouping,
    seasonFrom,
    seasonTo,
    values,
    methods: sortedMethods,
    mixedMethods: sortedMethods.length > 1,
  };
}

/**
 * Percentile of `subject.value` in its comparison group, trying the groupings
 * of `settings` in order and using the first with at least `minSampleSize`
 * distinct players. With none, the result is `insufficient_sample` and no
 * percentile is reported.
 */
export function computePercentile(
  samples: readonly PercentileSample[],
  subject: PercentileSubject,
  direction: MetricDirection,
  settings: PercentileSettings = DEFAULT_PERCENTILE_SETTINGS,
): PercentileResult {
  assertPercentileSettings(settings);
  const options: PercentileGroupOptions =
    settings.playerAggregation === undefined
      ? { direction, methodPolicy: settings.methodPolicy }
      : {
          direction,
          methodPolicy: settings.methodPolicy,
          playerAggregation: settings.playerAggregation,
        };

  const attempts: PercentileAttempt[] = [];
  let largestSampleSize = 0;
  for (const grouping of settings.groupings) {
    const group = buildPercentileGroup(samples, subject, grouping, options);
    if (group === 'missing_dimension') {
      attempts.push({ grouping, outcome: 'missing_dimension', sampleSize: 0 });
      continue;
    }
    const sampleSize = group.values.length;
    largestSampleSize = Math.max(largestSampleSize, sampleSize);
    if (sampleSize < settings.minSampleSize) {
      attempts.push({ grouping, outcome: 'insufficient_sample', sampleSize });
      continue;
    }
    attempts.push({ grouping, outcome: 'ok', sampleSize });
    return {
      status: 'ok',
      percentile: percentileRank(subject.value, group.values, direction),
      grouping,
      seasonFrom: group.seasonFrom,
      seasonTo: group.seasonTo,
      sampleSize,
      minSampleSize: settings.minSampleSize,
      summary: summarizeDistribution(group.values, direction),
      methods: group.methods,
      mixedMethods: group.mixedMethods,
      attempts,
    };
  }
  return {
    status: 'insufficient_sample',
    minSampleSize: settings.minSampleSize,
    largestSampleSize,
    attempts,
  };
}

/** Default aggregation for a direction, or validates an explicit one. */
export function resolvePlayerAggregation(
  direction: MetricDirection,
  aggregation?: PlayerAggregation,
): PlayerAggregation {
  if (aggregation === undefined) return direction === 'neutral' ? 'latest' : 'best';
  if (!isPlayerAggregation(aggregation)) throw invalid('playerAggregation', aggregation);
  if (aggregation === 'best' && direction === 'neutral') {
    throw new DomainValidationError(
      'invalid_argument',
      'playerAggregation "best" needs a metric with a direction; use "latest" or "mean" for neutral metrics.',
      aggregation,
    );
  }
  return aggregation;
}

/** Validates percentile settings (club data) and throws on the first problem. */
export function assertPercentileSettings(settings: PercentileSettings): void {
  assertPositiveInteger(settings.minSampleSize, 'minSampleSize');
  if (settings.groupings.length === 0) {
    throw new DomainValidationError(
      'invalid_argument',
      'groupings needs at least one grouping.',
      settings.groupings,
    );
  }
  for (const grouping of settings.groupings) assertGrouping(grouping);
  if (!isMethodPolicy(settings.methodPolicy)) throw invalid('methodPolicy', settings.methodPolicy);
  if (
    settings.playerAggregation !== undefined &&
    !isPlayerAggregation(settings.playerAggregation)
  ) {
    throw invalid('playerAggregation', settings.playerAggregation);
  }
}

function aggregatePlayer(
  samples: readonly PercentileSample[],
  aggregation: PlayerAggregation,
  direction: MetricDirection,
): number {
  switch (aggregation) {
    case 'best': {
      const values = samples.map((s) => s.value);
      return direction === 'lower_is_better' ? Math.min(...values) : Math.max(...values);
    }
    case 'mean':
      return mean(samples.map((s) => s.value));
    case 'latest': {
      const latestOn = samples.reduce<LocalDate>(
        (acc, s) => (compareLocalDates(s.measuredOn, acc) > 0 ? s.measuredOn : acc),
        firstSample(samples).measuredOn,
      );
      return mean(samples.filter((s) => s.measuredOn === latestOn).map((s) => s.value));
    }
  }
}

function firstSample(samples: readonly PercentileSample[]): PercentileSample {
  const [first] = samples;
  if (first === undefined) throw new RangeError('A player group is never empty.');
  return first;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function assertGrouping(grouping: PercentileGrouping): void {
  assertPositiveInteger(grouping.seasonsAccumulated, 'seasonsAccumulated');
  const seen = new Set<string>();
  for (const dim of grouping.dimensions) {
    if (!isPercentileGroupDimension(dim)) throw invalid('grouping dimension', dim);
    if (seen.has(dim)) {
      throw new DomainValidationError(
        'invalid_argument',
        `Duplicated grouping dimension ${describeValue(dim)}.`,
        dim,
      );
    }
    seen.add(dim);
  }
}

function assertSubject(subject: PercentileSubject): void {
  assertFinite(subject.value, 'subject.value');
  if (!Number.isInteger(subject.seasonYear)) {
    throw invalid('subject.seasonYear', subject.seasonYear);
  }
}

function invalid(name: string, value: unknown): DomainValidationError {
  return new DomainValidationError(
    'invalid_argument',
    `Invalid ${name}: ${describeValue(value)}.`,
    value,
  );
}
