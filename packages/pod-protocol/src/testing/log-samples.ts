import { fromHex } from '../bytes.js';
import { deriveStorageKey } from '../crypto.js';
import { RTC_TICK_HZ, W25N04KV, type NandGeometry } from '../log/constants.js';
import type { NandPageRead } from '../log/decoder.js';
import type { LogRecord } from '../log/records.js';
import { LogWriter } from '../log/writer.js';

/** Test-only helpers for the NAND log: fixed keys, a synthetic session and a NAND simulator. */

export const TEST_MASTER_KEY = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
);
export const TEST_DEVICE_ID = fromHex('8a1f3c5e7d902b46');
export const OTHER_DEVICE_ID = fromHex('0102030405060708');

export function testStorageKey(epoch: number, deviceId = TEST_DEVICE_ID): Uint8Array {
  return deriveStorageKey({ masterKey: TEST_MASTER_KEY, deviceId, epoch });
}

export function keysFor(...epochs: number[]): (epoch: number) => Uint8Array | undefined {
  const keys = new Map(epochs.map((e) => [e, testStorageKey(e)]));
  return (epoch) => keys.get(epoch);
}

/** Deterministic pseudo-random bytes (LCG), for raw blobs and IMU noise. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

export interface SyntheticSessionOptions {
  /** Seconds of recording. */
  durationS: number;
  /** RTC drift of this pod's crystal (ppm, + = fast). */
  rtcDriftPpm?: number;
  /** IMU timestamp clock error (ppm). */
  imuDriftPpm?: number;
  /** Seconds after the start of the first GNSS fix (`null`: never, indoors). */
  firstFixS?: number | null;
  /** RTC ticks at the start of the recording (time since boot). */
  startTick?: number;
  /** GPS time (ms) at the start. */
  startGnssMs?: number;
  /** Initial IMU sensor timestamp (to cross the 32-bit wrap). */
  imuStartTimestamp?: number;
  rawGnss?: boolean;
  /** Dock anchor at the start (pod leaves the dock). */
  dockAnchorAtStart?: boolean;
  /** Dock anchor at the end (pod back in the dock, same boot). */
  dockAnchorAtEnd?: boolean;
}

export const IMU_TICK_PERIOD_NS = 21_750;

/**
 * Records of a synthetic recording: versions and config, a dock anchor, PPS
 * anchors with sensor syncs from the first fix, PVT at 10 Hz, IMU (6 axes and
 * high-g) at 100 Hz in 4 FIFO reads per second, barometer at 50 Hz, a LoRa TX
 * every 2 s, health every 60 s and the wear markers.
 */
