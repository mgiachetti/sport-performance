import { memberGuard } from '../../enum.js';
import { DomainValidationError, describeValue } from '../../errors.js';
import type { CoefficientProvenance } from '../../maturation/provenance.js';
import { isSport, type Sport } from '../../sport.js';

/**
 * Definitions of the pod's field metrics (B-919, ADR 0106, ADR 0110): every
 * filter, threshold, dwell time and formula the server uses to turn the
 * pod's 10 Hz Doppler speed and its IMU into the canonical metrics, as
 * **club data** (`pod_metric_config`, versioned by validity like the speed
 * zones, ADR 0041) with the defaults below seeded for every club.
 *
 * The thresholds that already are club data elsewhere are not repeated:
 * `hsr_abs_m` uses the high-speed zone of the club's absolute speed zones
 * (5.5 m/s for men, 5.28 m/s for women by default, B-209 and B-804),
 * `hsr_rel_m` the high-speed zone of the relative zones (60 % of the player's
 * reference Vmax) and the sprints the zone named by `sprints.zoneCode`.
 *
 * **Unverified**: the defaults follow the conventions published for Catapult
 * OpenField, not the club's own settings. They are replaced with the first
 * team's OpenField export (B-002) before the pod's numbers are compared with
 * Catapult's ({@link DEFAULT_POD_METRIC_PARAMS_SOURCE}).
 */

/** Version of the server's algorithm; stored with every value it writes. */
export const POD_METRICS_ALGORITHM_VERSION = 'pod-metrics/1';

/** Fix qualities of the protocol (`FIX_QUALITIES` of `pod-protocol`), by name. */
export const POD_FIX_QUALITIES = [
  'no_fix',
  'dead_reckoning',
  'fix_2d',
  'fix_3d',
  'dgnss',
  'rtk_float',
  'rtk_fixed',
] as const;
export type PodFixQuality = (typeof POD_FIX_QUALITIES)[number];
export const isPodFixQuality = memberGuard(POD_FIX_QUALITIES);

/**
 * Where the reference Vmax of the relative metrics (`hsr_rel_m`,
 * `vmax_pct`) comes from, tried in the club's order:
 *
 * - `pod_rolling_max`: the highest session peak (`vmax_ms`, the 1 s rolling
 *   mean of the filtered pod speed) of the player in the last
 *   `podWindowDays` days up to the session, the session included, with at
 *   least `podMinSessions` sessions (ADR 0106).
 * - `sprint_40`: the latest `sprint_vmax_ms` of the 40 m sprint test (the
 *   mean of the 20–40 m split), at most `sprint40MaxAgeDays` old. It is a
 *   split mean, not a peak: it is never mixed with a pod peak in one max.
 */
export const REFERENCE_VMAX_SOURCES = ['pod_rolling_max', 'sprint_40'] as const;
export type ReferenceVmaxSource = (typeof REFERENCE_VMAX_SOURCES)[number];
export const isReferenceVmaxSource = memberGuard(REFERENCE_VMAX_SOURCES);

/** Kinds of the live effort signals (B-906). */
export const POD_LIVE_SIGNAL_KINDS = [
  'pace_drop',
  'match_average_high',
  'speed_near_vmax',
  'repeated_high_intensity',
] as const;
export type PodLiveSignalKind = (typeof POD_LIVE_SIGNAL_KINDS)[number];
export const isPodLiveSignalKind = memberGuard(POD_LIVE_SIGNAL_KINDS);

/** Live signals never diagnose: they suggest a look (`info`) or a check (`warning`). */
export const POD_LIVE_SIGNAL_SEVERITIES = ['info', 'warning'] as const;
export type PodLiveSignalSeverity = (typeof POD_LIVE_SIGNAL_SEVERITIES)[number];
export const isPodLiveSignalSeverity = memberGuard(POD_LIVE_SIGNAL_SEVERITIES);

