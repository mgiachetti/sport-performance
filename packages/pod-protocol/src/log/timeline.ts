import {
  ANCHOR_LOOKBACK,
  ANCHOR_MAX_RATE_ERROR_PPM,
  ANCHOR_STRETCH_MIN,
  ANCHOR_STRETCH_MIN_TICKS,
  MAX_TIME_STRETCHES,
  DEFAULT_GPS_UTC_OFFSET_S,
  GPS_EPOCH_UNIX_MS,
  RTC_TICK_HZ,
  RTC_TOLERANCE_PPM,
} from './constants.js';
import type {
  SensorSyncRecord,
  SyncSensor,
  TimeAnchorRecord,
  TimeAnchorSource,
} from './records.js';

/**
 * Time base of the log (ADR 0106, "Base de tiempo"): records carry RTC ticks
 * (32,768 Hz since the boot); anchors pair a tick with GPS time (PPS, gateway
 * beacon or dock). The mapping is piecewise linear through the kept anchors,
 * so it is monotonic inside a stretch, follows the crystal drift and places
 * what was recorded before the first fix backwards from the anchors. A step in
 * the GNSS time splits the boot into stretches, each with its own anchors.
 */

const NS_PER_TICK = 1e9 / RTC_TICK_HZ;
const MS_PER_TICK = 1000 / RTC_TICK_HZ;

/** A lower-priority anchor inside a run of better anchors closer than this is dropped. */
const COVERED_GAP_TICKS = 60 * RTC_TICK_HZ;

const SOURCE_PRIORITY: Record<TimeAnchorSource, number> = { gnss_pps: 3, beacon: 2, dock: 1 };
/** Uncertainty assumed when an anchor does not say (µs). */
const DEFAULT_UNCERTAINTY_US: Record<TimeAnchorSource, number> = {
  gnss_pps: 1,
  beacon: 100,
  dock: 50_000,
};

export interface TimeAnchorPoint {
  /** Fractional RTC tick of the edge (tick + subTickNs). */
  tick: number;
  gnssTimeMs: number;
  source: TimeAnchorSource;
  uncertaintyUs: number;
}

export type RejectedAnchorReason =
  | 'covered_by_better_source'
  | 'rate_out_of_range'
  /** Beyond `MAX_TIME_STRETCHES` stretches in one boot (hostile or broken timing). */
  | 'too_many_stretches';

/** Anchors consistent among themselves, with no step between them. */
export interface TimeStretch {
  points: TimeAnchorPoint[];
}

/** A jump of the GNSS time between two stretches. */
export interface TimeStep {
  /** Last anchor of the earlier stretch and first of the later one (ticks). */
  afterTick: number;
  beforeTick: number;
  /** GPS time of the later stretch minus the earlier one extrapolated to its first anchor. */
  stepMs: number;
}

export interface TimeBase {
  bootCounter: number;
  /** Kept anchors of every stretch, sorted by tick. */
  points: TimeAnchorPoint[];
  /** One per stretch without a step, in tick order. */
  stretches: TimeStretch[];
  steps: TimeStep[];
  rejected: (TimeAnchorPoint & { reason: RejectedAnchorReason })[];
  /** Best source among the kept anchors; `none` = no absolute time for this boot. */
  source: TimeAnchorSource | 'none';
  /** GPS − UTC from the anchors (the default if none said). */
  gpsUtcOffsetS: number;
}

export function anchorPoint(anchor: TimeAnchorRecord): TimeAnchorPoint {
  return {
    tick: anchor.tick + anchor.subTickNs / NS_PER_TICK,
    gnssTimeMs: anchor.gnssTimeMs,
    source: anchor.source,
    uncertaintyUs: anchor.uncertaintyUs ?? DEFAULT_UNCERTAINTY_US[anchor.source],
  };
}

/** Two anchors agree if their rate is within 100 ppm of nominal, beyond both uncertainties. */
function rateConsistent(a: TimeAnchorPoint, b: TimeAnchorPoint): boolean {
  const nominalMs = (b.tick - a.tick) * MS_PER_TICK;
  const actualMs = b.gnssTimeMs - a.gnssTimeMs;
  if (nominalMs <= 0 || actualMs <= 0) {
    return false;
  }
  const allowedMs =
    (nominalMs * ANCHOR_MAX_RATE_ERROR_PPM) / 1e6 + (a.uncertaintyUs + b.uncertaintyUs) / 1000;
  return Math.abs(actualMs - nominalMs) <= allowedMs;
}