export function syntheticSession(options: SyntheticSessionOptions): LogRecord[] {
  const drift = 1 + (options.rtcDriftPpm ?? 0) / 1e6;
  const imuDrift = 1 + (options.imuDriftPpm ?? 0) / 1e6;
  const startTick = options.startTick ?? 1_000_000;
  const startGnssMs = options.startGnssMs ?? 1_446_000_000_000;
  const firstFix = options.firstFixS === undefined ? 1 : options.firstFixS;
  const imuStart = options.imuStartTimestamp ?? 1_000;
  const rnd = lcg(7);
  // True time t (s since the start of the recording) → tick (fractional).
  const tickAt = (t: number): number => startTick + t * RTC_TICK_HZ * drift;
  const sensorAt = (t: number): number =>
    (imuStart + Math.round(((t * 1e9) / IMU_TICK_PERIOD_NS) * imuDrift)) % 0x1_0000_0000;
  const subTick = (exact: number): number =>
    Math.min(30_517, Math.round((exact - Math.floor(exact)) * (1e9 / RTC_TICK_HZ)));

  const timed: { t: number; order: number; record: LogRecord }[] = [];
  const at = (t: number, record: LogRecord, order = 5): void => {
    timed.push({ t, order, record });
  };

  at(
    0,
    {
      type: 'firmware_info',
      tick: Math.floor(tickAt(0)),
      firmwareVersion: { major: 0, minor: 3, patch: 1 },
      firmwareBuildId: 0x87c2b9ec,
      hardwareRevision: 0,
      algorithmVersion: 1,
      radioProtocolVersion: 1,
      logFormatVersion: 1,
      gnssFirmware: 'LC29HAANR11A03S',
    },
    0,
  );
  at(
    0,
    {
      type: 'config_applied',
      tick: Math.floor(tickAt(0)),
      configVersion: 12,
      configHash: fromHex('5ca1ab1e0ddba11c'),
      gnssPvtRateHz: 10,
      gnssRawRateHz: options.rawGnss ? 1 : 0,
      gnssConstellations: ['gps', 'galileo', 'beidou', 'qzss'],
      gnssBands: ['l1', 'l5'],
    },
    1,
  );
  at(
    0,
    {
      type: 'segment_marker',
      tick: Math.floor(tickAt(0)),
      kind: 'recording_start',
      reason: 'undocked',
    },
    2,
  );
  if (options.dockAnchorAtStart ?? true) {
    const exact = tickAt(0);
    at(
      0,
      {
        type: 'time_anchor',
        tick: Math.floor(exact),
        source: 'dock',
        subTickNs: subTick(exact),
        // The dock's network time is 12 ms off.
        gnssTimeMs: startGnssMs + 12,
        uncertaintyUs: 50_000,
        gpsUtcOffsetS: 18,
      },
      3,
    );
  }
  at(0.4, { type: 'segment_marker', tick: Math.floor(tickAt(0.4)), kind: 'vest_on' });
  at(0.6, { type: 'segment_marker', tick: Math.floor(tickAt(0.6)), kind: 'motion_start' });

  for (let s = 0; s < options.durationS; s += 1) {
    // PPS anchors and IMU syncs from the first fix.
    if (firstFix !== null && s >= firstFix) {
      const exact = tickAt(s);
      at(s, {
        type: 'time_anchor',
        tick: Math.floor(exact),
        source: 'gnss_pps',
        subTickNs: subTick(exact),
        gnssTimeMs: startGnssMs + s * 1000,
        uncertaintyUs: 1,
        gpsUtcOffsetS: 18,
      });
      at(s, {
        type: 'sensor_sync',
        tick: Math.floor(exact),
        sensor: 'lsm6dsv320x',
        subTickNs: subTick(exact),
        sensorTimestamp: sensorAt(s),
      });
    }
    if (s % 2 === 0) {
      const t = s + 0.3;
      at(t, {
        type: 'radio_tx',
        tick: Math.floor(tickAt(t)),
        frameNumber: s / 2,
        durationUs: 102_656,
        txPowerDbm: 14,
        messageTypeByte: 0x11,
      });
    }
    if (s % 60 === 0) {
      at(s + 0.5, {
        type: 'health',
        tick: Math.floor(tickAt(s + 0.5)),
        batteryPct: 87 - Math.floor(s / 600),
        batteryMv: 3_910,
        batteryTempCentiC: 2_850,
        mcuTempCentiC: 3_120,
        chargeCyclesN: 41,
        badBlocksN: 3,
        freeBlocksN: 3_900,
        eccCorrectedN: 0,
      });
    }
    if (options.rawGnss && firstFix !== null && s >= firstFix) {
      at(s + 0.08, {
        type: 'gnss_raw',
        tick: Math.floor(tickAt(s + 0.08)),
        format: 'rtcm3_msm7',
        gnssTimeMs: startGnssMs + s * 1000,
        data: Uint8Array.from({ length: 1_900 + (s % 7) * 30 }, (_, i) =>
          i === 0 ? 0xd3 : rnd() & 0xff,
        ),
      });
    }
    for (let k = 0; k < 10; k += 1) {
      const t = s + k / 10;
      if (firstFix !== null && t >= firstFix) {
        const speed = 3_000 + ((s * 10 + k) % 40) * 100;
        at(t + 0.05, {
          type: 'gnss_pvt',
          tick: Math.floor(tickAt(t + 0.05)),
          gnssTimeMs: startGnssMs + Math.round(t * 1000),
          latE7: -345_123_456 + Math.round(t * 270),
          lonE7: -585_123_456 + Math.round(t * 50),
          heightEllipsoidMm: 21_300,
          velNorthMmS: speed,
          velEastMmS: -400,
          velDownMmS: 10,
          groundSpeedMmS: speed + 27,
          headingCentiDeg: 35_200,
          hAccMm: 1_400,
          vAccMm: 2_100,
          speedAccMmS: 120,
          fixQuality: 'fix_3d',
          satellitesN: 24,
        });
      }
    }
    for (let b = 0; b < 4; b += 1) {
      // FIFO read at the end of each 250 ms.
      const readT = s + (b + 1) / 4;
      const firstT = s + b / 4;
      const lastT = readT - 0.01;
      for (const channel of ['accel_gyro', 'high_g'] as const) {
        at(readT, {
          type: 'imu_batch',
          tick: Math.floor(tickAt(readT)),
          sensor: 'lsm6dsv320x',
          channel,
          fifoOverrun: false,
          impactBurst: false,
          accelRangeG: channel === 'accel_gyro' ? 16 : 320,
          gyroRangeDps: channel === 'accel_gyro' ? 2_000 : 0,
          odrMilliHz: 100_000,
          sensorTickPeriodNs: IMU_TICK_PERIOD_NS,
          firstSensorTimestamp: sensorAt(firstT),
          lastSensorTimestamp: sensorAt(lastT),
          samples: Array.from({ length: 25 }, () =>
            Array.from(
              { length: channel === 'accel_gyro' ? 6 : 3 },
              () => ((rnd() >>> 16) & 0x0fff) - 0x0800,
            ),
          ),
        });
      }
    }
    for (let b = 0; b < 2; b += 1) {
      const firstT = s + b / 2;
      at(firstT + 0.5, {
        type: 'baro_batch',
        tick: Math.floor(tickAt(firstT)),
        sensor: 'bmp581',
        odrMilliHz: 50_000,
        lastSampleDeltaTicks: Math.round(0.48 * RTC_TICK_HZ * drift),
        samples: Array.from({ length: 25 }, (_, i) => ({
          pressureCentiPa: 10_132_500 - s * 3 - i,
          temperatureCentiC: 2_310,
        })),
      });
    }
  }
  const end = options.durationS;
  at(
    end - 0.2,
    { type: 'segment_marker', tick: Math.floor(tickAt(end - 0.2)), kind: 'motion_stop' },
    6,
  );
  at(
    end - 0.1,
    { type: 'segment_marker', tick: Math.floor(tickAt(end - 0.1)), kind: 'vest_off' },
    6,
  );
  if (options.dockAnchorAtEnd) {
    const exact = tickAt(end);
    at(
      end,
      {
        type: 'time_anchor',
        tick: Math.floor(exact),
        source: 'dock',
        subTickNs: subTick(exact),
        gnssTimeMs: startGnssMs + end * 1000 - 7,
        uncertaintyUs: 50_000,
        gpsUtcOffsetS: 18,
      },
      7,
    );
  }
  at(
    end,
    {
      type: 'segment_marker',
      tick: Math.floor(tickAt(end)),
      kind: 'recording_stop',
      reason: 'docked',
    },
    8,
  );
  return timed.sort((a, b) => a.t - b.t || a.order - b.order).map((x) => x.record);
}

