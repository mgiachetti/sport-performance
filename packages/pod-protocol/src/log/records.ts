import { asciiBytes, assertIntRange, assertUint, ByteReader, ByteWriter } from '../bytes.js';
import { fail } from '../errors.js';
import { FIX_QUALITIES, type FixQuality } from '../uplink.js';
import { NO_GNSS_TIME_MS, UNKNOWN_I16, UNKNOWN_U16, UNKNOWN_U32, UNKNOWN_U8 } from './constants.js';

/**
 * Records of the NAND log (TLV). Every record is
 *
 * ```
 * 0      type (u8)
 * 1..2   body length (u16)
 * 3..8   tick (u48): RTC counter (32,768 Hz on the LFXO) since the boot, when
 *        the record was produced (first sample of a batch, start of a TX…)
 * 9…     body
 * ```
 *
 * A decoder skips a type it does not know by its length, so new types are added
 * without a new format version. Type 0x00 and 0xFF never start a record (0xFF is
 * erased NAND); 0xE0–0xFE are for experiments and never ship in a release.
 */

export const RECORD_HEADER_LENGTH = 9;
export const MAX_RECORD_BODY_LENGTH = 0xffff;

export const RECORD_TYPES = {
  firmware_info: 0x01,
  config_applied: 0x02,
  gnss_pvt: 0x10,
  gnss_raw: 0x11,
  imu_batch: 0x20,
  baro_batch: 0x30,
  time_anchor: 0x40,
  sensor_sync: 0x41,
  segment_marker: 0x50,
  health: 0x60,
  radio_tx: 0x70,
  event: 0x71,
} as const;
export type RecordType = keyof typeof RECORD_TYPES;

export const EXPERIMENTAL_RECORD_TYPE_MIN = 0xe0;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Value 0 of every enumeration is "unknown / not set" and is invalid on encode. */
export const GNSS_RAW_FORMATS = ['rtcm3_msm7', 'rtcm3_msm4', 'quectel_raw'] as const;
export type GnssRawFormat = (typeof GNSS_RAW_FORMATS)[number];

export const IMU_SENSORS = ['lsm6dsv320x', 'icm42688p', 'adxl372'] as const;
export type ImuSensor = (typeof IMU_SENSORS)[number];

/** `accel_gyro`: 6-axis (accel ±2–16 g, gyro); `high_g`: 3-axis high-g accel (±32–320 g). */
export const IMU_CHANNELS = ['accel_gyro', 'high_g'] as const;
export type ImuChannel = (typeof IMU_CHANNELS)[number];

export const BARO_SENSORS = ['bmp581', 'dps368'] as const;
export type BaroSensor = (typeof BARO_SENSORS)[number];

export const TIME_ANCHOR_SOURCES = ['gnss_pps', 'beacon', 'dock'] as const;
export type TimeAnchorSource = (typeof TIME_ANCHOR_SOURCES)[number];

/** Clocks a `sensor_sync` correlates with the RTC. */
export const SYNC_SENSORS = ['lsm6dsv320x', 'icm42688p', 'adxl372'] as const;
export type SyncSensor = (typeof SYNC_SENSORS)[number];

export const SEGMENT_MARKER_KINDS = [
  'recording_start',
  'recording_stop',
  'vest_on',
  'vest_off',
  'motion_start',
  'motion_stop',
  'staff_session_open',
  'staff_session_close',
] as const;
export type SegmentMarkerKind = (typeof SEGMENT_MARKER_KINDS)[number];

export const RECORDING_START_REASONS = ['undocked', 'vest_on', 'motion', 'command'] as const;
export type RecordingStartReason = (typeof RECORDING_START_REASONS)[number];
export const RECORDING_STOP_REASONS = [
  'docked',
  'battery_low',
  'memory_full',
  'shutdown',
  'idle_timeout',
] as const;
export type RecordingStopReason = (typeof RECORDING_STOP_REASONS)[number];

export const EVENT_CODES = [
  'imu_fifo_overrun',
  'gnss_reset',
  'config_rejected',
  'nand_program_failed',
  'nand_erase_failed',
  'brownout',
  'watchdog',
] as const;
export type EventCode = (typeof EVENT_CODES)[number];

