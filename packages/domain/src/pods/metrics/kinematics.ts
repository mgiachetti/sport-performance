import type { PodAccelLoadParams, PodFixQuality, PodPlausibilityParams } from './params.js';

/**
 * The building blocks of the pod's field metrics (B-919): plausibility
 * filtering of the 10 Hz Doppler speed, smoothing, distance, time-based
 * windows, efforts over a threshold with a dwell time, the accelerometer
 * load and the high-g impacts. Pure functions on plain arrays; times are UTC
 * milliseconds, speeds m/s, accelerations m/s² or g as named.
 */

/** One GNSS epoch (10 Hz) as the metrics read it. */
export interface PodSpeedSample {
  readonly timeMs: number;
  /** Doppler ground speed; `null` = no data. */
  readonly speedMs: number | null;
  readonly fixQuality: PodFixQuality;
  readonly horizontalAccuracyM: number | null;
  readonly speedAccuracyMs: number | null;
}

/** A continuous stretch of kept epochs (no gap over `maxGapS`), sorted by time. */
export interface SpeedRun {
  readonly timeMs: readonly number[];
  readonly speedMs: readonly number[];
}

export interface SpeedFilterReport {
  readonly samplesN: number;
  readonly keptN: number;
  /** Epochs dropped, by reason. */
  readonly rejected: {
    readonly fix: number;
    readonly accuracy: number;
    readonly range: number;
    readonly spike: number;
    /** Epochs of a stretch too short to be data, far from any good data. */
    readonly isolated: number;
  };
}

/**
 * Plausibility filter (ADR 0106). Epochs without an accepted fix, with a
 * poor or unknown accuracy estimate or out of the human range are dropped.
 * The rest is split into **chains**: consecutive epochs (at most `maxGapS`
 * apart) whose change of speed never exceeds `maxAccelerationMs2`. Every
 * epoch is compared with the one right before it, never with an older kept
 * one, so the allowed change never grows with the time spent rejecting.
 *
 * A chain shorter than `minChainS` is a spike (multipath lasts one to a few
 * epochs, and those epochs can agree with each other) and is dropped,
 * whether it comes first, after a gap or in the middle. Two good chains on
 * both sides of a dropped one are joined into one run when they are less
 * than `maxGapS` apart and the change of speed between them is within
 * `maxAccelerationMs2` over at most `minChainS`; otherwise each starts its
 * own run, and nothing is integrated across.
 */
