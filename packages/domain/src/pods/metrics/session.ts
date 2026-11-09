import type { Sport } from '../../sport.js';
import {
  highSpeedThresholdMs,
  speedZoneBandsMs,
  type AbsoluteSpeedZoneSet,
  type RelativeSpeedZoneSet,
} from '../../speed-zones/zones.js';
import { normalizeIntervals, type TimeInterval } from '../pod-raw.js';
import {
  accelLoadAu,
  accelerationMs2,
  bestWindowMeanSpeedMs,
  cumulativeDistanceM,
  distanceAtM,
  effortsAtOrAbove,
  filterSpeedSamples,
  impactTimesMs,
  movingAverage,
  runDistanceAtOrAboveM,
  runDistanceM,
  type AccelSeries,
  type Effort,
  type HighGSeries,
  type PodSpeedSample,
  type SpeedFilterReport,
  type SpeedRun,
} from './kinematics.js';
import type { PodMetricParams } from './params.js';
import type { ReferenceVmax } from './reference-vmax.js';

/**
 * Canonical field metrics the pod writes (`pod_log`). `sprints_n` and
 * `sprint_dist_m` are new codes of the dictionary (B-919), **to confirm with
 * the club** against the first team's OpenField sprint band. `contacts_n` is
 * not written: the high-g impacts are not Catapult's contact involvements
 * (they stay in the run's statistics until validated).
 */
export const POD_FIELD_METRIC_CODES = [
  'dist_m',
  'dist_m_min',
  'hsr_abs_m',
  'hsr_rel_m',
  'vmax_ms',
  'vmax_pct',
  'acc_n',
  'dec_n',
  'sprints_n',
  'sprint_dist_m',
  'accel_load_au',
] as const;
export type PodFieldMetricCode = (typeof POD_FIELD_METRIC_CODES)[number];

/** Why a metric was not computed for a session. */
export type PodMetricOmission =
  'no_speed_data' | 'reference_vmax_missing' | 'sprint_zone_missing' | 'no_imu_data';

export interface PodSessionInput {
  readonly params: PodMetricParams;
  readonly sport: Sport;
  /** The player's absolute zones on the session's day (sex specific, B-804). */
  readonly absoluteZones: AbsoluteSpeedZoneSet;
  /** The player's relative zones on the session's day. */
  readonly relativeZones: RelativeSpeedZoneSet;
  /** The player's data windows inside the session (from the trim), UTC ms, half open. */
  readonly windows: readonly TimeInterval[];
  /** 10 Hz epochs, sorted by time (anything outside the windows is ignored). */
  readonly speed: readonly PodSpeedSample[];
  /** `accel_gyro` accelerations in g, sorted, `null` without IMU data. */
  readonly accel: AccelSeries | null;
  /** High-g norms in g, sorted, `null` without that channel. */
  readonly highG: HighGSeries | null;
  /** The reference Vmax, given the session's own peak (`resolveReferenceVmax`). */
  readonly referenceVmax: (sessionVmaxMs: number | null) => ReferenceVmax;
}

export interface PodSessionThresholds {
  readonly hsrAbsMs: number;
  /** `null` without a reference Vmax. */
  readonly hsrRelMs: number | null;
  /** `null` when the absolute zones lack `sprints.zoneCode`. */
  readonly sprintMs: number | null;
}

export interface PodSessionStats {
  /** Time inside the windows, seconds (`dist_m_min` divides by it). */
  readonly durationS: number;
  readonly speed: SpeedFilterReport;
  readonly runsN: number;
  readonly accelSamplesN: number;
  /** High-g impacts; `null` for a sport without contacts or without the channel. */
  readonly impactsN: number | null;
}

export interface PodSessionMetrics {
  readonly values: Partial<Record<PodFieldMetricCode, number>>;
  readonly omitted: Partial<Record<PodFieldMetricCode, PodMetricOmission>>;
  readonly reference: ReferenceVmax;
  readonly thresholds: PodSessionThresholds;
  readonly stats: PodSessionStats;
  /** Efforts, for the repeated-effort analysis (UTC ms). */
  readonly efforts: {
    readonly sprints: readonly Effort[];
    readonly accelerations: readonly Effort[];
    readonly decelerations: readonly Effort[];
    readonly impactsMs: readonly number[];
  };
}

