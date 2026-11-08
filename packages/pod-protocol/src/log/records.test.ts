import { describe, expect, it } from 'vitest';

import { toHex } from '../bytes.js';
import { PodProtocolError, type PodProtocolErrorCode } from '../errors.js';
import { syntheticSession } from '../testing/log-samples.js';
import {
  decodeRecord,
  decodeRecordBody,
  encodeRecord,
  imuAccelMilliG,
  imuGyroMilliDps,
  RECORD_HEADER_LENGTH,
  type LogRecord,
} from './records.js';

function codeOf(fn: () => unknown): PodProtocolErrorCode | 'none' {
  try {
    fn();
    return 'none';
  } catch (error) {
    if (error instanceof PodProtocolError) {
      return error.code;
    }
    throw error;
  }
}

const SESSION = syntheticSession({ durationS: 2, rawGnss: true, dockAnchorAtEnd: true });

describe('log records', () => {
  it('every record type of a session round-trips', () => {
    const types = new Set(SESSION.map((r) => r.type));
    expect([...types].sort()).toEqual([
      'baro_batch',
      'config_applied',
      'firmware_info',
      'gnss_pvt',
      'gnss_raw',
      'health',
      'imu_batch',
      'radio_tx',
      'segment_marker',
      'sensor_sync',
      'time_anchor',
    ]);
    for (const record of SESSION) {
      expect(decodeRecord(encodeRecord(record))).toEqual(record);
    }
  });

  it('round-trips the remaining shapes: events, staff markers, sentinels', () => {
    const records: LogRecord[] = [
      { type: 'event', tick: 5, code: 'nand_program_failed', value: 1234 },
      {
        type: 'segment_marker',
        tick: 6,
        kind: 'staff_session_close',
        sessionSeq: 9,
        transitionGnssS: 1_446_000_100,
      },
      { type: 'segment_marker', tick: 7, kind: 'recording_stop', reason: 'memory_full' },
      {
        type: 'gnss_pvt',
        tick: 2 ** 40,
        gnssTimeMs: 2 ** 47,
        latE7: -900_000_000,
        lonE7: 1_800_000_000,
        heightEllipsoidMm: -2_000_000,
        velNorthMmS: null,
        velEastMmS: -32_767,
        velDownMmS: 32_767,
        groundSpeedMmS: null,
        headingCentiDeg: null,
        hAccMm: 65_534,
        vAccMm: null,
        speedAccMmS: null,
        fixQuality: 'rtk_fixed',
        satellitesN: 0,
      },
      {
        type: 'gnss_raw',
        tick: 0,
        format: 'quectel_raw',
        gnssTimeMs: null,
        data: new Uint8Array(0),
      },
      {
        type: 'health',
        tick: 1,
        batteryPct: null,
        batteryMv: null,
        batteryTempCentiC: null,
        mcuTempCentiC: -500,
        chargeCyclesN: 0,
        badBlocksN: 0,
        freeBlocksN: 0,
        eccCorrectedN: 65_535,
      },
      { type: 'unknown', tick: 3, typeCode: 0x7e, body: Uint8Array.of(1, 2, 3) },
    ];
    for (const record of records) {
      expect(decodeRecord(encodeRecord(record))).toEqual(record);
    }
  });

  it('lays out the header as type ‖ length ‖ tick (u48 LE)', () => {
    const bytes = encodeRecord({
      type: 'event',
      tick: 0x0102_0304_0506,
      code: 'brownout',
      value: 0,
    });
    expect(toHex(bytes.subarray(0, RECORD_HEADER_LENGTH))).toBe('710600060504030201');
    expect(bytes.length).toBe(RECORD_HEADER_LENGTH + 6);
  });

  it('a PVT is 45 B and an IMU batch of 25 six-axis samples 334 B', () => {
    const pvt = SESSION.find((r) => r.type === 'gnss_pvt');
    const imu = SESSION.find((r) => r.type === 'imu_batch' && r.channel === 'accel_gyro');
    expect(pvt && encodeRecord(pvt).length).toBe(45);
    expect(imu && encodeRecord(imu).length).toBe(RECORD_HEADER_LENGTH + 25 + 25 * 12);
  });

  it('rejects bad values on encode', () => {
    expect(
      codeOf(() =>
        encodeRecord({
          type: 'imu_batch',
          tick: 0,
          sensor: 'lsm6dsv320x',
          channel: 'high_g',
          fifoOverrun: false,
          impactBurst: false,
          accelRangeG: 320,
          gyroRangeDps: 2000,
          odrMilliHz: 1,
          sensorTickPeriodNs: 1,
          firstSensorTimestamp: 0,
          lastSensorTimestamp: 0,
          samples: [],
        }),
      ),
    ).toBe('field_out_of_range');
    expect(
      codeOf(() => encodeRecord({ type: 'event', tick: -1, code: 'brownout', value: 0 })),
    ).toBe('field_out_of_range');
    expect(
      codeOf(() =>
        encodeRecord({ type: 'unknown', tick: 0, typeCode: 0xff, body: new Uint8Array() }),
      ),
    ).toBe('field_out_of_range');
  });

  it('rejects malformed bodies on decode', () => {
    // Wrong fixed length.
    expect(codeOf(() => decodeRecordBody(0x71, 0, new Uint8Array(5)))).toBe('malformed_record');
    // Unknown enum value (event code 0).
    expect(codeOf(() => decodeRecordBody(0x71, 0, new Uint8Array(6)))).toBe('malformed_record');
    // Reserved bits in a marker without detail (vest_on with detail 1).
    expect(codeOf(() => decodeRecordBody(0x50, 0, Uint8Array.of(3, 1, 0, 0, 0, 0)))).toBe(
      'reserved_bits_set',
    );
    // IMU sample count that does not match the length.
    const imu = SESSION.find((r) => r.type === 'imu_batch');
    if (!imu) throw new Error('no imu');
    const bytes = encodeRecord(imu);
    expect(
      codeOf(() =>
        decodeRecordBody(0x20, 0, bytes.subarray(RECORD_HEADER_LENGTH, bytes.length - 2)),
      ),
    ).toBe('malformed_record');
    // Fix quality 7 (reserved).
    const pvt = SESSION.find((r) => r.type === 'gnss_pvt');
    if (!pvt) throw new Error('no pvt');
    const body = encodeRecord(pvt).slice(RECORD_HEADER_LENGTH);
    body[34] = 7;
    expect(codeOf(() => decodeRecordBody(0x10, 0, body))).toBe('malformed_record');
  });

  it('converts IMU LSB to physical units for the range', () => {
    expect(imuAccelMilliG(32_768, 16)).toBe(16_000);
    expect(imuAccelMilliG(-16_384, 320)).toBe(-160_000);
    expect(imuGyroMilliDps(16_384, 2_000)).toBe(1_000_000);
  });
});