export function filterSpeedSamples(
  samples: readonly PodSpeedSample[],
  params: PodPlausibilityParams,
): { runs: SpeedRun[]; report: SpeedFilterReport } {
  const accepted = new Set<string>(params.acceptedFixQualities);
  const rejected = { fix: 0, accuracy: 0, range: 0, spike: 0, isolated: 0 };
  const maxGapMs = params.maxGapS * 1000;
  const minChainMs = params.minChainS * 1000 - 1e-6;
  const chains: { timeMs: number[]; speedMs: number[] }[] = [];
  let chain: { timeMs: number[]; speedMs: number[] } = { timeMs: [], speedMs: [] };
  const breakChain = () => {
    if (chain.timeMs.length > 0) chains.push(chain);
    chain = { timeMs: [], speedMs: [] };
  };
  let seen = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    // Sorted input: a repeated or older epoch than the last one seen is skipped.
    if (s.timeMs <= seen) continue;
    seen = s.timeMs;
    if (!accepted.has(s.fixQuality) || s.speedMs === null) {
      rejected.fix += 1;
      continue;
    }
    if (
      (params.maxHorizontalAccuracyM !== null &&
        (s.horizontalAccuracyM === null ||
          s.horizontalAccuracyM > params.maxHorizontalAccuracyM)) ||
      (params.maxSpeedAccuracyMs !== null &&
        (s.speedAccuracyMs === null || s.speedAccuracyMs > params.maxSpeedAccuracyMs))
    ) {
      rejected.accuracy += 1;
      continue;
    }
    if (!Number.isFinite(s.speedMs) || s.speedMs < 0 || s.speedMs > params.maxSpeedMs) {
      rejected.range += 1;
      continue;
    }
    const lastTime = chain.timeMs.at(-1);
    const lastSpeed = chain.speedMs.at(-1);
    if (lastTime !== undefined && lastSpeed !== undefined) {
      const dtMs = s.timeMs - lastTime;
      if (
        dtMs > maxGapMs ||
        (Math.abs(s.speedMs - lastSpeed) / dtMs) * 1000 > params.maxAccelerationMs2
      ) {
        breakChain();
      }
    }
    chain.timeMs.push(s.timeMs);
    chain.speedMs.push(s.speedMs);
  }
  breakChain();

  const runs: SpeedRun[] = [];
  let run: { timeMs: number[]; speedMs: number[] } | null = null;
  let kept = 0;
  let droppedSinceRun = false;
  for (const [i, c] of chains.entries()) {
    const first = c.timeMs[0] ?? 0;
    const last = c.timeMs.at(-1) ?? 0;
    if (last - first < minChainMs) {
      // A spike when another chain is within a gap of it, otherwise a lone stretch.
      const before = chains[i - 1]?.timeMs.at(-1);
      const after = chains[i + 1]?.timeMs[0];
      const near =
        (before !== undefined && first - before <= maxGapMs) ||
        (after !== undefined && after - last <= maxGapMs);
      if (near) rejected.spike += c.timeMs.length;
      else rejected.isolated += c.timeMs.length;
      droppedSinceRun = true;
      continue;
    }
    kept += c.timeMs.length;
    const tailTime = run?.timeMs.at(-1);
    const tailSpeed = run?.speedMs.at(-1);
    const joinable =
      run !== null &&
      droppedSinceRun &&
      tailTime !== undefined &&
      tailSpeed !== undefined &&
      first - tailTime <= maxGapMs &&
      Math.abs((c.speedMs[0] ?? 0) - tailSpeed) <=
        params.maxAccelerationMs2 * Math.min((first - tailTime) / 1000, params.minChainS);
    if (run !== null && joinable) {
      run.timeMs.push(...c.timeMs);
      run.speedMs.push(...c.speedMs);
    } else {
      if (run !== null) runs.push(run);
      run = { timeMs: [...c.timeMs], speedMs: [...c.speedMs] };
    }
    droppedSinceRun = false;
  }
  if (run !== null) runs.push(run);
  return { runs, report: { samplesN: samples.length, keptN: kept, rejected } };
}

/**
 * Centered moving average by time: the mean of the values within
 * `windowS / 2` of each sample (the run's ends average fewer). `0` returns
 * the values as they are.
 */
export function movingAverage(
  timeMs: readonly number[],
  values: readonly number[],
  windowS: number,
): number[] {
  if (windowS <= 0) return [...values];
  const half = (windowS * 1000) / 2 + 1e-6;
  const out: number[] = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const t = timeMs[i] ?? 0;
    while (hi < values.length && (timeMs[hi] ?? 0) <= t + half) {
      sum += values[hi] ?? 0;
      hi += 1;
    }
    while ((timeMs[lo] ?? 0) < t - half) {
      sum -= values[lo] ?? 0;
      lo += 1;
    }
    out.push(sum / (hi - lo));
  }
  return out;
}

/** Cumulative distance at each epoch of a run (trapezoids), metres. */
export function cumulativeDistanceM(run: SpeedRun): number[] {
  const out: number[] = [0];
  for (let i = 1; i < run.timeMs.length; i += 1) {
    const dtS = ((run.timeMs[i] ?? 0) - (run.timeMs[i - 1] ?? 0)) / 1000;
    out.push((out[i - 1] ?? 0) + (((run.speedMs[i] ?? 0) + (run.speedMs[i - 1] ?? 0)) / 2) * dtS);
  }
  return out;
}

/** Distance covered from the start of the run to `atMs` (speed linear between epochs). */
export function distanceAtM(run: SpeedRun, cumulative: readonly number[], atMs: number): number {
  const n = run.timeMs.length;
  if (n === 0) return 0;
  if (atMs <= (run.timeMs[0] ?? 0)) return 0;
  if (atMs >= (run.timeMs[n - 1] ?? 0)) return cumulative[n - 1] ?? 0;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((run.timeMs[mid] ?? 0) <= atMs) lo = mid;
    else hi = mid;
  }
  const t0 = run.timeMs[lo] ?? 0;
  const t1 = run.timeMs[hi] ?? 0;
  const v0 = run.speedMs[lo] ?? 0;
  const v1 = run.speedMs[hi] ?? 0;
  const vAt = v0 + ((v1 - v0) * (atMs - t0)) / (t1 - t0);
  return (cumulative[lo] ?? 0) + ((v0 + vAt) / 2) * ((atMs - t0) / 1000);
}

