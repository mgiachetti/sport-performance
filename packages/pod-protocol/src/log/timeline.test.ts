import { describe, expect, it } from 'vitest';

import { keysFor, TEST_DEVICE_ID, syntheticSession, writeSegment } from '../testing/log-samples.js';
import { GPS_EPOCH_UNIX_MS, RTC_TICK_HZ } from './constants.js';
import { decodeLog, type NandPageRead } from './decoder.js';
import type { SensorSyncRecord, TimeAnchorRecord } from './records.js';
import {
  buildSensorClock,
  buildTimeBase,
  gnssMsToTick,
  gnssMsToUnixMs,
  sensorTimestampToTick,
  tickToGnssMs,
  tickUncertaintyMs,
  unixMsToGnssMs,
} from './timeline.js';

const START_TICK = 1_000_000;
const START_GNSS_MS = 1_446_000_000_000;

function anchor(
  tick: number,
  gnssTimeMs: number,
  source: TimeAnchorRecord['source'] = 'gnss_pps',
  uncertaintyUs: number | null = 1,
): TimeAnchorRecord {
  return {
    type: 'time_anchor',
    tick,
    source,
    subTickNs: 0,
    gnssTimeMs,
    uncertaintyUs,
    gpsUtcOffsetS: 18,
  };
}

function decodeSession(options: Parameters<typeof syntheticSession>[0]) {
  const pages = writeSegment(syntheticSession(options));
  const reads: NandPageRead[] = pages.map((data, i) => ({ physicalPage: i, data }));
  const decoded = decodeLog({ pages: reads, deviceId: TEST_DEVICE_ID, keyForEpoch: keysFor(2) });
  const base = decoded.timeBases[0];
  const segment = decoded.segments[0];
  if (!base || !segment) throw new Error('nothing decoded');
  return { base, segment };
}

