import {
  ANCHOR_MAX_RATE_ERROR_PPM,
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
 * so it is monotonic, follows the crystal drift and places what was recorded
 * before the first fix backwards from the anchors.
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

export type RejectedAnchorReason = 'covered_by_better_source' | 'rate_out_of_range';

export interface TimeBase {
  bootCounter: number;
  /** Kept anchors, sorted by tick. */
  points: TimeAnchorPoint[];
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
 * Builds the time base of one boot from its anchors:
 * 1. better sources first: an anchor of a lower-priority source between two
 *    kept better anchors less than 60 s apart is dropped;
 * 2. global consensus: the kept anchors are the **largest chain** in tick
 *    order in which every consecutive pair is consistent (rate within 500 ppm
 *    of nominal, beyond both uncertainties), found by dynamic programming over
 *    all anchors; between chains of the same length, the one with the better
 *    sources wins. Bad anchors, however many, early or periodic, lose to the
 *    good ones as long as the good ones are more; the rest are rejected.
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

  // Longest consistent chain: count[j] / prioritySum[j] of the best chain ending at j.
  const n = kept.length;
  const count = new Int32Array(n);
  const prioritySum = new Float64Array(n);
  const previous = new Int32Array(n).fill(-1);
  let bestEnd = -1;
  for (let j = 0; j < n; j += 1) {
    const pj = kept[j];
    if (!pj) {
      continue;
    }
    const priorityJ = SOURCE_PRIORITY[pj.source];
    count[j] = 1;
    prioritySum[j] = priorityJ;
    for (let i = j - 1; i >= 0; i -= 1) {
      // A chain ending at i has at most i + 1 anchors: nothing earlier can tie.
      if ((count[j] ?? 0) > i + 2) {
        break;
      }
      const pi = kept[i];
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
  const inChain = new Set<number>();
  for (let k = bestEnd; k >= 0; k = previous[k] ?? -1) {
    inChain.add(k);
  }
  const points: TimeAnchorPoint[] = [];
  kept.forEach((p, k) => {
    if (inChain.has(k)) {
      points.push(p);
    } else {
      rejected.push({ ...p, reason: 'rate_out_of_range' });
    }
  });

  const best = points.reduce<TimeAnchorSource | 'none'>(
    (acc, p) =>
      acc === 'none' || SOURCE_PRIORITY[p.source] > SOURCE_PRIORITY[acc] ? p.source : acc,
    'none',
  );
  const offsets = anchors.map((a) => a.gpsUtcOffsetS).filter((v): v is number => v !== null);
  return {
    bootCounter,
    points,
    rejected: rejected.sort((a, b) => a.tick - b.tick),
    source: best,
    gpsUtcOffsetS: offsets.at(-1) ?? DEFAULT_GPS_UTC_OFFSET_S,
  };
}

function segmentFor(base: TimeBase, tick: number): [TimeAnchorPoint, TimeAnchorPoint] | null {
  const { points } = base;
  if (points.length < 2) {
    return null;
  }
  const i = segmentIndex(points.length, upperBound(points, tick));
  const a = points[i - 1];
  const b = points[i];
  return a && b ? [a, b] : null;
}

/** GPS time (ms) of a fractional RTC tick, or `null` if the boot has no anchor. */
export function tickToGnssMs(base: TimeBase, tick: number): number | null {
  const first = base.points[0];
  if (!first) {
    return null;
  }
  const pair = segmentFor(base, tick);
  if (!pair) {
    return first.gnssTimeMs + (tick - first.tick) * MS_PER_TICK;
  }
  const [a, b] = pair;
  return a.gnssTimeMs + ((tick - a.tick) * (b.gnssTimeMs - a.gnssTimeMs)) / (b.tick - a.tick);
}

/** Inverse of `tickToGnssMs`. */
export function gnssMsToTick(base: TimeBase, gnssTimeMs: number): number | null {
  const { points } = base;
  const first = points[0];
  if (!first) {
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
  const i = upperBound(base.points, tick);
  let best: number | null = null;
  for (const point of [base.points[i - 1], base.points[i]]) {
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