/** Writes records through a `LogWriter` and closes the segment. */
export function writeSegment(
  records: readonly LogRecord[],
  options: {
    bootCounter?: number;
    segmentId?: number;
    firstPageSeq?: number;
    keyEpoch?: number;
    deviceId?: Uint8Array;
    /** Rotate to this epoch before record index `at`. */
    rotate?: { at: number; epoch: number };
  } = {},
): Uint8Array[] {
  const epoch = options.keyEpoch ?? 2;
  const deviceId = options.deviceId ?? TEST_DEVICE_ID;
  const writer = new LogWriter({
    deviceId,
    bootCounter: options.bootCounter ?? 70_000,
    segmentId: options.segmentId ?? 5,
    firstPageSeq: options.firstPageSeq ?? 4_096,
    keyEpoch: epoch,
    storageKey: testStorageKey(epoch, deviceId),
  });
  const pages: Uint8Array[] = [];
  records.forEach((record, i) => {
    if (options.rotate?.at === i) {
      const { epoch: next } = options.rotate;
      writer.rotateKey(next, testStorageKey(next, deviceId));
    }
    pages.push(...writer.append(record));
  });
  pages.push(...writer.close());
  return pages;
}

/**
 * NAND simulator: segments start on an erased block, bad blocks are skipped,
 * pages are programmed in order. Pages not programmed read erased.
 */
export class NandSimulator {
  readonly pages = new Map<number, NandPageRead>();
  readonly badBlocks = new Set<number>();

  constructor(readonly geometry: NandGeometry = { ...W25N04KV, blocks: 32 }) {}

  private blockIsErased(block: number): boolean {
    for (let p = 0; p < this.geometry.pagesPerBlock; p += 1) {
      if (this.pages.has(block * this.geometry.pagesPerBlock + p)) {
        return false;
      }
    }
    return true;
  }

  /** Programs a segment from the first erased good block at or after `fromBlock`; returns its physical pages. */
  writeSegment(pages: readonly Uint8Array[], fromBlock = this.geometry.reservedBlocks): number[] {
    const { pagesPerBlock, blocks } = this.geometry;
    let block = fromBlock;
    const nextBlock = (): void => {
      while (block < blocks && (this.badBlocks.has(block) || !this.blockIsErased(block))) {
        block += 1;
      }
      if (block >= blocks) {
        throw new Error('memory full');
      }
    };
    nextBlock();
    let page = 0;
    const out: number[] = [];
    for (const data of pages) {
      if (page === pagesPerBlock) {
        block += 1;
        nextBlock();
        page = 0;
      }
      const physical = block * pagesPerBlock + page;
      this.pages.set(physical, { physicalPage: physical, data, ecc: 'ok' });
      out.push(physical);
      page += 1;
    }
    return out;
  }

  eraseBlock(block: number): void {
    for (let p = 0; p < this.geometry.pagesPerBlock; p += 1) {
      this.pages.delete(block * this.geometry.pagesPerBlock + p);
    }
  }

  /** Reads every page of the chip (erased pages as 0xFF). */
  dump(): NandPageRead[] {
    const total = this.geometry.blocks * this.geometry.pagesPerBlock;
    const erased = new Uint8Array(this.geometry.pageSizeB).fill(0xff);
    return Array.from(
      { length: total },
      (_, i) => this.pages.get(i) ?? { physicalPage: i, data: erased, ecc: 'ok' },
    );
  }
}