/** Distance of a run, metres. */
export function runDistanceM(run: SpeedRun): number {
  return cumulativeDistanceM(run).at(-1) ?? 0;
}

/**
 * Distance at or above `thresholdMs` in a run, metres: the part of each
 * trapezoid where the (linear) speed is at or above the threshold, so a run
 * that crosses it mid-epoch counts only from the crossing.
 */
export function runDistanceAtOrAboveM(run: SpeedRun, thresholdMs: number): number {
  let total = 0;
  for (let i = 1; i < run.timeMs.length; i += 1) {
    const t0 = run.timeMs[i - 1] ?? 0;
    const t1 = run.timeMs[i] ?? 0;
    const v0 = run.speedMs[i - 1] ?? 0;
    const v1 = run.speedMs[i] ?? 0;
    const dtS = (t1 - t0) / 1000;
    if (v0 >= thresholdMs && v1 >= thresholdMs) total += ((v0 + v1) / 2) * dtS;
    else if (v0 < thresholdMs && v1 < thresholdMs) continue;
    else {
      const crossS = ((thresholdMs - v0) / (v1 - v0)) * dtS;
      total +=
        v0 >= thresholdMs
          ? ((v0 + thresholdMs) / 2) * crossS
          : ((thresholdMs + v1) / 2) * (dtS - crossS);
    }
  }
  return total;
}

/**
 * The highest mean speed over any `windowS` of the run (the window fully
 * inside it), m/s; `null` when the run is shorter than the window.
 */
export function bestWindowMeanSpeedMs(run: SpeedRun, windowS: number): number | null {
  const cumulative = cumulativeDistanceM(run);
  const windowMs = windowS * 1000;
  const last = run.timeMs.at(-1) ?? 0;
  let best: number | null = null;
  for (let i = 0; i < run.timeMs.length; i += 1) {
    const start = run.timeMs[i] ?? 0;
    // A tolerance of a microsecond: 10 Hz epochs land on the window's end exactly.
    if (start + windowMs > last + 1e-3) break;
    const mean = (distanceAtM(run, cumulative, start + windowMs) - (cumulative[i] ?? 0)) / windowS;
    if (best === null || mean > best) best = mean;
  }
  return best;
}

/**
 * Acceleration at each epoch, m/s²: central differences of the speed (one
 * sided at the ends of the run).
 */
export function accelerationMs2(run: SpeedRun): number[] {
  const n = run.timeMs.length;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dtS = ((run.timeMs[b] ?? 0) - (run.timeMs[a] ?? 0)) / 1000;
    out.push(dtS > 0 ? ((run.speedMs[b] ?? 0) - (run.speedMs[a] ?? 0)) / dtS : 0);
  }
  return out;
}

/** One effort over a threshold: when it started and ended (UTC ms) and its peak. */
export interface Effort {
  readonly startMs: number;
  readonly endMs: number;
  readonly peak: number;
}

/**
 * Efforts where `values` stays at or above `threshold` for at least
 * `minDwellS`, with the start and end where the linear interpolation between
 * samples crosses the threshold (a run that starts or ends above it starts or
 * ends with the run).
 */
export function effortsAtOrAbove(
  timeMs: readonly number[],
  values: readonly number[],
  threshold: number,
  minDwellS: number,
): Effort[] {
  const efforts: Effort[] = [];
  const minMs = minDwellS * 1000 - 1e-6;
  let start: number | null = null;
  let peak = Number.NEGATIVE_INFINITY;
  const n = values.length;
  for (let i = 0; i < n; i += 1) {
    const v = values[i] ?? 0;
    const t = timeMs[i] ?? 0;
    if (i === 0) {
      if (v >= threshold) {
        start = t;
        peak = v;
      }
      continue;
    }
    const v0 = values[i - 1] ?? 0;
    const t0 = timeMs[i - 1] ?? 0;
    const cross = () => t0 + ((threshold - v0) / (v - v0)) * (t - t0);
    if (start === null && v >= threshold) {
      start = cross();
      peak = v;
    } else if (start !== null && v < threshold) {
      const end = cross();
      if (end - start >= minMs) efforts.push({ startMs: start, endMs: end, peak });
      start = null;
    } else if (start !== null) {
      peak = Math.max(peak, v);
    }
  }
  if (start !== null) {
    const end = timeMs[n - 1] ?? start;
    if (end - start >= minMs) efforts.push({ startMs: start, endMs: end, peak });
  }
  return efforts;
}