describe('time base', () => {
  it('follows the crystal drift between PPS anchors (+18 ppm)', () => {
    const { base, segment } = decodeSession({ durationS: 120, rtcDriftPpm: 18 });
    expect(base.source).toBe('gnss_pps');
    // The dock anchor at the start falls outside the PPS run: kept.
    expect(base.points[0]?.source).toBe('dock');
    // Every PVT lands on its GPS time within 0,1 ms through its receipt tick (−50 ms latency).
    for (const pvt of segment.streams.pvt) {
      const t = tickToGnssMs(base, pvt.tick);
      expect(Math.abs((t ?? 0) - 50 - pvt.gnssTimeMs)).toBeLessThan(0.1);
    }
  });

  it('places what was recorded before the first fix backwards from the anchors', () => {
    // No dock anchor, fix after 30 s: the first 30 s are extrapolated back.
    const { base, segment } = decodeSession({
      durationS: 90,
      rtcDriftPpm: -15,
      firstFixS: 30,
      dockAnchorAtStart: false,
    });
    expect(base.points[0]?.source).toBe('gnss_pps');
    const start = segment.streams.markers.find((m) => m.kind === 'recording_start');
    if (!start) throw new Error('no start marker');
    expect(Math.abs((tickToGnssMs(base, start.tick) ?? 0) - START_GNSS_MS)).toBeLessThan(0.1);
    // Uncertainty there grows with the distance to the first anchor (30 s × 20 ppm ≈ 0,6 ms).
    expect(tickUncertaintyMs(base, start.tick)).toBeCloseTo(0.6, 1);
  });

  it('indoors (no fix): the dock anchors give absolute time', () => {
    const one = decodeSession({ durationS: 30, firstFixS: null, rtcDriftPpm: 10 });
    expect(one.base.source).toBe('dock');
    expect(one.base.points).toHaveLength(1);
    // One anchor: nominal rate, off by the dock's 12 ms and 10 ppm.
    const end = one.segment.tickRange?.last ?? 0;
    expect(tickToGnssMs(one.base, end)).toBeCloseTo(START_GNSS_MS + 12 + 30_000 * (1 + 10e-6), 0);

    // Back in the dock in the same boot: two anchors fit the slope.
    const two = decodeSession({
      durationS: 30,
      firstFixS: null,
      rtcDriftPpm: 10,
      dockAnchorAtEnd: true,
    });
    expect(two.base.points.map((p) => p.source)).toEqual(['dock', 'dock']);
    const stop = two.segment.streams.markers.find((m) => m.kind === 'recording_stop');
    expect(tickToGnssMs(two.base, stop?.tick ?? 0)).toBeCloseTo(START_GNSS_MS + 30_000 - 7, 0);
  });

  it('drops worse anchors inside a run of better ones and rejects outliers', () => {
    const anchors = [
      anchor(START_TICK, START_GNSS_MS),
      anchor(START_TICK + RTC_TICK_HZ, START_GNSS_MS + 1000),
      anchor(START_TICK + RTC_TICK_HZ * 1.5, START_GNSS_MS + 1530, 'dock', 50_000),
      anchor(START_TICK + RTC_TICK_HZ * 2, START_GNSS_MS + 2000),
      // A PPS anchor one second off (a wrong second label): rejected.
      anchor(START_TICK + RTC_TICK_HZ * 3, START_GNSS_MS + 4000),
      anchor(START_TICK + RTC_TICK_HZ * 4, START_GNSS_MS + 4000),
    ];
    const base = buildTimeBase(1, anchors);
    expect(base.points.map((p) => p.gnssTimeMs - START_GNSS_MS)).toEqual([0, 1000, 2000, 4000]);
    expect(base.rejected.map((r) => [r.source, r.reason])).toEqual([
      ['dock', 'covered_by_better_source'],
      ['gnss_pps', 'rate_out_of_range'],
    ]);
  });

  it('one bad first anchor (PPS 5 s off) does not shift the boot: 600 good ones outvote it', () => {
    const anchors = [
      anchor(START_TICK, START_GNSS_MS + 5_000),
      ...Array.from({ length: 600 }, (_, i) =>
        anchor(START_TICK + (i + 1) * RTC_TICK_HZ, START_GNSS_MS + (i + 1) * 1000),
      ),
    ];
    const base = buildTimeBase(1, anchors);
    expect(base.points).toHaveLength(600);
    expect(base.rejected).toMatchObject([
      { gnssTimeMs: START_GNSS_MS + 5_000, reason: 'rate_out_of_range' },
    ]);
    // The start of the boot is placed back from the good anchors.
    expect(tickToGnssMs(base, START_TICK)).toBeCloseTo(START_GNSS_MS, 3);
  });

  it('a short burst of consistent bad anchors does not outvote a long good tail', () => {
    const good = (s: number) => anchor(START_TICK + s * RTC_TICK_HZ, START_GNSS_MS + s * 1000);
    const anchors = [
      ...Array.from({ length: 20 }, (_, s) => good(s)),
      // Three anchors one second ahead, consistent among themselves.
      ...[20, 21, 22].map((s) =>
        anchor(START_TICK + s * RTC_TICK_HZ, START_GNSS_MS + (s + 1) * 1000),
      ),
      ...Array.from({ length: 10 }, (_, i) => good(23 + i)),
    ];
    const base = buildTimeBase(1, anchors);
    expect(base.points).toHaveLength(30);
    expect(base.rejected.map((r) => (r.tick - START_TICK) / RTC_TICK_HZ)).toEqual([20, 21, 22]);
  });

  it('a better anchor replaces a worse one that disagrees with it', () => {
    const base = buildTimeBase(1, [
      anchor(START_TICK, START_GNSS_MS + 900, 'dock', 50_000),
      anchor(START_TICK + RTC_TICK_HZ * 10, START_GNSS_MS + 10_000),
    ]);
    expect(base.points.map((p) => p.source)).toEqual(['gnss_pps']);
    expect(base.rejected).toMatchObject([{ source: 'dock', reason: 'rate_out_of_range' }]);
  });

  it('without anchors there is no absolute time', () => {
    const base = buildTimeBase(1, []);
    expect(base.source).toBe('none');
    expect(tickToGnssMs(base, 10)).toBeNull();
    expect(gnssMsToTick(base, 10)).toBeNull();
    expect(tickUncertaintyMs(base, 10)).toBeNull();
  });

  it('gnssMsToTick inverts tickToGnssMs and the mapping is monotonic', () => {
    const { base } = decodeSession({ durationS: 20, rtcDriftPpm: 7 });
    let previous = Number.NEGATIVE_INFINITY;
    for (let tick = START_TICK - 50_000; tick < START_TICK + 21 * RTC_TICK_HZ; tick += 3_333) {
      const ms = tickToGnssMs(base, tick) ?? 0;
      expect(ms).toBeGreaterThan(previous);
      previous = ms;
      expect(gnssMsToTick(base, ms)).toBeCloseTo(tick, 1);
    }
  });

  it('converts GPS time to UTC with the leap seconds', () => {
    expect(gnssMsToUnixMs(0, 0)).toBe(GPS_EPOCH_UNIX_MS);
    expect(gnssMsToUnixMs(1_446_000_000_000)).toBe(1_446_000_000_000 + GPS_EPOCH_UNIX_MS - 18_000);
    expect(unixMsToGnssMs(gnssMsToUnixMs(123_456, 18), 18)).toBe(123_456);
  });
});