function lowerBound(times: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sliceAccel(series: AccelSeries, from: number, to: number): AccelSeries {
  const slice = (a: ArrayLike<number>) => Array.prototype.slice.call(a, from, to) as number[];
  return {
    timeMs: slice(series.timeMs),
    xG: slice(series.xG),
    yG: slice(series.yG),
    zG: slice(series.zG),
  };
}

/**
 * The pod's canonical field metrics of one player in one session
 * (`pod-metrics/1`). Every window of the player is processed apart (nothing
 * is integrated across the edge of a window), then:
 *
 * - **speed**: the plausibility filter, then a centered moving average of
 *   `speedFilterS`;
 * - `dist_m`: trapezoids of the filtered speed; `dist_m_min` over the
 *   windows' duration;
 * - `hsr_abs_m` / `hsr_rel_m`: distance at or above the high-speed zone of
 *   the absolute / relative zones (the relative one times the reference
 *   Vmax), counted from the crossing;
 * - `vmax_ms`: the best mean speed over `vmaxWindowS`; `vmax_pct` against the
 *   reference Vmax;
 * - `acc_n` / `dec_n`: efforts of the acceleration (central differences of
 *   the filtered speed, then a moving average of `accelerationFilterS`) at or
 *   above the threshold (at or below its negative) for at least the dwell;
 * - `sprints_n` / `sprint_dist_m`: efforts of the filtered speed at or above
 *   the sprint zone for at least its dwell, and the distance inside them;
 * - `accel_load_au`: see `accelLoadAu`.
 *
 * A metric that cannot be computed is left out with its reason, never
 * written as 0.
 */
export function computePodSessionMetrics(input: PodSessionInput): PodSessionMetrics {
  const { params } = input;
  const windows = normalizeIntervals(input.windows).filter((w) => Number.isFinite(w.endMs));
  const durationS = windows.reduce((sum, w) => sum + (w.endMs - w.startMs), 0) / 1000;

  const runs: SpeedRun[] = [];
  const report = {
    samplesN: 0,
    keptN: 0,
    rejected: { fix: 0, accuracy: 0, range: 0, spike: 0, isolated: 0 },
  };
  for (const w of windows) {
    const inside = input.speed.filter((s) => s.timeMs >= w.startMs && s.timeMs < w.endMs);
    const filtered = filterSpeedSamples(inside, params.plausibility);
    report.samplesN += filtered.report.samplesN;
    report.keptN += filtered.report.keptN;
    for (const key of ['fix', 'accuracy', 'range', 'spike', 'isolated'] as const) {
      report.rejected[key] += filtered.report.rejected[key];
    }
    for (const run of filtered.runs) {
      runs.push({
        timeMs: run.timeMs,
        speedMs: movingAverage(run.timeMs, run.speedMs, params.speedFilterS),
      });
    }
  }

  const values: Partial<Record<PodFieldMetricCode, number>> = {};
  const omitted: Partial<Record<PodFieldMetricCode, PodMetricOmission>> = {};
  const hsrAbsMs = highSpeedThresholdMs(input.absoluteZones);
  const sprintBand = speedZoneBandsMs(input.absoluteZones).find(
    (b) => b.code === params.sprints.zoneCode,
  );
  const sprintMs = sprintBand?.minSpeedMs ?? null;

  const hasSpeed = runs.some((r) => r.timeMs.length >= 2);
  let sessionVmaxMs: number | null = null;
  const sprints: Effort[] = [];
  const accelerations: Effort[] = [];
  const decelerations: Effort[] = [];
  if (hasSpeed) {
    let dist = 0;
    let hsrAbs = 0;
    let sprintDist = 0;
    for (const run of runs) {
      dist += runDistanceM(run);
      hsrAbs += runDistanceAtOrAboveM(run, hsrAbsMs);
      const best = bestWindowMeanSpeedMs(run, params.vmaxWindowS);
      if (best !== null && (sessionVmaxMs === null || best > sessionVmaxMs)) sessionVmaxMs = best;
      const acc = movingAverage(run.timeMs, accelerationMs2(run), params.accelerationFilterS);
      accelerations.push(
        ...effortsAtOrAbove(
          run.timeMs,
          acc,
          params.accelerations.thresholdMs2,
          params.accelerations.minDwellS,
        ),
      );
      decelerations.push(
        ...effortsAtOrAbove(
          run.timeMs,
          acc.map((a) => -a),
          params.decelerations.thresholdMs2,
          params.decelerations.minDwellS,
        ).map((e) => ({ ...e, peak: -e.peak })),
      );
      if (sprintMs !== null) {
        const cumulative = cumulativeDistanceM(run);
        for (const e of effortsAtOrAbove(
          run.timeMs,
          run.speedMs,
          sprintMs,
          params.sprints.minDwellS,
        )) {
          sprints.push(e);
          sprintDist +=
            distanceAtM(run, cumulative, e.endMs) - distanceAtM(run, cumulative, e.startMs);
        }
      }
    }
    values.dist_m = dist;
    if (durationS > 0) values.dist_m_min = dist / (durationS / 60);
    values.hsr_abs_m = hsrAbs;
    values.acc_n = accelerations.length;
    values.dec_n = decelerations.length;
    if (sessionVmaxMs !== null) values.vmax_ms = sessionVmaxMs;
    else omitted.vmax_ms = 'no_speed_data';
    if (sprintMs === null) {
      omitted.sprints_n = 'sprint_zone_missing';
      omitted.sprint_dist_m = 'sprint_zone_missing';
    } else {
      values.sprints_n = sprints.length;
      values.sprint_dist_m = sprintDist;
    }
  } else {
    for (const code of [
      'dist_m',
      'dist_m_min',
      'hsr_abs_m',
      'vmax_ms',
      'acc_n',
      'dec_n',
      'sprints_n',
      'sprint_dist_m',
    ] as const) {
      omitted[code] = 'no_speed_data';
    }
  }

  const reference = input.referenceVmax(sessionVmaxMs);
  let hsrRelMs: number | null = null;
  if (!hasSpeed) {
    omitted.hsr_rel_m = 'no_speed_data';
    omitted.vmax_pct = 'no_speed_data';
  } else if (reference.vmaxMs === null) {
    omitted.hsr_rel_m = 'reference_vmax_missing';
    omitted.vmax_pct = 'reference_vmax_missing';
  } else {
    hsrRelMs = highSpeedThresholdMs(input.relativeZones, reference.vmaxMs);
    const threshold = hsrRelMs;
    values.hsr_rel_m = runs.reduce((sum, run) => sum + runDistanceAtOrAboveM(run, threshold), 0);
    if (sessionVmaxMs !== null) values.vmax_pct = (sessionVmaxMs / reference.vmaxMs) * 100;
    else omitted.vmax_pct = 'no_speed_data';
  }

  let accelSamplesN = 0;
  if (input.accel !== null && input.accel.timeMs.length > 1) {
    let load = 0;
    for (const w of windows) {
      const from = lowerBound(input.accel.timeMs, w.startMs);
      const to = lowerBound(input.accel.timeMs, w.endMs);
      if (to - from < 2) continue;
      const part = accelLoadAu(sliceAccel(input.accel, from, to), params.accelLoad);
      load += part.loadAu;
      accelSamplesN += part.samplesN;
    }
    if (accelSamplesN > 1) values.accel_load_au = load;
  }
  if (values.accel_load_au === undefined) omitted.accel_load_au = 'no_imu_data';

  let impactsMs: number[] = [];
  let impactsN: number | null = null;
  if (params.impacts.sports.includes(input.sport) && input.highG !== null) {
    const highG = input.highG;
    impactsMs = windows.flatMap((w) => {
      const from = lowerBound(highG.timeMs, w.startMs);
      const to = lowerBound(highG.timeMs, w.endMs);
      const slice = (a: ArrayLike<number>) => Array.prototype.slice.call(a, from, to) as number[];
      return impactTimesMs(
        { timeMs: slice(highG.timeMs), normG: slice(highG.normG) },
        params.impacts.thresholdG,
        params.impacts.minSeparationS,
      );
    });
    impactsN = impactsMs.length;
  }

  return {
    values,
    omitted,
    reference,
    thresholds: { hsrAbsMs, hsrRelMs, sprintMs },
    stats: {
      durationS,
      speed: report,
      runsN: runs.length,
      accelSamplesN,
      impactsN,
    },
    efforts: { sprints, accelerations, decelerations, impactsMs },
  };
}