/** Index of the first item with `key(item) > value` (items sorted by key). */
function upperBoundBy<T>(items: readonly T[], value: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const item = items[mid];
    if (item !== undefined && key(item) <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upperBound(points: readonly TimeAnchorPoint[], value: number): number {
  return upperBoundBy(points, value, (p) => p.tick);
}

/** Index i in 1..n−1 of the segment [i−1, i] to use for `value` (extrapolates at the ends). */
function segmentIndex(n: number, upper: number): number {
  return Math.min(Math.max(upper, 1), n - 1);
}

/**
 * Best chain of `anchors` (sorted by tick): the longest sequence in which each
 * consecutive pair is consistent and each link skips at most `ANCHOR_LOOKBACK`
 * anchors (a gap with no anchors is still bridged), ties broken by the better
 * sources. Dynamic programming in O(n · K).
 */
function bestChain(anchors: readonly TimeAnchorPoint[]): number[] {
  const n = anchors.length;
  const count = new Int32Array(n);
  const prioritySum = new Float64Array(n);
  const previous = new Int32Array(n).fill(-1);
  let bestEnd = -1;
  for (let j = 0; j < n; j += 1) {
    const pj = anchors[j];
    if (!pj) {
      continue;
    }
    const priorityJ = SOURCE_PRIORITY[pj.source];
    count[j] = 1;
    prioritySum[j] = priorityJ;
    const stop = Math.max(0, j - 1 - ANCHOR_LOOKBACK);
    for (let i = j - 1; i >= stop; i -= 1) {
      const pi = anchors[i];
      if (!pi || !rateConsistent(pi, pj)) {
        continue;
      }
      const c = (count[i] ?? 0) + 1;
      const p = (prioritySum[i] ?? 0) + priorityJ;
      if (c > (count[j] ?? 0) || (c === count[j] && p > (prioritySum[j] ?? 0))) {
        count[j] = c;
        prioritySum[j] = p;
        previous[j] = i;
      }
    }
    if (
      bestEnd < 0 ||
      (count[j] ?? 0) > (count[bestEnd] ?? 0) ||
      (count[j] === count[bestEnd] && (prioritySum[j] ?? 0) > (prioritySum[bestEnd] ?? 0))
    ) {
      bestEnd = j;
    }
  }
  const chain: number[] = [];
  for (let k = bestEnd; k >= 0; k = previous[k] ?? -1) {
    chain.push(k);
  }
  return chain.reverse();
}

/** Whether a chain found before or after the main one is enough to be its own stretch. */
function longEnoughForStretch(points: readonly TimeAnchorPoint[]): boolean {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return false;
  }
  return (
    points.length >= ANCHOR_STRETCH_MIN ||
    (points.length >= 3 && last.tick - first.tick >= ANCHOR_STRETCH_MIN_TICKS)
  );
}

/**
 * Splits `anchors` into stretches with a work list (no recursion): the best
 * chain of the whole boot is the first stretch; the anchors inside its span
 * that are not in it are rejected; the ones before and after it are split
 * again. A stretch there needs `longEnoughForStretch` (10 anchors, or 3 over
 * 30 s), and a boot has at most `MAX_TIME_STRETCHES`: the rest is rejected
 * (`too_many_stretches`). Each pass is O(n · K) and there are at most
 * 2 · MAX_TIME_STRETCHES + 1 passes.
 */
function buildStretches(
  anchors: readonly TimeAnchorPoint[],
  rejected: TimeBase['rejected'],
): TimeStretch[] {
  const stretches: TimeStretch[] = [];
  const work: { items: readonly TimeAnchorPoint[]; top: boolean }[] = [
    { items: anchors, top: true },
  ];
  const rejectAll = (items: readonly TimeAnchorPoint[], reason: RejectedAnchorReason): void => {
    for (const p of items) {
      rejected.push({ ...p, reason });
    }
  };
  for (let item = work.shift(); item; item = work.shift()) {
    const { items, top } = item;
    if (items.length === 0) {
      continue;
    }
    if (stretches.length >= MAX_TIME_STRETCHES) {
      rejectAll(items, 'too_many_stretches');
      continue;
    }
    const chain = bestChain(items);
    const points = chain.map((k) => items[k]).filter((p): p is TimeAnchorPoint => !!p);
    if (!top && !longEnoughForStretch(points)) {
      rejectAll(items, 'rate_out_of_range');
      continue;
    }
    const first = chain[0] ?? 0;
    const last = chain.at(-1) ?? 0;
    const inChain = new Set(chain);
    for (let k = first; k <= last; k += 1) {
      const p = items[k];
      if (p && !inChain.has(k)) {
        rejected.push({ ...p, reason: 'rate_out_of_range' });
      }
    }
    stretches.push({ points });
    work.push({ items: items.slice(0, first), top: false });
    work.push({ items: items.slice(last + 1), top: false });
  }
  return stretches.sort((a, b) => (a.points[0]?.tick ?? 0) - (b.points[0]?.tick ?? 0));
}

function mapInPoints(points: readonly TimeAnchorPoint[], tick: number): number | null {
  const first = points[0];
  if (!first) {
    return null;
  }
  if (points.length < 2) {
    return first.gnssTimeMs + (tick - first.tick) * MS_PER_TICK;
  }
  const i = segmentIndex(points.length, upperBound(points, tick));
  const a = points[i - 1];
  const b = points[i];
  if (!a || !b) {
    return null;
  }
  return a.gnssTimeMs + ((tick - a.tick) * (b.gnssTimeMs - a.gnssTimeMs)) / (b.tick - a.tick);
}

/**
 * Builds the time base of one boot from its anchors:
 * 1. better sources first: an anchor of a lower-priority source between two
 *    kept better anchors less than 60 s apart is dropped;
 * 2. consensus: the longest chain of anchors in which each consecutive pair
 *    agrees within 100 ppm of nominal (beyond both uncertainties), skipping at
 *    most 64 anchors per link, ties broken by the better sources;
 * 3. steps: anchors before or after that chain that agree among themselves
 *    (10 or more, or 3 over 30 s) form their own stretch, up to 16 per boot,
 *    and the jump between stretches is reported. Times are never interpolated
 *    across a step.
 */
export function buildTimeBase(bootCounter: number, anchors: readonly TimeAnchorRecord[]): TimeBase {
  const all = anchors.map(anchorPoint);
  const rejected: TimeBase['rejected'] = [];
  let kept: TimeAnchorPoint[] = [];
  for (const priority of [3, 2, 1]) {
    const ofPriority = all.filter((p) => SOURCE_PRIORITY[p.source] === priority);
    const accepted: TimeAnchorPoint[] = [];
    for (const point of ofPriority) {
      const i = upperBound(kept, point.tick);
      const before = kept[i - 1];
      const after = kept[i];
      if (before && after && after.tick - before.tick <= COVERED_GAP_TICKS) {
        rejected.push({ ...point, reason: 'covered_by_better_source' });
      } else {
        accepted.push(point);
      }
    }
    kept = [...kept, ...accepted].sort((a, b) => a.tick - b.tick);
  }

  const stretches = buildStretches(kept, rejected);
  const steps: TimeStep[] = [];
  for (let k = 1; k < stretches.length; k += 1) {
    const a = stretches[k - 1]?.points ?? [];
    const b = stretches[k]?.points ?? [];
    const lastA = a.at(-1);
    const firstB = b[0];
    if (lastA && firstB) {
      steps.push({
        afterTick: lastA.tick,
        beforeTick: firstB.tick,
        stepMs: firstB.gnssTimeMs - (mapInPoints(a, firstB.tick) ?? firstB.gnssTimeMs),
      });
    }
  }
  const points = stretches.flatMap((s) => s.points);

  const best = points.reduce<TimeAnchorSource | 'none'>(
    (acc, p) =>
      acc === 'none' || SOURCE_PRIORITY[p.source] > SOURCE_PRIORITY[acc] ? p.source : acc,
    'none',
  );
  const offsets = anchors.map((a) => a.gpsUtcOffsetS).filter((v): v is number => v !== null);
  return {
    bootCounter,
    points,
    stretches,
    steps,
    rejected: rejected.sort((a, b) => a.tick - b.tick),
    source: best,
    gpsUtcOffsetS: offsets.at(-1) ?? DEFAULT_GPS_UTC_OFFSET_S,
  };
}

/** The stretch that times `tick`: the one that contains it, else the nearest by tick. */
function stretchFor(base: TimeBase, tick: number): TimeStretch | null {
  let best: TimeStretch | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stretch of base.stretches) {
    const first = stretch.points[0];
    const last = stretch.points.at(-1);
    if (!first || !last) {
      continue;
    }
    const distance =
      tick < first.tick ? first.tick - tick : tick > last.tick ? tick - last.tick : 0;
    if (distance < bestDistance) {
      best = stretch;
      bestDistance = distance;
    }
  }
  return best;
}