/** Metrics the live screen compares with the player's own match average. */
export const POD_LIVE_AVERAGE_METRICS = ['hsr_abs_m', 'sprints_n', 'acc_n'] as const;
export type PodLiveAverageMetric = (typeof POD_LIVE_AVERAGE_METRICS)[number];
export const isPodLiveAverageMetric = memberGuard(POD_LIVE_AVERAGE_METRICS);

export interface PodPlausibilityParams {
  /** Epochs with a worse fix are dropped. */
  readonly acceptedFixQualities: readonly PodFixQuality[];
  /** Epochs with a larger horizontal accuracy estimate are dropped (`null`: not checked). */
  readonly maxHorizontalAccuracyM: number | null;
  /** Epochs with a larger speed accuracy estimate are dropped (`null`: not checked). */
  readonly maxSpeedAccuracyMs: number | null;
  /** No human runs faster: the epoch is a multipath spike. */
  readonly maxSpeedMs: number;
  /** A change of speed between consecutive epochs faster than this breaks the chain. */
  readonly maxAccelerationMs2: number;
  /** Epochs further apart break the series: no distance is integrated across. */
  readonly maxGapS: number;
  /**
   * A chain of mutually consistent epochs shorter than this (first to last
   * epoch) is a spike and is dropped (multipath lasts a few epochs). Also the
   * cap of the time over which a change of speed is allowed when two good
   * chains are joined across a dropped one.
   */
  readonly minChainS: number;
}

export interface PodEffortParams {
  /** m/s² (accelerations: at or above; decelerations: at or below its negative). */
  readonly thresholdMs2: number;
  /** Minimum time over the threshold for an effort to count (OpenField's dwell time). */
  readonly minDwellS: number;
}

export interface PodSprintParams {
  /** Code of the absolute speed zone whose lower bound starts a sprint. */
  readonly zoneCode: string;
  readonly minDwellS: number;
}

/**
 * `accel_load_au` (never called "PlayerLoad"): the published form of
 * Catapult's accelerometer load, `Σ √(Δx² + Δy² + Δz²) × scale`, with the
 * accelerations of the `accel_gyro` channel in g, in the sensor frame (the
 * norm of the change does not depend on how the pod sits in the vest),
 * resampled to `sampleRateHz` by linear interpolation; samples further apart
 * than `maxGapS` break the sum.
 */
export interface PodAccelLoadParams {
  readonly sampleRateHz: number;
  readonly scale: number;
  readonly maxGapS: number;
}

/**
 * Impacts of the high-g channel: peaks of the acceleration norm at or above
 * `thresholdG`, a new one only after the norm drops below it and
 * `minSeparationS` passed. Only in `sports` (rugby): hockey never stores nor
 * shows contacts or impacts (ADR 0091). Kept in the run's statistics, never
 * as `contacts_n`, until it is validated against Catapult's contact
 * involvements.
 */
export interface PodImpactParams {
  readonly sports: readonly Sport[];
  readonly thresholdG: number;
  readonly minSeparationS: number;
}

export interface PodReferenceVmaxParams {
  /** Sources tried in order; the first that gives a value wins. */
  readonly sources: readonly ReferenceVmaxSource[];
  readonly podWindowDays: number;
  readonly podMinSessions: number;
  readonly sprint40MaxAgeDays: number;
  /**
   * Sanity band: a pod rolling max more than this % above the player's
   * latest `sprint_40` Vmax (within its age) is implausible (a spike that got
   * through, a pod on another player) and the rule is skipped. `null`: no
   * band. The sprint's Vmax is a split mean, so the pod's peak is normally a
   * few % above it.
   */
  readonly podMaxAboveSprint40Pct: number | null;
}

export interface PodLiveSignalRuleBase<K extends PodLiveSignalKind, P> {
  /** Stable code of the rule (`pace_drop`), unique in the configuration. */
  readonly code: string;
  readonly kind: K;
  readonly enabled: boolean;
  readonly severity: PodLiveSignalSeverity;
  /** Sports it applies to; `null` = every sport. */
  readonly sports: readonly Sport[] | null;
  readonly params: P;
}

