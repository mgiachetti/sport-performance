import {
  intervalsContain,
  type AccelSeries,
  type HighGSeries,
  type PodSpeedSample,
  type TimeInterval,
} from '@sport-performance/domain';
import {
  gnssMsToUnixMs,
  tickToGnssMs,
  type DecodedSegment,
  type TimeBase,
} from '@sport-performance/pod-protocol';

/**
 * From a decoded segment of a player's trimmed `pod_raw` to what the
 * domain's metrics read (B-919): the 10 Hz epochs (Doppler speed, fix and
 * accuracy) and the IMU samples (accelerations in g, the high-g norm), in
 * UTC milliseconds and only inside the player's windows. The IMU is placed
 * by its FIFO timing through the boot's time base: without one, there is no
 * IMU (nothing can be placed in a session).
 */

export interface PodSessionSamples {
  speed: PodSpeedSample[];
  accel: { timeMs: number[]; xG: number[]; yG: number[]; zG: number[] };
  highG: { timeMs: number[]; normG: number[] };
}

/** Raw two's-complement LSB of a ±`rangeG` accelerometer, in g. */
function lsbToG(lsb: number, rangeG: number): number {
  return (lsb * rangeG) / 32768;
}

export function emptySamples(): PodSessionSamples {
  return {
    speed: [],
    accel: { timeMs: [], xG: [], yG: [], zG: [] },
    highG: { timeMs: [], normG: [] },
  };
}

/** Adds the segment's samples inside `windows` to `out`. */
export function addSegmentSamples(
  out: PodSessionSamples,
  segment: DecodedSegment,
  base: TimeBase | undefined,
  windows: readonly TimeInterval[],
): void {
  const offset = base?.gpsUtcOffsetS;
  for (const pvt of segment.streams.pvt) {
    const timeMs = gnssMsToUnixMs(pvt.gnssTimeMs, offset);
    if (!intervalsContain(windows, timeMs)) continue;
    out.speed.push({
      timeMs,
      speedMs: pvt.groundSpeedMmS === null ? null : pvt.groundSpeedMmS / 1000,
      fixQuality: pvt.fixQuality,
      horizontalAccuracyM: pvt.hAccMm === null ? null : pvt.hAccMm / 1000,
      speedAccuracyMs: pvt.speedAccMmS === null ? null : pvt.speedAccMmS / 1000,
    });
  }
  if (base === undefined) return;
  for (const batch of segment.streams.imu) {
    const n = batch.samples.length;
    if (n === 0) continue;
    const first = tickToGnssMs(base, batch.firstSampleTick);
    const last = tickToGnssMs(base, batch.lastSampleTick);
    if (first === null || last === null) continue;
    batch.samples.forEach((sample, k) => {
      const gnss = n === 1 ? first : first + ((last - first) * k) / (n - 1);
      const timeMs = gnssMsToUnixMs(gnss, offset);
      if (!intervalsContain(windows, timeMs)) return;
      const x = lsbToG(sample[0] ?? 0, batch.accelRangeG);
      const y = lsbToG(sample[1] ?? 0, batch.accelRangeG);
      const z = lsbToG(sample[2] ?? 0, batch.accelRangeG);
      if (batch.channel === 'accel_gyro') {
        out.accel.timeMs.push(timeMs);
        out.accel.xG.push(x);
        out.accel.yG.push(y);
        out.accel.zG.push(z);
      } else {
        out.highG.timeMs.push(timeMs);
        out.highG.normG.push(Math.sqrt(x * x + y * y + z * z));
      }
    });
  }
}

/** Sorts every series by time (several files or boots of a session may interleave). */
export function sortSamples(samples: PodSessionSamples): {
  speed: PodSpeedSample[];
  accel: AccelSeries | null;
  highG: HighGSeries | null;
} {
  const speed = [...samples.speed].sort((a, b) => a.timeMs - b.timeMs);
  const order = (times: readonly number[]) =>
    times.map((_, i) => i).sort((a, b) => (times[a] ?? 0) - (times[b] ?? 0));
  const pick = (values: readonly number[], idx: readonly number[]) =>
    idx.map((i) => values[i] ?? 0);
  const a = order(samples.accel.timeMs);
  const h = order(samples.highG.timeMs);
  return {
    speed,
    accel:
      a.length === 0
        ? null
        : {
            timeMs: pick(samples.accel.timeMs, a),
            xG: pick(samples.accel.xG, a),
            yG: pick(samples.accel.yG, a),
            zG: pick(samples.accel.zG, a),
          },
    highG:
      h.length === 0
        ? null
        : { timeMs: pick(samples.highG.timeMs, h), normG: pick(samples.highG.normG, h) },
  };
}