/** GPS time (ms) of a fractional RTC tick, or `null` if the boot has no anchor. */
export function tickToGnssMs(base: TimeBase, tick: number): number | null {
  const stretch = stretchFor(base, tick);
  return stretch ? mapInPoints(stretch.points, tick) : null;
}

/**
 * Inverse of `tickToGnssMs`, in the stretch whose GPS times contain the value,
 * else the nearest. After a backward step two stretches can cover the same GPS
 * times: the first in tick order wins (GPS time alone cannot tell them apart).
 */
export function gnssMsToTick(base: TimeBase, gnssTimeMs: number): number | null {
  let points: TimeAnchorPoint[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stretch of base.stretches) {
    const first = stretch.points[0];
    const last = stretch.points.at(-1);
    if (!first || !last) {
      continue;
    }
    const distance =
      gnssTimeMs < first.gnssTimeMs
        ? first.gnssTimeMs - gnssTimeMs
        : gnssTimeMs > last.gnssTimeMs
          ? gnssTimeMs - last.gnssTimeMs
          : 0;
    if (distance < bestDistance) {
      points = stretch.points;
      bestDistance = distance;
    }
  }
  const first = points?.[0];
  if (!points || !first) {
    return null;
  }
  if (points.length < 2) {
    return first.tick + (gnssTimeMs - first.gnssTimeMs) / MS_PER_TICK;
  }
  const i = segmentIndex(
    points.length,
    upperBoundBy(points, gnssTimeMs, (p) => p.gnssTimeMs),
  );
  const a = points[i - 1];
  const b = points[i];
  if (!a || !b) {
    return null;
  }
  return a.tick + ((gnssTimeMs - a.gnssTimeMs) * (b.tick - a.tick)) / (b.gnssTimeMs - a.gnssTimeMs);
}

