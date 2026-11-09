import { LOG_PAGE_PAYLOAD_CAPACITY, POD_NAND, type NandGeometry } from './constants.js';
import { RECORD_HEADER_LENGTH, recordBodyLength, type KnownLogRecord } from './records.js';

/**
 * Size math of the log: how many pages and blocks a rate of record stream
 * takes, and how many sessions fit in a chip. docs/hardware/pod-f3.md estimates
 * the sensor data at ≈ 2,5 kB/s (≈ 4,5 kB/s with raw GNSS at 1 Hz); the format
 * adds record headers and timestamps (`profileStreamRateBps`). The chip defaults
 * to the one the pod v0 mounts (`POD_NAND`, the 2 Gbit W25N02KV).
 */

export function pagesForStreamBytes(streamBytes: number): number {
  return Math.ceil(streamBytes / LOG_PAGE_PAYLOAD_CAPACITY);
}

export function pagesPerHour(streamRateBps: number): number {
  return pagesForStreamBytes(streamRateBps * 3600);
}

/** Blocks a segment takes: segments start on a fresh block, so it rounds up. */
export function segmentBlocks(
  streamRateBps: number,
  durationS: number,
  geometry: NandGeometry = POD_NAND,
): number {
  return Math.ceil(pagesForStreamBytes(streamRateBps * durationS) / geometry.pagesPerBlock);
}

/** Blocks for log pages: all minus the index blocks and the bad-block budget. */
export function usableBlocks(geometry: NandGeometry = POD_NAND): number {
  return geometry.blocks - geometry.reservedBlocks - geometry.badBlockAllowance;
}

export function sessionsPerChip(input: {
  streamRateBps: number;
  sessionDurationS: number;
  geometry?: NandGeometry;
}): number {
  const geometry = input.geometry ?? POD_NAND;
  return Math.floor(
    usableBlocks(geometry) / segmentBlocks(input.streamRateBps, input.sessionDurationS, geometry),
  );
}

export function hoursPerChip(streamRateBps: number, geometry: NandGeometry = POD_NAND): number {
  return (usableBlocks(geometry) * geometry.pagesPerBlock) / pagesPerHour(streamRateBps);
}

/** What the pod logs per second (the defaults of ADR 0105/0106 and pod-f3.md). */
export interface StreamProfile {
  gnssPvtRateHz: number;
  /** 0 = raw off. */
  gnssRawRateHz: number;
  /** Raw observation bytes per epoch (≈ 30 satellites × 2 frequencies × 32 B). */
  gnssRawEpochB: number;
  imuOdrHz: number;
  highGOdrHz: number;
  /** FIFO reads per second (each channel is a batch). */
  imuBatchesPerS: number;
  baroOdrHz: number;
  baroBatchesPerS: number;
  timeAnchorsPerS: number;
  sensorSyncsPerS: number;
  radioTxPerS: number;
  healthPerS: number;
}

export const DEFAULT_STREAM_PROFILE: StreamProfile = {
  gnssPvtRateHz: 10,
  gnssRawRateHz: 0,
  gnssRawEpochB: 2000,
  imuOdrHz: 100,
  highGOdrHz: 100,
  imuBatchesPerS: 4,
  baroOdrHz: 50,
  baroBatchesPerS: 2,
  timeAnchorsPerS: 1,
  sensorSyncsPerS: 1,
  radioTxPerS: 0.5,
  healthPerS: 1 / 60,
};

export const RAW_GNSS_STREAM_PROFILE: StreamProfile = {
  ...DEFAULT_STREAM_PROFILE,
  gnssRawRateHz: 1,
};

function recordLength(record: KnownLogRecord): number {
  return RECORD_HEADER_LENGTH + recordBodyLength(record);
}

/** Stream bytes per second of a profile with the v1 record layouts. */
export function profileStreamRateBps(profile: StreamProfile): number {
  const imuSamplesPerBatch = profile.imuOdrHz / profile.imuBatchesPerS;
  const highGSamplesPerBatch = profile.highGOdrHz / profile.imuBatchesPerS;
  const baroSamplesPerBatch = profile.baroOdrHz / profile.baroBatchesPerS;
  const imu = (channel: 'accel_gyro' | 'high_g', samples: number): number =>
    recordLength({
      type: 'imu_batch',
      tick: 0,
      sensor: 'lsm6dsv320x',
      channel,
      fifoOverrun: false,
      impactBurst: false,
      accelRangeG: 16,
      gyroRangeDps: 0,
      odrMilliHz: 0,
      sensorTickPeriodNs: 0,
      firstSensorTimestamp: 0,
      lastSensorTimestamp: 0,
      samples: Array.from({ length: Math.ceil(samples) }, () => []),
    });
  const pvt = recordLength({
    type: 'gnss_pvt',
    tick: 0,
    gnssTimeMs: 0,
    latE7: 0,
    lonE7: 0,
    heightEllipsoidMm: 0,
    velNorthMmS: null,
    velEastMmS: null,
    velDownMmS: null,
    groundSpeedMmS: null,
    headingCentiDeg: null,
    hAccMm: null,
    vAccMm: null,
    speedAccMmS: null,
    fixQuality: 'fix_3d',
    satellitesN: 0,
  });
  const raw = recordLength({
    type: 'gnss_raw',
    tick: 0,
    format: 'rtcm3_msm7',
    gnssTimeMs: null,
    data: new Uint8Array(profile.gnssRawEpochB),
  });
  const baro = recordLength({
    type: 'baro_batch',
    tick: 0,
    sensor: 'bmp581',
    odrMilliHz: 0,
    lastSampleDeltaTicks: 0,
    samples: Array.from({ length: Math.ceil(baroSamplesPerBatch) }, () => ({
      pressureCentiPa: 0,
      temperatureCentiC: 0,
    })),
  });
  const anchor = recordLength({
    type: 'time_anchor',
    tick: 0,
    source: 'gnss_pps',
    subTickNs: 0,
    gnssTimeMs: 0,
    uncertaintyUs: null,
    gpsUtcOffsetS: null,
  });
  const sync = recordLength({
    type: 'sensor_sync',
    tick: 0,
    sensor: 'lsm6dsv320x',
    subTickNs: 0,
    sensorTimestamp: 0,
  });
  const tx = recordLength({
    type: 'radio_tx',
    tick: 0,
    frameNumber: 0,
    durationUs: 0,
    txPowerDbm: 0,
    messageTypeByte: 0,
  });
  const health = recordLength({
    type: 'health',
    tick: 0,
    batteryPct: null,
    batteryMv: null,
    batteryTempCentiC: null,
    mcuTempCentiC: null,
    chargeCyclesN: 0,
    badBlocksN: 0,
    freeBlocksN: 0,
    eccCorrectedN: 0,
  });
  return (
    pvt * profile.gnssPvtRateHz +
    raw * profile.gnssRawRateHz +
    imu('accel_gyro', imuSamplesPerBatch) * profile.imuBatchesPerS +
    imu('high_g', highGSamplesPerBatch) * profile.imuBatchesPerS +
    baro * profile.baroBatchesPerS +
    anchor * profile.timeAnchorsPerS +
    sync * profile.sensorSyncsPerS +
    tx * profile.radioTxPerS +
    health * profile.healthPerS
  );
}