export interface PaceDropParams {
  /** Rolling window of the pace, seconds (5 min). */
  readonly windowS: number;
  /** Fires when the pace is at or below this % of the session's peak pace. */
  readonly atOrBelowPctOfPeak: number;
  /** Not before this much play (the peak needs a few windows). */
  readonly minPlayedS: number;
}

export interface MatchAverageHighParams {
  readonly metrics: readonly PodLiveAverageMetric[];
  /** Fires when the pace of a metric is at or above this % of the player's match average. */
  readonly atOrAbovePct: number;
  /** Fewer matches than this: "historia insuficiente", no signal. */
  readonly minMatches: number;
  readonly minPlayedS: number;
}

export interface SpeedNearVmaxParams {
  /** The recent max speed is the highest per-second max of the last `windowS`. */
  readonly windowS: number;
  /** Fires when it is at or above this % of the reference Vmax. */
  readonly atOrAbovePct: number;
}

/**
 * Repeated high-intensity efforts (RHIE): at least `minEfforts` efforts
 * (sprints, accelerations and, in rugby, impacts) each starting within
 * `maxRecoveryS` of the previous one's end; with `requireContact` (rugby) a
 * bout needs an impact between two sprints or accelerations (sprint →
 * contact → sprint). Fires when the bouts of the last `windowS` reach
 * `atOrAboveBouts`.
 */
export interface RepeatedHighIntensityParams {
  readonly minEfforts: number;
  readonly maxRecoveryS: number;
  readonly requireContact: boolean;
  readonly windowS: number;
  readonly atOrAboveBouts: number;
}

export interface PodLiveSignalParamsByKind {
  pace_drop: PaceDropParams;
  match_average_high: MatchAverageHighParams;
  speed_near_vmax: SpeedNearVmaxParams;
  repeated_high_intensity: RepeatedHighIntensityParams;
}

export type PodLiveSignalRule = {
  [K in PodLiveSignalKind]: PodLiveSignalRuleBase<K, PodLiveSignalParamsByKind[K]>;
}[PodLiveSignalKind];

export interface PodLiveParams {
  /**
   * Codes of the absolute zones whose lower bounds are the 4 speed bands the
   * pod counts in the live packet (each band runs to the next one; the last
   * has no top). `hsr_abs_m` live is the distance of the bands from the
   * high-speed zone up.
   */
  readonly bandZoneCodes: readonly [string, string, string, string];
  readonly rules: readonly PodLiveSignalRule[];
}

export interface PodMetricParams {
  readonly plausibility: PodPlausibilityParams;
  /** Centered moving average of the speed, seconds (0 = none). OpenField's velocity filter. */
  readonly speedFilterS: number;
  /** Centered moving average of the acceleration, seconds (0 = none). */
  readonly accelerationFilterS: number;
  /** `vmax_ms`: the highest mean speed over this window (1 s, ADR 0106). */
  readonly vmaxWindowS: number;
  readonly accelerations: PodEffortParams;
  readonly decelerations: PodEffortParams;
  readonly sprints: PodSprintParams;
  readonly accelLoad: PodAccelLoadParams;
  readonly impacts: PodImpactParams;
  readonly referenceVmax: PodReferenceVmaxParams;
  readonly live: PodLiveParams;
}