describe('sensor clock', () => {
  const sync = (tick: number, sensorTimestamp: number): SensorSyncRecord => ({
    type: 'sensor_sync',
    tick,
    sensor: 'lsm6dsv320x',
    subTickNs: 0,
    sensorTimestamp,
  });

  it('unwraps the 32-bit sensor timestamp', () => {
    const perSecond = 1e9 / 21_750;
    const t0 = 0xffff_ffff - Math.round(perSecond * 1.5);
    const clock = buildSensorClock(
      'lsm6dsv320x',
      [
        sync(0, t0),
        sync(RTC_TICK_HZ, (t0 + Math.round(perSecond)) % 0x1_0000_0000),
        sync(2 * RTC_TICK_HZ, (t0 + Math.round(2 * perSecond)) % 0x1_0000_0000),
      ],
      21_750,
    );
    expect(clock.runs).toHaveLength(1);
    expect(clock.runs[0]?.points[2]?.sensorTimestamp).toBeGreaterThan(0xffff_ffff);
    const wrapped = (t0 + Math.round(1.75 * perSecond)) % 0x1_0000_0000;
    expect(sensorTimestampToTick(clock, wrapped, 1.75 * RTC_TICK_HZ)).toBeCloseTo(
      1.75 * RTC_TICK_HZ,
      0,
    );
  });

  it('a sensor reset mid-boot starts a new run instead of being taken for a wrap', () => {
    const perSecond = 1e9 / 21_750;
    const clock = buildSensorClock(
      'lsm6dsv320x',
      [
        sync(0, 5_000_000),
        sync(RTC_TICK_HZ, 5_000_000 + Math.round(perSecond)),
        // Reset: the counter restarts near 0.
        sync(2 * RTC_TICK_HZ, 1_000),
        sync(3 * RTC_TICK_HZ, 1_000 + Math.round(perSecond)),
      ],
      21_750,
    );
    expect(clock.runs.map((r) => r.points.length)).toEqual([2, 2]);
    // After the reset, timestamps map through the new run.
    expect(
      sensorTimestampToTick(clock, 1_000 + Math.round(0.5 * perSecond), 2.6 * RTC_TICK_HZ),
    ).toBeCloseTo(2.5 * RTC_TICK_HZ, 0);
    // Before it, through the old one.
    expect(
      sensorTimestampToTick(clock, 5_000_000 + Math.round(0.5 * perSecond), 0.6 * RTC_TICK_HZ),
    ).toBeCloseTo(0.5 * RTC_TICK_HZ, 0);
  });

  it('a sensor period of 0 gives no clock instead of dividing by zero', () => {
    const clock = buildSensorClock('lsm6dsv320x', [sync(0, 1), sync(RTC_TICK_HZ, 2)], 0);
    expect(clock.runs).toEqual([]);
    expect(sensorTimestampToTick(clock, 1, 0)).toBeNull();
  });

  it('IMU batches are timed from the sensor clock across the wrap, gaps from timestamps', () => {
    const { segment } = decodeSession({
      durationS: 10,
      imuDriftPpm: 300,
      imuStartTimestamp: 0xffff_ffff - 100_000,
    });
    const imu = segment.streams.imu.filter((b) => b.channel === 'accel_gyro');
    expect(imu.every((b) => b.timeSource === 'sensor_sync')).toBe(true);
    // From the first fix on, each batch spans 240 ms (25 samples at 100 Hz, last at −10 ms).
    for (const batch of imu.slice(8)) {
      expect((batch.lastSampleTick - batch.firstSampleTick) / RTC_TICK_HZ).toBeCloseTo(0.24, 3);
      expect((batch.tick - batch.lastSampleTick) / RTC_TICK_HZ).toBeCloseTo(0.01, 3);
    }
    expect(segment.gaps).toEqual([]);
  });
});