/** GNSS constellations bitmask of `config_applied`. */
export const GNSS_CONSTELLATIONS = [
  'gps',
  'glonass',
  'galileo',
  'beidou',
  'qzss',
  'navic',
] as const;
export type GnssConstellation = (typeof GNSS_CONSTELLATIONS)[number];
export const GNSS_BANDS = ['l1', 'l5'] as const;
export type GnssBand = (typeof GNSS_BANDS)[number];

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

interface RecordBase {
  /** RTC ticks since the boot (32,768 Hz). */
  tick: number;
}

export interface FirmwareInfoRecord extends RecordBase {
  type: 'firmware_info';
  firmwareVersion: { major: number; minor: number; patch: number };
  /** First 4 B of the git commit of the build (u32 LE). */
  firmwareBuildId: number;
  hardwareRevision: number;
  /** Version of the on-pod algorithms (live summary, wear detection). */
  algorithmVersion: number;
  radioProtocolVersion: number;
  logFormatVersion: number;
  /** Version string the GNSS module reports (ASCII, ≤ 64). */
  gnssFirmware: string;
}

export interface ConfigAppliedRecord extends RecordBase {
  type: 'config_applied';
  /** Full version of the club configuration (the radio carries it modulo 256). */
  configVersion: number;
  /** First 8 B of the SHA-256 of the configuration blob the pod applied. */
  configHash: Uint8Array;
  gnssPvtRateHz: number;
  /** 0 = raw output off. */
  gnssRawRateHz: number;
  gnssConstellations: GnssConstellation[];
  gnssBands: GnssBand[];
}

/** Navigation solution at 10 Hz (speed from Doppler). */
export interface GnssPvtRecord extends RecordBase {
  type: 'gnss_pvt';
  /** GPS time of the epoch, ms since 06/01/1980 (no leap seconds). */
  gnssTimeMs: number;
  /** WGS84, 1e-7 degrees. */
  latE7: number;
  lonE7: number;
  heightEllipsoidMm: number;
  /** Doppler velocity, NED; `null` = no data. Saturates at ±32 767. */
  velNorthMmS: number | null;
  velEastMmS: number | null;
  velDownMmS: number | null;
  groundSpeedMmS: number | null;
  headingCentiDeg: number | null;
  /** Accuracy estimates; `null` = unknown. Saturate at 65 534. */
  hAccMm: number | null;
  vAccMm: number | null;
  speedAccMmS: number | null;
  fixQuality: FixQuality;
  satellitesN: number;
}

/** Raw GNSS observations at 1 Hz, opaque (RTCM MSM7 frames or the vendor format). */
export interface GnssRawRecord extends RecordBase {
  type: 'gnss_raw';
  format: GnssRawFormat;
  /** GPS time of the epoch in ms, `null` if the pod could not tell. */
  gnssTimeMs: number | null;
  data: Uint8Array;
}

/**
 * One read of the IMU FIFO. Samples are evenly spaced between the first and
 * last sensor timestamps (the FIFO never skips a sample; an overrun is flagged).
 * Values are the raw two's-complement LSB of the sensor: full scale is
 * ±`accelRangeG` g and ±`gyroRangeDps` °/s.
 */
export interface ImuBatchRecord extends RecordBase {
  type: 'imu_batch';
  sensor: ImuSensor;
  channel: ImuChannel;
  fifoOverrun: boolean;
  impactBurst: boolean;
  accelRangeG: number;
  /** 0 on the `high_g` channel. */
  gyroRangeDps: number;
  odrMilliHz: number;
  /** Nominal period of the sensor timestamp counter (LSM6DSV: 21 750 ns). */
  sensorTickPeriodNs: number;
  firstSensorTimestamp: number;
  lastSensorTimestamp: number;
  /** `accel_gyro`: [ax, ay, az, gx, gy, gz] per sample; `high_g`: [ax, ay, az]. */
  samples: number[][];
}

export interface BaroSample {
  pressureCentiPa: number;
  temperatureCentiC: number;
}

/** Barometer batch sampled on the nRF clock: the record tick is the first sample. */
export interface BaroBatchRecord extends RecordBase {
  type: 'baro_batch';
  sensor: BaroSensor;
  odrMilliHz: number;
  /** Ticks from the first to the last sample. */
  lastSampleDeltaTicks: number;
  samples: BaroSample[];
}

/**
 * (RTC tick, GPS time) pair. The edge happened `subTickNs` after `tick`
 * (the PPS capture runs on a 16 MHz timer, finer than a tick).
 */