/** Default live signal rules (B-906): heuristics that suggest a look, never a diagnosis. */
export const DEFAULT_POD_LIVE_SIGNAL_RULES: readonly PodLiveSignalRule[] = [
  {
    code: 'pace_drop',
    kind: 'pace_drop',
    enabled: true,
    severity: 'info',
    sports: null,
    params: { windowS: 300, atOrBelowPctOfPeak: 60, minPlayedS: 900 },
  },
  {
    code: 'match_average_high',
    kind: 'match_average_high',
    enabled: true,
    severity: 'warning',
    sports: null,
    params: {
      metrics: ['hsr_abs_m', 'sprints_n', 'acc_n'],
      atOrAbovePct: 130,
      minMatches: 3,
      minPlayedS: 600,
    },
  },
  {
    code: 'speed_near_vmax',
    kind: 'speed_near_vmax',
    enabled: true,
    severity: 'info',
    sports: null,
    params: { windowS: 60, atOrAbovePct: 95 },
  },
  {
    code: 'rhie_rugby',
    kind: 'repeated_high_intensity',
    enabled: true,
    severity: 'warning',
    sports: ['rugby'],
    params: {
      minEfforts: 3,
      maxRecoveryS: 21,
      requireContact: true,
      windowS: 600,
      atOrAboveBouts: 2,
    },
  },
  {
    code: 'rhie_hockey',
    kind: 'repeated_high_intensity',
    enabled: true,
    severity: 'warning',
    sports: ['hockey'],
    params: {
      minEfforts: 3,
      maxRecoveryS: 21,
      requireContact: false,
      windowS: 600,
      atOrAboveBouts: 2,
    },
  },
];

/**
 * Default definitions, seeded for every club (migration `0056`,
 * `bootstrapClub`). See {@link DEFAULT_POD_METRIC_PARAMS_SOURCE}.
 */
export const DEFAULT_POD_METRIC_PARAMS: PodMetricParams = {
  plausibility: {
    acceptedFixQualities: ['fix_3d', 'dgnss', 'rtk_float', 'rtk_fixed'],
    maxHorizontalAccuracyM: 5,
    maxSpeedAccuracyMs: 1,
    maxSpeedMs: 12.5,
    maxAccelerationMs2: 10,
    maxGapS: 1,
    minChainS: 0.5,
  },
  speedFilterS: 0.3,
  accelerationFilterS: 0.3,
  vmaxWindowS: 1,
  accelerations: { thresholdMs2: 2, minDwellS: 0.5 },
  decelerations: { thresholdMs2: 2, minDwellS: 0.5 },
  sprints: { zoneCode: 'sprinting', minDwellS: 1 },
  accelLoad: { sampleRateHz: 100, scale: 0.01, maxGapS: 0.05 },
  impacts: { sports: ['rugby'], thresholdG: 8, minSeparationS: 1 },
  referenceVmax: {
    sources: ['pod_rolling_max', 'sprint_40'],
    podWindowDays: 180,
    podMinSessions: 3,
    sprint40MaxAgeDays: 365,
    podMaxAboveSprint40Pct: 115,
  },
  live: {
    bandZoneCodes: ['jogging', 'running', 'high_speed_running', 'sprinting'],
    rules: DEFAULT_POD_LIVE_SIGNAL_RULES,
  },
};

/** Where the defaults come from and what is pending (the same shape as the coefficients). */
export const DEFAULT_POD_METRIC_PARAMS_SOURCE: CoefficientProvenance = {
  citation:
    'Catapult OpenField conventions as published: velocity and acceleration filters, minimum ' +
    'effort duration (dwell time) per band and effort, and the accelerometer load formula ' +
    '(Boyd LJ, Ball K, Aughey RJ. The reliability of MinimaxX accelerometers for measuring ' +
    'physical activity in Australian football. Int J Sports Physiol Perform. 2011;6(3):311-321). ' +
    'Peak speed as the best 1 s mean; accelerations over 2 m/s² (CLAUDE.md); 21 s of recovery ' +
    'between efforts of a bout (Gabbett TJ, Wheeler AJ. Predictors of repeated high-intensity-' +
    'effort ability in rugby league players. Int J Sports Physiol Perform. 2015;10(6):718-724).',
  doi: '10.1123/ijspp.6.3.311',
  errata: [],
  verification: 'unverified',
  verificationNotes:
    'Not the club settings. Pending the first team OpenField export (B-002): velocity filter, ' +
    'acceleration filter (Gen 2 or the one in use), dwell time of the velocity bands and of the ' +
    'acceleration efforts, acceleration threshold, the sprint band and its dwell time, the ' +
    'reference Vmax the first team uses for relative bands, and the accelerometer load scale of ' +
    'their firmware. Then the bias and limits of agreement against Catapult per metric.',
};

