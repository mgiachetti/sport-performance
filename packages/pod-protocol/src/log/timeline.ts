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
 * 2. walking in tick order, an anchor that implies a rate farther than 500 ppm
 *    from nominal (beyond both uncertainties) from the previous kept one is
 *    rejected (the lower-priority one of the pair; on a tie, the later one).
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

  const points: TimeAnchorPoint[] = [];
  for (const point of kept) {
    let candidate: TimeAnchorPoint | null = point;
    while (candidate) {
      const previous = points.at(-1);
      if (!previous || rateConsistent(previous, candidate)) {
        points.push(candidate);
        candidate = null;
      } else if (SOURCE_PRIORITY[previous.source] < SOURCE_PRIORITY[candidate.source]) {
        points.pop();
        rejected.push({ ...previous, reason: 'rate_out_of_range' });
      } else {
        rejected.push({ ...candidate, reason: 'rate_out_of_range' });
        candidate = null;
      }
    }
  }

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

export interface SensorClock {
  sensor: SyncSensor;
  /** (unwrapped sensor timestamp, fractional RTC tick), sorted. */
  points: { sensorTimestamp: number; tick: number }[];
}

/** Correlates the sensor's own timestamp counter with the RTC from the `sensor_sync` records. */
export function buildSensorClock(
  sensor: SyncSensor,
  syncs: readonly SensorSyncRecord[],
): SensorClock {
  const points: SensorClock['points'] = [];
  let wraps = 0;
  let previous: number | null = null;
  for (const sync of syncs) {
    if (sync.sensor !== sensor) {
      continue;
    }
    if (previous !== null && sync.sensorTimestamp < previous) {
      wraps += 1;
    }
    previous = sync.sensorTimestamp;
    points.push({
      sensorTimestamp: sync.sensorTimestamp + wraps * U32,
      tick: sync.tick + sync.subTickNs / NS_PER_TICK,
    });
  }
  return { sensor, points };
}

/**
 * RTC tick of a (32-bit, wrapping) sensor timestamp. `nearTick` (the FIFO read
 * time) picks the wrap; `sensorTickPeriodNs` is used when there is only one
 * sync point. `null` if the clock has no sync point.
 */
export function sensorTimestampToTick(
  clock: SensorClock,
  sensorTimestamp: number,
  nearTick: number,
  sensorTickPeriodNs: number,
): number | null {
  const { points } = clock;
  const first = points[0];
  if (!first) {
    return null;
  }
  const ticksPerSensor = sensorTickPeriodNs / NS_PER_TICK;
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