export interface TimeAnchorRecord extends RecordBase {
  type: 'time_anchor';
  source: TimeAnchorSource;
  subTickNs: number;
  gnssTimeMs: number;
  /** `null` = unknown. */
  uncertaintyUs: number | null;
  /** GPS − UTC the source reported, `null` = unknown. */
  gpsUtcOffsetS: number | null;
}

/** (RTC tick, sensor timestamp) pair, taken at each PPS: correlates the IMU clock. */
export interface SensorSyncRecord extends RecordBase {
  type: 'sensor_sync';
  sensor: SyncSensor;
  subTickNs: number;
  sensorTimestamp: number;
}

export type SegmentMarkerRecord = RecordBase & {
  type: 'segment_marker';
} & (
    | { kind: 'recording_start'; reason: RecordingStartReason }
    | { kind: 'recording_stop'; reason: RecordingStopReason }
    | { kind: 'vest_on' | 'vest_off' | 'motion_start' | 'motion_stop' }
    | {
        kind: 'staff_session_open' | 'staff_session_close';
        /** Session sequence of the beacon (u8). */
        sessionSeq: number;
        /** GPS seconds of the open / close the beacon announced. */
        transitionGnssS: number;
      }
  );

export interface HealthRecord extends RecordBase {
  type: 'health';
  batteryPct: number | null;
  batteryMv: number | null;
  batteryTempCentiC: number | null;
  mcuTempCentiC: number | null;
  chargeCyclesN: number;
  badBlocksN: number;
  freeBlocksN: number;
  /** ECC-corrected reads since boot (saturates). */
  eccCorrectedN: number;
}

/** A LoRa transmission (its window is flagged on the GNSS epochs it overlaps). */
export interface RadioTxRecord extends RecordBase {
  type: 'radio_tx';
  frameNumber: number;
  durationUs: number;
  txPowerDbm: number;
  /** Byte 0 of the radio frame (version and type). */
  messageTypeByte: number;
}

export interface EventRecord extends RecordBase {
  type: 'event';
  code: EventCode;
  value: number;
}

export interface UnknownRecord extends RecordBase {
  type: 'unknown';
  typeCode: number;
  body: Uint8Array;
}

export type KnownLogRecord =
  | FirmwareInfoRecord
  | ConfigAppliedRecord
  | GnssPvtRecord
  | GnssRawRecord
  | ImuBatchRecord
  | BaroBatchRecord
  | TimeAnchorRecord
  | SensorSyncRecord
  | SegmentMarkerRecord
  | HealthRecord
  | RadioTxRecord
  | EventRecord;

export type LogRecord = KnownLogRecord | UnknownRecord;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enumCode<T extends string>(name: string, values: readonly T[], value: T): number {
  const index = values.indexOf(value);
  if (index < 0) {
    fail('field_out_of_range', `${name}: unknown value ${value}`);
  }
  return index + 1;
}

function enumValue<T extends string>(name: string, values: readonly T[], code: number): T {
  const value = values[code - 1];
  if (value === undefined) {
    fail('malformed_record', `${name}: unknown code ${String(code)}`);
  }
  return value;
}

function bitmask<T extends string>(name: string, values: readonly T[], set: readonly T[]): number {
  let mask = 0;
  for (const item of set) {
    mask |= 1 << (enumCode(name, values, item) - 1);
  }
  return mask;
}

function fromBitmask<T extends string>(name: string, values: readonly T[], mask: number): T[] {
  if (mask >>> values.length !== 0) {
    fail('reserved_bits_set', `${name}: reserved bits set`);
  }
  return values.filter((_, i) => (mask & (1 << i)) !== 0);
}

function optU16(name: string, value: number | null, max = UNKNOWN_U16 - 1): number {
  if (value === null) {
    return UNKNOWN_U16;
  }
  assertIntRange(name, value, 0, max);
  return value;
}

function readOptU16(value: number): number | null {
  return value === UNKNOWN_U16 ? null : value;
}

function optI16(name: string, value: number | null): number {
  if (value === null) {
    return UNKNOWN_I16;
  }
  assertIntRange(name, value, UNKNOWN_I16 + 1, 0x7fff);
  return value;
}

function readOptI16(value: number): number | null {
  return value === UNKNOWN_I16 ? null : value;
}