/** Reads an array-like at `i` (0 past its end: callers stay inside). */
function at(values: ArrayLike<number>, i: number): number {
  return values[i] ?? 0;
}

/** Accelerometer samples (any rate), in g, sorted by time. */
export interface AccelSeries {
  readonly timeMs: ArrayLike<number>;
  readonly xG: ArrayLike<number>;
  readonly yG: ArrayLike<number>;
  readonly zG: ArrayLike<number>;
}

/**
 * `accel_load_au` of a series (see `PodAccelLoadParams`): resampled to
 * `sampleRateHz` by linear interpolation inside every stretch without a gap
 * over `maxGapS`, then `Σ √(Δx² + Δy² + Δz²) × scale` over consecutive
 * resampled points. Also returns the samples used.
 */
export function accelLoadAu(
  series: AccelSeries,
  params: PodAccelLoadParams,
): { loadAu: number; samplesN: number } {
  const n = series.timeMs.length;
  const stepMs = 1000 / params.sampleRateHz;
  const maxGapMs = params.maxGapS * 1000;
  let sum = 0;
  let used = 0;
  let i = 0;
  while (i < n) {
    // A stretch [i, j] with no gap.
    let j = i;
    while (j + 1 < n && at(series.timeMs, j + 1) - at(series.timeMs, j) <= maxGapMs) j += 1;
    used += j - i + 1;
    if (j > i) {
      let k = i;
      let px = at(series.xG, i);
      let py = at(series.yG, i);
      let pz = at(series.zG, i);
      const t0 = at(series.timeMs, i);
      const tEnd = at(series.timeMs, j);
      for (let step = 1; t0 + step * stepMs <= tEnd + 1e-6; step += 1) {
        const t = t0 + step * stepMs;
        while (k + 1 < j && at(series.timeMs, k + 1) < t) k += 1;
        const ta = at(series.timeMs, k);
        const tb = at(series.timeMs, k + 1);
        const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
        const x = at(series.xG, k) + (at(series.xG, k + 1) - at(series.xG, k)) * f;
        const y = at(series.yG, k) + (at(series.yG, k + 1) - at(series.yG, k)) * f;
        const z = at(series.zG, k) + (at(series.zG, k + 1) - at(series.zG, k)) * f;
        sum += Math.sqrt((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2);
        px = x;
        py = y;
        pz = z;
      }
    }
    i = j + 1;
  }
  return { loadAu: sum * params.scale, samplesN: used };
}

/** Samples of the high-g channel further apart than this belong to different bursts. */
export const HIGH_G_BURST_GAP_MS = 100;

/** The high-g channel: the norm of the acceleration of each sample, in g. */
export interface HighGSeries {
  readonly timeMs: ArrayLike<number>;
  readonly normG: ArrayLike<number>;
}

/**
 * Impacts (see `PodImpactParams`): a crossing of `thresholdG` upwards at
 * least `minSeparationS` after the previous impact. Returns their times.
 */
export function impactTimesMs(
  series: HighGSeries,
  thresholdG: number,
  minSeparationS: number,
): number[] {
  const out: number[] = [];
  let above = false;
  let last = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < series.timeMs.length; i += 1) {
    const g = at(series.normG, i);
    const t = at(series.timeMs, i);
    // The high-g channel records in bursts: a new burst starts below the threshold.
    if (i > 0 && t - at(series.timeMs, i - 1) > HIGH_G_BURST_GAP_MS) above = false;
    if (g >= thresholdG) {
      if (!above && t - last >= minSeparationS * 1000) {
        out.push(t);
        last = t;
      }
      above = true;
    } else above = false;
  }
  return out;
}
