import { describe, expect, it } from 'vitest';

import { toHex } from '../bytes.js';
import { PodProtocolError } from '../errors.js';
import { TEST_DEVICE_ID, testStorageKey } from '../testing/log-samples.js';
import {
  LOG_PAGE_CRC_OFFSET,
  LOG_PAGE_HEADER_LENGTH,
  LOG_PAGE_MAC_OFFSET,
  LOG_PAGE_PAYLOAD_CAPACITY,
  LOG_PAGE_SIZE,
} from './constants.js';
import { deriveLogPageKeys } from './integrity.js';
import {
  decodeLogPageHeader,
  inspectLogPage,
  openLogPage,
  sealLogPage,
  writePageCrc,
  type LogPageHeader,
} from './page.js';

const key = testStorageKey(2);
const payload = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
const header: LogPageHeader = {
  formatVersion: 1,
  keyEpoch: 2,
  segmentStart: true,
  segmentEnd: false,
  continues: true,
  recovered: false,
  deviceId: TEST_DEVICE_ID,
  bootCounter: 70_000,
  segmentId: 5,
  pageSeq: 4_096,
  streamOffset: 0,
  payloadLength: payload.length,
  firstRecordOffset: 0,
  recordCount: 3,
};

describe('log page', () => {
  const page = sealLogPage({ header, payload, keys: deriveLogPageKeys(key) });

  it('is 2048 B: 40 B header, 1996 B payload, 8 B CMAC, 4 B CRC', () => {
    expect(page.length).toBe(LOG_PAGE_SIZE);
    expect(LOG_PAGE_PAYLOAD_CAPACITY).toBe(1996);
    expect(LOG_PAGE_MAC_OFFSET).toBe(2036);
    expect(LOG_PAGE_CRC_OFFSET).toBe(2044);
    expect(toHex(page.subarray(0, LOG_PAGE_HEADER_LENGTH))).toBe(
      '53504c47' +
        '01' +
        '02' +
        '05' +
        '00' +
        toHex(TEST_DEVICE_ID) +
        '70110100' +
        '05000000' +
        '00100000' +
        '00000000' +
        '2c01' +
        '0000' +
        '0300' +
        '0000',
    );
  });

  it('keeps the payload encrypted and opens with the key', () => {
    expect(toHex(page.subarray(LOG_PAGE_HEADER_LENGTH, LOG_PAGE_HEADER_LENGTH + 300))).not.toBe(
      toHex(payload),
    );
    const inspection = inspectLogPage(page);
    expect(inspection.status).toBe('valid');
    if (inspection.status !== 'valid') return;
    expect(inspection.header).toEqual(header);
    expect(
      toHex(openLogPage({ page, header: inspection.header, keys: deriveLogPageKeys(key) })),
    ).toBe(toHex(payload));
  });

  it('erased, torn and corrupted pages are told apart without a key', () => {
    expect(inspectLogPage(new Uint8Array(LOG_PAGE_SIZE).fill(0xff))).toEqual({ status: 'erased' });
    const torn = page.slice();
    torn.fill(0xff, 1024);
    expect(inspectLogPage(torn)).toEqual({ status: 'crc_mismatch', torn: true });
    const flipped = page.slice();
    flipped[500] = (flipped[500] ?? 0) ^ 0x01;
    expect(inspectLogPage(flipped)).toEqual({ status: 'crc_mismatch', torn: false });
  });

  it('a page re-CRCed after tampering fails the CMAC', () => {
    const tampered = page.slice();
    tampered[100] = (tampered[100] ?? 0) ^ 0x80;
    tampered.set(writePageCrc(tampered), LOG_PAGE_CRC_OFFSET);
    const inspection = inspectLogPage(tampered);
    if (inspection.status !== 'valid') throw new Error('expected a valid CRC');
    expect(() =>
      openLogPage({ page: tampered, header: inspection.header, keys: deriveLogPageKeys(key) }),
    ).toThrow(PodProtocolError);
    expect(() =>
      openLogPage({ page, header: inspection.header, keys: deriveLogPageKeys(testStorageKey(3)) }),
    ).toThrow(/page 4096/);
  });

  it('the header is authenticated: changing the page sequence breaks the CMAC', () => {
    const moved = page.slice();
    moved[24] = 0x01;
    moved.set(writePageCrc(moved), LOG_PAGE_CRC_OFFSET);
    const inspection = inspectLogPage(moved);
    if (inspection.status !== 'valid') throw new Error('expected a valid CRC');
    expect(() =>
      openLogPage({ page: moved, header: inspection.header, keys: deriveLogPageKeys(key) }),
    ).toThrow();
  });

  it('rejects bad headers', () => {
    const bad = (mutate: (p: Uint8Array) => void): string => {
      const copy = page.slice();
      mutate(copy);
      copy.set(writePageCrc(copy), LOG_PAGE_CRC_OFFSET);
      const inspection = inspectLogPage(copy);
      return inspection.status === 'invalid_header' ? inspection.code : inspection.status;
    };
    expect(bad((p) => (p[0] = 0x00))).toBe('not_a_log_page');
    expect(bad((p) => (p[4] = 2))).toBe('unsupported_version');
    expect(bad((p) => (p[6] = 0x80))).toBe('reserved_bits_set');
    expect(bad((p) => (p[33] = 0x08))).toBe('invalid_length');
    expect(bad((p) => (p[36] = 0))).toBe('invalid_length');
    expect(() => decodeLogPageHeader(new Uint8Array(10))).toThrow();
  });

  it('a page with no record start (pure continuation) has offset 0xFFFF', () => {
    const continuation = sealLogPage({
      header: { ...header, segmentStart: false, firstRecordOffset: null, recordCount: 0 },
      payload,
      keys: deriveLogPageKeys(key),
    });
    expect(toHex(continuation.subarray(34, 38))).toBe('ffff0000');
  });
});