// ─── Validation ──────────────────────────────────────────────────────────────────────

function invalid(message: string, value: unknown): never {
  throw new DomainValidationError(
    'invalid_argument',
    `${message} (got ${describeValue(value)}).`,
    value,
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${path} must be an object`, value);
  }
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`${path}.${key} is not a known field`, key);
  }
}

function num(value: unknown, path: string, min: number, max: number, minExclusive = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value > max ||
    (minExclusive ? value <= min : value < min)
  ) {
    invalid(
      `${path} must be a number in ${minExclusive ? '(' : '['}${String(min)}, ${String(max)}]`,
      value,
    );
  }
  return value;
}

function int(value: unknown, path: string, min: number, max: number): number {
  const n = num(value, path, min, max);
  if (!Number.isInteger(n)) invalid(`${path} must be an integer`, value);
  return n;
}

function nullableNum(value: unknown, path: string, min: number, max: number): number | null {
  return value === null ? null : num(value, path, min, max, true);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(`${path} must be a boolean`, value);
  return value;
}

function code(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    invalid(`${path} must be a snake_case code`, value);
  }
  return value;
}

function list<T>(
  value: unknown,
  path: string,
  item: (v: unknown, p: string) => T,
  minLength = 1,
): T[] {
  if (!Array.isArray(value) || value.length < minLength || value.length > 32) {
    invalid(`${path} must be a list of ${String(minLength)} to 32 items`, value);
  }
  const out = (value as unknown[]).map((v, i) => item(v, `${path}[${String(i)}]`));
  if (new Set(out.map((v) => JSON.stringify(v))).size !== out.length) {
    invalid(`${path} has repeated items`, value);
  }
  return out;
}

function member<T extends string>(guard: (v: unknown) => v is T) {
  return (value: unknown, path: string): T => {
    if (!guard(value)) invalid(`${path} is not a known value`, value);
    return value;
  };
}

function effort(value: unknown, path: string): PodEffortParams {
  const v = record(value, path);
  only(v, ['thresholdMs2', 'minDwellS'], path);
  return {
    thresholdMs2: num(v.thresholdMs2, `${path}.thresholdMs2`, 0.5, 10),
    minDwellS: num(v.minDwellS, `${path}.minDwellS`, 0, 5),
  };
}

function sports(value: unknown, path: string): Sport[] | null {
  return value === null ? null : list(value, path, member(isSport));
}

function liveRule(value: unknown, path: string): PodLiveSignalRule {
  const v = record(value, path);
  only(v, ['code', 'kind', 'enabled', 'severity', 'sports', 'params'], path);
  const base = {
    code: code(v.code, `${path}.code`),
    enabled: bool(v.enabled, `${path}.enabled`),
    severity: member(isPodLiveSignalSeverity)(v.severity, `${path}.severity`),
    sports: sports(v.sports, `${path}.sports`),
  };
  const kind = member(isPodLiveSignalKind)(v.kind, `${path}.kind`);
  const p = record(v.params, `${path}.params`);
  const pp = `${path}.params`;
  switch (kind) {
    case 'pace_drop':
      only(p, ['windowS', 'atOrBelowPctOfPeak', 'minPlayedS'], pp);
      return {
        ...base,
        kind,
        params: {
          windowS: num(p.windowS, `${pp}.windowS`, 60, 1800),
          atOrBelowPctOfPeak: num(p.atOrBelowPctOfPeak, `${pp}.atOrBelowPctOfPeak`, 1, 100),
          minPlayedS: num(p.minPlayedS, `${pp}.minPlayedS`, 0, 7200),
        },
      };
    case 'match_average_high':
      only(p, ['metrics', 'atOrAbovePct', 'minMatches', 'minPlayedS'], pp);
      return {
        ...base,
        kind,
        params: {
          metrics: list(p.metrics, `${pp}.metrics`, member(isPodLiveAverageMetric)),
          atOrAbovePct: num(p.atOrAbovePct, `${pp}.atOrAbovePct`, 100, 500),
          minMatches: int(p.minMatches, `${pp}.minMatches`, 1, 50),
          minPlayedS: num(p.minPlayedS, `${pp}.minPlayedS`, 0, 7200),
        },
      };
    case 'speed_near_vmax':
      only(p, ['windowS', 'atOrAbovePct'], pp);
      return {
        ...base,
        kind,
        params: {
          windowS: num(p.windowS, `${pp}.windowS`, 2, 600),
          atOrAbovePct: num(p.atOrAbovePct, `${pp}.atOrAbovePct`, 50, 150),
        },
      };
    case 'repeated_high_intensity':
      only(p, ['minEfforts', 'maxRecoveryS', 'requireContact', 'windowS', 'atOrAboveBouts'], pp);
      return {
        ...base,
        kind,
        params: {
          minEfforts: int(p.minEfforts, `${pp}.minEfforts`, 2, 20),
          maxRecoveryS: num(p.maxRecoveryS, `${pp}.maxRecoveryS`, 1, 120),
          requireContact: bool(p.requireContact, `${pp}.requireContact`),
          windowS: num(p.windowS, `${pp}.windowS`, 60, 7200),
          atOrAboveBouts: int(p.atOrAboveBouts, `${pp}.atOrAboveBouts`, 1, 50),
        },
      };
  }
}

/**
 * Parses stored or submitted definitions (the `params` of a
 * `pod_metric_config` row), rejecting unknown fields and values out of their
 * physical ranges. Throws a `DomainValidationError` with the path.
 */
export function parsePodMetricParams(value: unknown): PodMetricParams {
  const v = record(value, 'params');
  only(
    v,
    [
      'plausibility',
      'speedFilterS',
      'accelerationFilterS',
      'vmaxWindowS',
      'accelerations',
      'decelerations',
      'sprints',
      'accelLoad',
      'impacts',
      'referenceVmax',
      'live',
    ],
    'params',
  );
  const pl = record(v.plausibility, 'params.plausibility');
  only(
    pl,
    [
      'acceptedFixQualities',
      'maxHorizontalAccuracyM',
      'maxSpeedAccuracyMs',
      'maxSpeedMs',
      'maxAccelerationMs2',
      'maxGapS',
      'minChainS',
    ],
    'params.plausibility',
  );
  const sp = record(v.sprints, 'params.sprints');
  only(sp, ['zoneCode', 'minDwellS'], 'params.sprints');
  const al = record(v.accelLoad, 'params.accelLoad');
  only(al, ['sampleRateHz', 'scale', 'maxGapS'], 'params.accelLoad');
  const im = record(v.impacts, 'params.impacts');
  only(im, ['sports', 'thresholdG', 'minSeparationS'], 'params.impacts');
  const rv = record(v.referenceVmax, 'params.referenceVmax');
  only(
    rv,
    ['sources', 'podWindowDays', 'podMinSessions', 'sprint40MaxAgeDays', 'podMaxAboveSprint40Pct'],
    'params.referenceVmax',
  );
  const lv = record(v.live, 'params.live');
  only(lv, ['bandZoneCodes', 'rules'], 'params.live');
  const bands = lv.bandZoneCodes;
  if (!Array.isArray(bands) || bands.length !== 4) {
    invalid('params.live.bandZoneCodes must have 4 zone codes', bands);
  }
  const rules = list(lv.rules, 'params.live.rules', liveRule, 0);
  if (new Set(rules.map((r) => r.code)).size !== rules.length) {
    invalid('params.live.rules has repeated codes', rules);
  }
  const bandCodes = (bands as unknown[]).map((b, i) =>
    code(b, `params.live.bandZoneCodes[${String(i)}]`),
  );
  if (new Set(bandCodes).size !== 4) invalid('params.live.bandZoneCodes repeats a zone', bands);
  return {
    plausibility: {
      acceptedFixQualities: list(
        pl.acceptedFixQualities,
        'params.plausibility.acceptedFixQualities',
        member(isPodFixQuality),
      ),
      maxHorizontalAccuracyM: nullableNum(
        pl.maxHorizontalAccuracyM,
        'params.plausibility.maxHorizontalAccuracyM',
        0,
        100,
      ),
      maxSpeedAccuracyMs: nullableNum(
        pl.maxSpeedAccuracyMs,
        'params.plausibility.maxSpeedAccuracyMs',
        0,
        10,
      ),
      maxSpeedMs: num(pl.maxSpeedMs, 'params.plausibility.maxSpeedMs', 8, 15),
      maxAccelerationMs2: num(
        pl.maxAccelerationMs2,
        'params.plausibility.maxAccelerationMs2',
        4,
        30,
      ),
      maxGapS: num(pl.maxGapS, 'params.plausibility.maxGapS', 0.1, 10),
      minChainS: num(pl.minChainS, 'params.plausibility.minChainS', 0, 5),
    },
    speedFilterS: num(v.speedFilterS, 'params.speedFilterS', 0, 2),
    accelerationFilterS: num(v.accelerationFilterS, 'params.accelerationFilterS', 0, 2),
    vmaxWindowS: num(v.vmaxWindowS, 'params.vmaxWindowS', 0.1, 5),
    accelerations: effort(v.accelerations, 'params.accelerations'),
    decelerations: effort(v.decelerations, 'params.decelerations'),
    sprints: {
      zoneCode: code(sp.zoneCode, 'params.sprints.zoneCode'),
      minDwellS: num(sp.minDwellS, 'params.sprints.minDwellS', 0, 5),
    },
    accelLoad: {
      sampleRateHz: num(al.sampleRateHz, 'params.accelLoad.sampleRateHz', 10, 1000),
      scale: num(al.scale, 'params.accelLoad.scale', 0, 1, true),
      maxGapS: num(al.maxGapS, 'params.accelLoad.maxGapS', 0.001, 1),
    },
    impacts: {
      sports: list(
        im.sports,
        'params.impacts.sports',
        (v, path) => {
          const sport = member(isSport)(v, path);
          // Hockey never stores nor shows contacts or impacts (ADR 0091).
          if (sport === 'hockey') invalid(`${path}: hockey has no contacts`, v);
          return sport;
        },
        0,
      ),
      thresholdG: num(im.thresholdG, 'params.impacts.thresholdG', 2, 200),
      minSeparationS: num(im.minSeparationS, 'params.impacts.minSeparationS', 0, 10),
    },
    referenceVmax: {
      sources: list(rv.sources, 'params.referenceVmax.sources', member(isReferenceVmaxSource), 0),
      podWindowDays: int(rv.podWindowDays, 'params.referenceVmax.podWindowDays', 1, 730),
      podMinSessions: int(rv.podMinSessions, 'params.referenceVmax.podMinSessions', 1, 50),
      sprint40MaxAgeDays: int(
        rv.sprint40MaxAgeDays,
        'params.referenceVmax.sprint40MaxAgeDays',
        1,
        1095,
      ),
      podMaxAboveSprint40Pct: nullableNum(
        rv.podMaxAboveSprint40Pct,
        'params.referenceVmax.podMaxAboveSprint40Pct',
        100,
        200,
      ),
    },
    live: {
      bandZoneCodes: bandCodes as unknown as readonly [string, string, string, string],
      rules,
    },
  };
}

/**
 * Deterministic JSON (object keys sorted at every level): the input of the
 * definition hash stored with every run, so a recomputation happens exactly
 * when something that shapes a value changed.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  // Only JSON values reach a definition (strings, numbers, booleans, null).
  return JSON.stringify(value);
}