/**
 * Rough uncertainty (ms) of `tickToGnssMs`: the nearest anchor's own
 * uncertainty plus the crystal tolerance (±20 ppm) over the distance to it.
 */
export function tickUncertaintyMs(base: TimeBase, tick: number): number | null {
  const points = stretchFor(base, tick)?.points ?? [];
  const i = upperBound(points, tick);
  let best: number | null = null;
  for (const point of [points[i - 1], points[i]]) {
    if (point) {
      const value =
        point.uncertaintyUs / 1000 +
        (Math.abs(tick - point.tick) * MS_PER_TICK * RTC_TOLERANCE_PPM) / 1e6;
      best = best === null ? value : Math.min(best, value);
    }
  }
  return best;
}

export function gnssMsToUnixMs(
  gnssTimeMs: number,
  gpsUtcOffsetS = DEFAULT_GPS_UTC_OFFSET_S,
): number {
  return gnssTimeMs + GPS_EPOCH_UNIX_MS - gpsUtcOffsetS * 1000;
}

export function unixMsToGnssMs(unixMs: number, gpsUtcOffsetS = DEFAULT_GPS_UTC_OFFSET_S): number {
  return unixMs - GPS_EPOCH_UNIX_MS + gpsUtcOffsetS * 1000;
}

// ---------------------------------------------------------------------------
// Sensor clock (IMU FIFO timestamps)
// ---------------------------------------------------------------------------

const U32 = 0x1_0000_0000;