/** Saturating clamp for accuracies and speeds coming from the receiver. */
export function saturate(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function imuAxes(channel: ImuChannel): number {
  return channel === 'accel_gyro' ? 6 : 3;
}

const IMU_FIXED_LENGTH = 25;
const BARO_FIXED_LENGTH = 11;
const BARO_SAMPLE_LENGTH = 5;
const GNSS_RAW_FIXED_LENGTH = 7;
const FIRMWARE_FIXED_LENGTH = 14;

/** Fixed body lengths; `null` = variable. */
const FIXED_BODY_LENGTH: Record<RecordType, number | null> = {
  firmware_info: null,
  config_applied: 16,
  gnss_pvt: 36,
  gnss_raw: null,
  imu_batch: null,
  baro_batch: null,
  time_anchor: 14,
  sensor_sync: 7,
  segment_marker: 6,
  health: 15,
  radio_tx: 8,
  event: 6,
};

export function recordBodyLength(record: KnownLogRecord): number {
  const fixed = FIXED_BODY_LENGTH[record.type];
  if (fixed !== null) {
    return fixed;
  }
  switch (record.type) {
    case 'firmware_info':
      return FIRMWARE_FIXED_LENGTH + record.gnssFirmware.length;
    case 'gnss_raw':
      return GNSS_RAW_FIXED_LENGTH + record.data.length;
    case 'imu_batch':
      return IMU_FIXED_LENGTH + record.samples.length * imuAxes(record.channel) * 2;
    case 'baro_batch':
      return BARO_FIXED_LENGTH + record.samples.length * BARO_SAMPLE_LENGTH;
    default:
      return fail('unknown_type', `no length for ${record.type}`);
  }
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function encodeBody(record: KnownLogRecord, w: ByteWriter): void {
  switch (record.type) {
    case 'firmware_info': {
      const { major, minor, patch } = record.firmwareVersion;
      assertUint('firmwareVersion.major', major, 8);
      assertUint('firmwareVersion.minor', minor, 8);
      assertUint('firmwareVersion.patch', patch, 16);
      assertUint('firmwareBuildId', record.firmwareBuildId, 32);
      assertUint('hardwareRevision', record.hardwareRevision, 8);
      assertUint('algorithmVersion', record.algorithmVersion, 16);
      assertUint('radioProtocolVersion', record.radioProtocolVersion, 8);
      assertUint('logFormatVersion', record.logFormatVersion, 8);
      if (record.gnssFirmware.length > 64) {
        fail('field_out_of_range', 'gnssFirmware must be ≤ 64 ASCII characters');
      }
      w.u8(major)
        .u8(minor)
        .u16(patch)
        .u32(record.firmwareBuildId)
        .u8(record.hardwareRevision)
        .u16(record.algorithmVersion)
        .u8(record.radioProtocolVersion)
        .u8(record.logFormatVersion)
        .u8(record.gnssFirmware.length)
        .raw(asciiBytes(record.gnssFirmware));
      return;
    }
    case 'config_applied':
      assertUint('configVersion', record.configVersion, 32);
      if (record.configHash.length !== 8) {
        fail('field_out_of_range', 'configHash must be 8 B');
      }
      assertUint('gnssPvtRateHz', record.gnssPvtRateHz, 8);
      assertUint('gnssRawRateHz', record.gnssRawRateHz, 8);
      w.u32(record.configVersion)
        .raw(record.configHash)
        .u8(record.gnssPvtRateHz)
        .u8(record.gnssRawRateHz)
        .u8(bitmask('gnssConstellations', GNSS_CONSTELLATIONS, record.gnssConstellations))
        .u8(bitmask('gnssBands', GNSS_BANDS, record.gnssBands));
      return;
    case 'gnss_pvt':
      assertUint('gnssTimeMs', record.gnssTimeMs, 48);
      if (record.gnssTimeMs === NO_GNSS_TIME_MS) {
        fail('field_out_of_range', 'a PVT always has a GNSS time');
      }
      assertIntRange('latE7', record.latE7, -900_000_000, 900_000_000);
      assertIntRange('lonE7', record.lonE7, -1_800_000_000, 1_800_000_000);
      assertIntRange('heightEllipsoidMm', record.heightEllipsoidMm, -0x8000_0000, 0x7fff_ffff);
      assertIntRange('satellitesN', record.satellitesN, 0, 0xff);
      w.u48(record.gnssTimeMs)
        .i32(record.latE7)
        .i32(record.lonE7)
        .i32(record.heightEllipsoidMm)
        .i16(optI16('velNorthMmS', record.velNorthMmS))
        .i16(optI16('velEastMmS', record.velEastMmS))
        .i16(optI16('velDownMmS', record.velDownMmS))
        .u16(optU16('groundSpeedMmS', record.groundSpeedMmS))
        .u16(optU16('headingCentiDeg', record.headingCentiDeg, 35_999))
        .u16(optU16('hAccMm', record.hAccMm))
        .u16(optU16('vAccMm', record.vAccMm))
        .u16(optU16('speedAccMmS', record.speedAccMmS))
        .u8(enumCode('fixQuality', FIX_QUALITIES, record.fixQuality) - 1)
        .u8(record.satellitesN);
      return;
    case 'gnss_raw':
      if (record.gnssTimeMs !== null) {
        assertIntRange('gnssTimeMs', record.gnssTimeMs, 0, NO_GNSS_TIME_MS - 1);
      }
      w.u8(enumCode('format', GNSS_RAW_FORMATS, record.format))
        .u48(record.gnssTimeMs ?? NO_GNSS_TIME_MS)
        .raw(record.data);
      return;
    case 'imu_batch': {
      const axes = imuAxes(record.channel);
      assertUint('accelRangeG', record.accelRangeG, 16);
      assertUint('gyroRangeDps', record.gyroRangeDps, 16);
      if (record.channel === 'high_g' && record.gyroRangeDps !== 0) {
        fail('field_out_of_range', 'the high_g channel has no gyro');
      }
      assertUint('odrMilliHz', record.odrMilliHz, 32);
      assertUint('sensorTickPeriodNs', record.sensorTickPeriodNs, 32);
      assertUint('firstSensorTimestamp', record.firstSensorTimestamp, 32);
      assertUint('lastSensorTimestamp', record.lastSensorTimestamp, 32);
      assertUint('samples.length', record.samples.length, 16);
      w.u8(enumCode('sensor', IMU_SENSORS, record.sensor))
        .u8(enumCode('channel', IMU_CHANNELS, record.channel))
        .u8((record.fifoOverrun ? 0x01 : 0) | (record.impactBurst ? 0x02 : 0))
        .u16(record.accelRangeG)
        .u16(record.gyroRangeDps)
        .u32(record.odrMilliHz)
        .u32(record.sensorTickPeriodNs)
        .u32(record.firstSensorTimestamp)
        .u32(record.lastSensorTimestamp)
        .u16(record.samples.length);
      for (const sample of record.samples) {
        if (sample.length !== axes) {
          fail('field_out_of_range', `an ${record.channel} sample has ${String(axes)} axes`);
        }
        for (const value of sample) {
          assertIntRange('imu sample', value, -0x8000, 0x7fff);
          w.i16(value);
        }
      }
      return;
    }
    case 'baro_batch':
      assertUint('odrMilliHz', record.odrMilliHz, 32);
      assertUint('lastSampleDeltaTicks', record.lastSampleDeltaTicks, 32);
      assertUint('samples.length', record.samples.length, 16);
      w.u8(enumCode('sensor', BARO_SENSORS, record.sensor))
        .u32(record.odrMilliHz)
        .u32(record.lastSampleDeltaTicks)
        .u16(record.samples.length);
      for (const sample of record.samples) {
        assertUint('pressureCentiPa', sample.pressureCentiPa, 24);
        assertIntRange('temperatureCentiC', sample.temperatureCentiC, -0x8000, 0x7fff);
        w.u24(sample.pressureCentiPa).i16(sample.temperatureCentiC);
      }
      return;
    case 'time_anchor':
      assertIntRange('subTickNs', record.subTickNs, 0, 30_517);
      assertIntRange('gnssTimeMs', record.gnssTimeMs, 0, NO_GNSS_TIME_MS - 1);
      if (record.uncertaintyUs !== null) {
        assertIntRange('uncertaintyUs', record.uncertaintyUs, 0, UNKNOWN_U32 - 1);
      }
      if (record.gpsUtcOffsetS !== null) {
        assertIntRange('gpsUtcOffsetS', record.gpsUtcOffsetS, 0, UNKNOWN_U8 - 1);
      }
      w.u8(enumCode('source', TIME_ANCHOR_SOURCES, record.source))
        .u16(record.subTickNs)
        .u48(record.gnssTimeMs)
        .u32(record.uncertaintyUs ?? UNKNOWN_U32)
        .u8(record.gpsUtcOffsetS ?? UNKNOWN_U8);
      return;
    case 'sensor_sync':
      assertIntRange('subTickNs', record.subTickNs, 0, 30_517);
      assertUint('sensorTimestamp', record.sensorTimestamp, 32);
      w.u8(enumCode('sensor', SYNC_SENSORS, record.sensor))
        .u16(record.subTickNs)
        .u32(record.sensorTimestamp);
      return;
    case 'segment_marker': {
      let detail = 0;
      let time = 0;
      switch (record.kind) {
        case 'recording_start':
          detail = enumCode('reason', RECORDING_START_REASONS, record.reason);
          break;
        case 'recording_stop':
          detail = enumCode('reason', RECORDING_STOP_REASONS, record.reason);
          break;
        case 'staff_session_open':
        case 'staff_session_close':
          assertUint('sessionSeq', record.sessionSeq, 8);
          assertUint('transitionGnssS', record.transitionGnssS, 32);
          detail = record.sessionSeq;
          time = record.transitionGnssS;
          break;
        default:
          break;
      }
      w.u8(enumCode('kind', SEGMENT_MARKER_KINDS, record.kind))
        .u8(detail)
        .u32(time);
      return;
    }
    case 'health':
      if (record.batteryPct !== null) {
        assertIntRange('batteryPct', record.batteryPct, 0, 100);
      }
      if (record.batteryMv !== null) {
        assertIntRange('batteryMv', record.batteryMv, 1, UNKNOWN_U16 - 1);
      }
      assertUint('chargeCyclesN', record.chargeCyclesN, 16);
      assertUint('badBlocksN', record.badBlocksN, 16);
      assertUint('freeBlocksN', record.freeBlocksN, 16);
      assertUint('eccCorrectedN', record.eccCorrectedN, 16);
      w.u8(record.batteryPct ?? 0x7f)
        .u16(record.batteryMv ?? 0)
        .i16(optI16('batteryTempCentiC', record.batteryTempCentiC))
        .i16(optI16('mcuTempCentiC', record.mcuTempCentiC))
        .u16(record.chargeCyclesN)
        .u16(record.badBlocksN)
        .u16(record.freeBlocksN)
        .u16(record.eccCorrectedN);
      return;
    case 'radio_tx':
      assertUint('frameNumber', record.frameNumber, 16);
      assertUint('durationUs', record.durationUs, 32);
      assertIntRange('txPowerDbm', record.txPowerDbm, -128, 127);
      assertUint('messageTypeByte', record.messageTypeByte, 8);
      w.u16(record.frameNumber)
        .u32(record.durationUs)
        .i8(record.txPowerDbm)
        .u8(record.messageTypeByte);
      return;
    case 'event':
      assertUint('value', record.value, 32);
      w.u16(enumCode('code', EVENT_CODES, record.code)).u32(record.value);
      return;
  }
}

/** Encodes one record (header and body). */
export function encodeRecord(record: LogRecord): Uint8Array {
  assertUint('tick', record.tick, 48);
  if (record.type === 'unknown') {
    assertIntRange('typeCode', record.typeCode, 0x01, 0xfe);
    const w = new ByteWriter(RECORD_HEADER_LENGTH + record.body.length);
    return w.u8(record.typeCode).u16(record.body.length).u48(record.tick).raw(record.body).finish();
  }
  const length = recordBodyLength(record);
  if (length > MAX_RECORD_BODY_LENGTH) {
    fail('field_out_of_range', `record body of ${String(length)} B exceeds 65 535 B`);
  }
  const w = new ByteWriter(RECORD_HEADER_LENGTH + length);
  w.u8(RECORD_TYPES[record.type]).u16(length).u48(record.tick);
  encodeBody(record, w);
  return w.finish();
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

const TYPE_BY_CODE = new Map<number, RecordType>(
  Object.entries(RECORD_TYPES).map(([name, code]) => [code, name as RecordType]),
);

function decodeKnownBody(type: RecordType, tick: number, r: ByteReader): KnownLogRecord {
  switch (type) {
    case 'firmware_info': {
      const major = r.u8();
      const minor = r.u8();
      const patch = r.u16();
      const firmwareBuildId = r.u32();
      const hardwareRevision = r.u8();
      const algorithmVersion = r.u16();
      const radioProtocolVersion = r.u8();
      const logFormatVersion = r.u8();
      const length = r.u8();
      const gnssFirmware = String.fromCharCode(...r.raw(length));
      return {
        type,
        tick,
        firmwareVersion: { major, minor, patch },
        firmwareBuildId,
        hardwareRevision,
        algorithmVersion,
        radioProtocolVersion,
        logFormatVersion,
        gnssFirmware,
      };
    }
    case 'config_applied':
      return {
        type,
        tick,
        configVersion: r.u32(),
        configHash: r.raw(8),
        gnssPvtRateHz: r.u8(),
        gnssRawRateHz: r.u8(),
        gnssConstellations: fromBitmask('gnssConstellations', GNSS_CONSTELLATIONS, r.u8()),
        gnssBands: fromBitmask('gnssBands', GNSS_BANDS, r.u8()),
      };
    case 'gnss_pvt': {
      const gnssTimeMs = r.u48();
      const latE7 = r.i32();
      const lonE7 = r.i32();
      const heightEllipsoidMm = r.i32();
      const velNorthMmS = readOptI16(r.i16());
      const velEastMmS = readOptI16(r.i16());
      const velDownMmS = readOptI16(r.i16());
      const groundSpeedMmS = readOptU16(r.u16());
      const headingCentiDeg = readOptU16(r.u16());
      const hAccMm = readOptU16(r.u16());
      const vAccMm = readOptU16(r.u16());
      const speedAccMmS = readOptU16(r.u16());
      const fixQuality = enumValue('fixQuality', FIX_QUALITIES, r.u8() + 1);
      const satellitesN = r.u8();
      return {
        type,
        tick,
        gnssTimeMs,
        latE7,
        lonE7,
        heightEllipsoidMm,
        velNorthMmS,
        velEastMmS,
        velDownMmS,
        groundSpeedMmS,
        headingCentiDeg,
        hAccMm,
        vAccMm,
        speedAccMmS,
        fixQuality,
        satellitesN,
      };
    }
    case 'gnss_raw': {
      const format = enumValue('format', GNSS_RAW_FORMATS, r.u8());
      const time = r.u48();
      return {
        type,
        tick,
        format,
        gnssTimeMs: time === NO_GNSS_TIME_MS ? null : time,
        data: r.raw(r.remaining),
      };
    }
    case 'imu_batch': {
      const sensor = enumValue('sensor', IMU_SENSORS, r.u8());
      const channel = enumValue('channel', IMU_CHANNELS, r.u8());
      const flags = r.u8();
      if ((flags & 0xfc) !== 0) {
        fail('reserved_bits_set', 'imu_batch flags');
      }
      const accelRangeG = r.u16();
      const gyroRangeDps = r.u16();
      const odrMilliHz = r.u32();
      const sensorTickPeriodNs = r.u32();
      const firstSensorTimestamp = r.u32();
      const lastSensorTimestamp = r.u32();
      const count = r.u16();
      const axes = imuAxes(channel);
      if (r.remaining !== count * axes * 2) {
        fail('malformed_record', 'imu_batch sample count does not match its length');
      }
      const samples: number[][] = [];
      for (let i = 0; i < count; i += 1) {
        const sample: number[] = [];
        for (let a = 0; a < axes; a += 1) {
          sample.push(r.i16());
        }
        samples.push(sample);
      }
      return {
        type,
        tick,
        sensor,
        channel,
        fifoOverrun: (flags & 0x01) !== 0,
        impactBurst: (flags & 0x02) !== 0,
        accelRangeG,
        gyroRangeDps,
        odrMilliHz,
        sensorTickPeriodNs,
        firstSensorTimestamp,
        lastSensorTimestamp,
        samples,
      };
    }
    case 'baro_batch': {
      const sensor = enumValue('sensor', BARO_SENSORS, r.u8());
      const odrMilliHz = r.u32();
      const lastSampleDeltaTicks = r.u32();
      const count = r.u16();
      if (r.remaining !== count * BARO_SAMPLE_LENGTH) {
        fail('malformed_record', 'baro_batch sample count does not match its length');
      }
      const samples: BaroSample[] = [];
      for (let i = 0; i < count; i += 1) {
        samples.push({ pressureCentiPa: r.u24(), temperatureCentiC: r.i16() });
      }
      return { type, tick, sensor, odrMilliHz, lastSampleDeltaTicks, samples };
    }
    case 'time_anchor': {
      const source = enumValue('source', TIME_ANCHOR_SOURCES, r.u8());
      const subTickNs = r.u16();
      const gnssTimeMs = r.u48();
      const uncertainty = r.u32();
      const offset = r.u8();
      return {
        type,
        tick,
        source,
        subTickNs,
        gnssTimeMs,
        uncertaintyUs: uncertainty === UNKNOWN_U32 ? null : uncertainty,
        gpsUtcOffsetS: offset === UNKNOWN_U8 ? null : offset,
      };
    }
    case 'sensor_sync':
      return {
        type,
        tick,
        sensor: enumValue('sensor', SYNC_SENSORS, r.u8()),
        subTickNs: r.u16(),
        sensorTimestamp: r.u32(),
      };
    case 'segment_marker': {
      const kind = enumValue('kind', SEGMENT_MARKER_KINDS, r.u8());
      const detail = r.u8();
      const time = r.u32();
      switch (kind) {
        case 'recording_start':
          return {
            type,
            tick,
            kind,
            reason: enumValue('reason', RECORDING_START_REASONS, detail),
          };
        case 'recording_stop':
          return { type, tick, kind, reason: enumValue('reason', RECORDING_STOP_REASONS, detail) };
        case 'staff_session_open':
        case 'staff_session_close':
          return { type, tick, kind, sessionSeq: detail, transitionGnssS: time };
        default:
          if (detail !== 0 || time !== 0) {
            fail('reserved_bits_set', `${kind} carries no detail`);
          }
          return { type, tick, kind };
      }
    }
    case 'health': {
      const pct = r.u8();
      const mv = r.u16();
      return {
        type,
        tick,
        batteryPct: pct === 0x7f ? null : pct,
        batteryMv: mv === 0 ? null : mv,
        batteryTempCentiC: readOptI16(r.i16()),
        mcuTempCentiC: readOptI16(r.i16()),
        chargeCyclesN: r.u16(),
        badBlocksN: r.u16(),
        freeBlocksN: r.u16(),
        eccCorrectedN: r.u16(),
      };
    }
    case 'radio_tx':
      return {
        type,
        tick,
        frameNumber: r.u16(),
        durationUs: r.u32(),
        txPowerDbm: r.i8(),
        messageTypeByte: r.u8(),
      };
    case 'event':
      return { type, tick, code: enumValue('code', EVENT_CODES, r.u16()), value: r.u32() };
  }
}

/**
 * Decodes the body of a record whose header was already read. Unknown types
 * come back as `unknown`; a known type with a wrong length or value throws
 * `malformed_record` (the caller skips it by its length and reports it).
 */
export function decodeRecordBody(typeCode: number, tick: number, body: Uint8Array): LogRecord {
  const type = TYPE_BY_CODE.get(typeCode);
  if (type === undefined) {
    return { type: 'unknown', typeCode, tick, body: body.slice() };
  }
  const fixed = FIXED_BODY_LENGTH[type];
  if (fixed !== null && body.length !== fixed) {
    fail('malformed_record', `${type} body must be ${String(fixed)} B, got ${String(body.length)}`);
  }
  const r = new ByteReader(body);
  try {
    const record = decodeKnownBody(type, tick, r);
    r.end();
    return record;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'invalid_length') {
      fail('malformed_record', `${type}: ${error.message}`);
    }
    throw error;
  }
}

/** Decodes a whole record (header and body) from `bytes`; it must be exactly one record. */
export function decodeRecord(bytes: Uint8Array): LogRecord {
  const r = new ByteReader(bytes);
  const typeCode = r.u8();
  const length = r.u16();
  const tick = r.u48();
  const body = r.raw(length);
  r.end();
  return decodeRecordBody(typeCode, tick, body);
}

/** Raw IMU LSB → milli-g / milli-°/s for the range of the batch. */
export function imuAccelMilliG(raw: number, accelRangeG: number): number {
  return (raw * accelRangeG * 1000) / 32_768;
}

export function imuGyroMilliDps(raw: number, gyroRangeDps: number): number {
  return (raw * gyroRangeDps * 1000) / 32_768;
}