/** Relative error between the sensor and the RTC beyond which a jump is a reset, not drift. */
const SENSOR_RESET_TOLERANCE = 0.05;

export interface SensorClockRun {
  /** (unwrapped sensor timestamp, fractional RTC tick), sorted. */
  points: { sensorTimestamp: number; tick: number }[];
}

export interface SensorClock {
  sensor: SyncSensor;
  sensorTickPeriodNs: number;
  /**
   * One run per stretch of a continuous sensor counter. A sensor reset in the
   * middle of a boot (power cycle, reconfiguration) starts a new run; a 32-bit
   * wrap does not.
   */
  runs: SensorClockRun[];
}

/**
 * Correlates the sensor's own timestamp counter with the RTC from the
 * `sensor_sync` records. Between two syncs the counter must advance by what
 * the RTC says (within 5 %, modulo 2³²): then a decrease is a wrap; otherwise
 * the sensor was reset and a new run starts. With a period ≤ 0 there is no
 * clock (no runs).
 */
export function buildSensorClock(
  sensor: SyncSensor,
  syncs: readonly SensorSyncRecord[],
  sensorTickPeriodNs: number,
): SensorClock {
  const runs: SensorClockRun[] = [];
  if (!(sensorTickPeriodNs > 0)) {
    return { sensor, sensorTickPeriodNs, runs };
  }
  const ticksPerSensor = sensorTickPeriodNs / NS_PER_TICK;
  let run: SensorClockRun | null = null;
  let previous: { raw: number; unwrapped: number; tick: number } | null = null;
  for (const sync of syncs) {
    if (sync.sensor !== sensor) {
      continue;
    }
    const tick = sync.tick + sync.subTickNs / NS_PER_TICK;
    let unwrapped = sync.sensorTimestamp;
    let continues = false;
    if (previous && run) {
      const expected = (tick - previous.tick) / ticksPerSensor;
      const advance = (sync.sensorTimestamp - previous.raw + U32) % U32;
      continues =
        expected > 0 &&
        expected < U32 / 2 &&
        Math.abs(advance - expected) <= Math.max(expected * SENSOR_RESET_TOLERANCE, 2);
      unwrapped = previous.unwrapped + advance;
    }
    if (!continues || !run) {
      run = { points: [] };
      runs.push(run);
      unwrapped = sync.sensorTimestamp;
    }
    run.points.push({ sensorTimestamp: unwrapped, tick });
    previous = { raw: sync.sensorTimestamp, unwrapped, tick };
  }
  return { sensor, sensorTickPeriodNs, runs };
}

/**
 * RTC tick of a (32-bit, wrapping) sensor timestamp. `nearTick` (the FIFO read
 * time) picks the run (the last one that started before it) and the wrap. With
 * one sync point in the run the nominal period is used. `null` if there is no
 * clock.
 */
export function sensorTimestampToTick(
  clock: SensorClock,
  sensorTimestamp: number,
  nearTick: number,
): number | null {
  const ticksPerSensor = clock.sensorTickPeriodNs / NS_PER_TICK;
  if (!(ticksPerSensor > 0)) {
    return null;
  }
  let run = clock.runs[0];
  for (const candidate of clock.runs) {
    const start = candidate.points[0];
    if (start && start.tick <= nearTick) {
      run = candidate;
    }
  }
  const points = run?.points ?? [];
  const first = points[0];
  if (!first) {
    return null;
  }
  // Pick the wrap that lands nearest to `nearTick`.
  const predicted = first.sensorTimestamp + (nearTick - first.tick) / ticksPerSensor;
  const k = Math.round((predicted - sensorTimestamp) / U32);
  const unwrapped = sensorTimestamp + k * U32;
  if (points.length < 2) {
    return first.tick + (unwrapped - first.sensorTimestamp) * ticksPerSensor;
  }
  const i = segmentIndex(
    points.length,
    upperBoundBy(points, unwrapped, (p) => p.sensorTimestamp),
  );
  const a = points[i - 1];
  const b = points[i];
  if (!a || !b) {
    return null;
  }
  return (
    a.tick +
    ((unwrapped - a.sensorTimestamp) * (b.tick - a.tick)) / (b.sensorTimestamp - a.sensorTimestamp)
  );
}
