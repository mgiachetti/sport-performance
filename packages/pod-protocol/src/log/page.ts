import { assertUint, ByteReader, ByteWriter, concatBytes, equalBytes } from '../bytes.js';
import { DEVICE_ID_LENGTH } from '../crypto.js';
import { fail } from '../errors.js';
import {
  ERASED_BYTE,
  LOG_FORMAT_VERSION,
  LOG_PAGE_CRC_OFFSET,
  LOG_PAGE_HEADER_LENGTH,
  LOG_PAGE_MAC_OFFSET,
  LOG_PAGE_MAGIC,
  LOG_PAGE_PAYLOAD_CAPACITY,
  LOG_PAGE_SIZE,
  NO_RECORD_START,
  PAGE_FLAGS,
  PAGE_FLAGS_RESERVED_MASK,
} from './constants.js';
import { crc32, logPageCtr, logPageMac } from './integrity.js';

/**
 * Clear header of a log page (40 B, authenticated by the CMAC, not encrypted):
 *
 * ```
 * 0..3    magic "SPLG"
 * 4       format version (1)
 * 5       key epoch (id of the storage key)
 * 6       flags: segment start [0], segment end [1], last record continues [2], reserved [7..3] = 0
 * 7       reserved = 0
 * 8..15   DEVICEID (FICR, 8 B as in memory)
 * 16..19  boot counter (u32): the time epoch of the RTC ticks of the records
 * 20..23  segment id (u32): recording segment, monotonic per pod
 * 24..27  page sequence (u32): monotonic per pod, never reused (CTR IV)
 * 28..31  stream offset (u32): offset of this payload in the segment's record stream
 * 32..33  payload length (u16, ≤ 1996)
 * 34..35  first record offset (u16; 0xFFFF = no record starts in the page)
 * 36..37  records that start in the page (u16)
 * 38..39  reserved = 0
 * 40..2035   payload, AES-128-CTR (zero padding after the payload length)
 * 2036..2043 AES-CMAC(header ‖ ciphertext), first 8 B
 * 2044..2047 CRC-32 of bytes 0..2043 (u32 LE)
 * ```
 */
export interface LogPageHeader {
  formatVersion: number;
  keyEpoch: number;
  segmentStart: boolean;
  segmentEnd: boolean;
  continues: boolean;
  deviceId: Uint8Array;
  bootCounter: number;
  segmentId: number;
  pageSeq: number;
  streamOffset: number;
  payloadLength: number;
  /** `null` when the page only continues a record that started earlier. */
  firstRecordOffset: number | null;
  recordCount: number;
}

export function encodeLogPageHeader(header: LogPageHeader): Uint8Array {
  assertUint('keyEpoch', header.keyEpoch, 8);
  assertUint('bootCounter', header.bootCounter, 32);
  assertUint('segmentId', header.segmentId, 32);
  assertUint('pageSeq', header.pageSeq, 32);
  assertUint('streamOffset', header.streamOffset, 32);
  assertUint('recordCount', header.recordCount, 16);
  if (header.formatVersion !== LOG_FORMAT_VERSION) {
    fail('unsupported_version', `log format ${String(header.formatVersion)}`);
  }
  if (header.deviceId.length !== DEVICE_ID_LENGTH) {
    fail('field_out_of_range', `deviceId must be ${String(DEVICE_ID_LENGTH)} B`);
  }
  if (header.payloadLength > LOG_PAGE_PAYLOAD_CAPACITY) {
    fail('field_out_of_range', 'payload longer than the page');
  }
  if (header.firstRecordOffset !== null && header.firstRecordOffset >= header.payloadLength) {
    fail('field_out_of_range', 'first record offset past the payload');
  }
  const flags =
    (header.segmentStart ? PAGE_FLAGS.segmentStart : 0) |
    (header.segmentEnd ? PAGE_FLAGS.segmentEnd : 0) |
    (header.continues ? PAGE_FLAGS.continues : 0);
  return new ByteWriter(LOG_PAGE_HEADER_LENGTH)
    .raw(LOG_PAGE_MAGIC)
    .u8(header.formatVersion)
    .u8(header.keyEpoch)
    .u8(flags)
    .u8(0)
    .raw(header.deviceId)
    .u32(header.bootCounter)
    .u32(header.segmentId)
    .u32(header.pageSeq)
    .u32(header.streamOffset)
    .u16(header.payloadLength)
    .u16(header.firstRecordOffset ?? NO_RECORD_START)
    .u16(header.recordCount)
    .u16(0)
    .finish();
}

/** Decodes and validates the clear header (no key needed). */
export function decodeLogPageHeader(page: Uint8Array): LogPageHeader {
  if (page.length < LOG_PAGE_HEADER_LENGTH) {
    fail('invalid_length', 'shorter than a log page header');
  }
  const r = new ByteReader(page.subarray(0, LOG_PAGE_HEADER_LENGTH));
  if (!equalBytes(r.raw(4), LOG_PAGE_MAGIC)) {
    fail('not_a_log_page', 'bad magic');
  }
  const formatVersion = r.u8();
  if (formatVersion !== LOG_FORMAT_VERSION) {
    fail('unsupported_version', `log format ${String(formatVersion)}`);
  }
  const keyEpoch = r.u8();
  const flags = r.u8();
  const reserved = r.u8();
  if ((flags & PAGE_FLAGS_RESERVED_MASK) !== 0 || reserved !== 0) {
    fail('reserved_bits_set', 'page header');
  }
  const deviceId = r.raw(DEVICE_ID_LENGTH);
  const bootCounter = r.u32();
  const segmentId = r.u32();
  const pageSeq = r.u32();
  const streamOffset = r.u32();
  const payloadLength = r.u16();
  const first = r.u16();
  const recordCount = r.u16();
  if (r.u16() !== 0) {
    fail('reserved_bits_set', 'page header');
  }
  if (payloadLength > LOG_PAGE_PAYLOAD_CAPACITY) {
    fail('invalid_length', 'payload longer than the page');
  }
  if (first !== NO_RECORD_START && first >= payloadLength) {
    fail('invalid_length', 'first record offset past the payload');
  }
  if ((first === NO_RECORD_START) !== (recordCount === 0)) {
    fail('invalid_length', 'record count and first record offset disagree');
  }
  return {
    formatVersion,
    keyEpoch,
    segmentStart: (flags & PAGE_FLAGS.segmentStart) !== 0,
    segmentEnd: (flags & PAGE_FLAGS.segmentEnd) !== 0,
    continues: (flags & PAGE_FLAGS.continues) !== 0,
    deviceId,
    bootCounter,
    segmentId,
    pageSeq,
    streamOffset,
    payloadLength,
    firstRecordOffset: first === NO_RECORD_START ? null : first,
    recordCount,
  };
}

/**
 * Seals a page: header in clear, payload zero-padded to 1996 B and encrypted
 * with AES-128-CTR (IV = key epoch ‖ page sequence), CMAC over header ‖
 * ciphertext, CRC-32 over everything before it.
 */
export function sealLogPage(input: {
  header: LogPageHeader;
  payload: Uint8Array;
  storageKey: Uint8Array;
}): Uint8Array {
  if (input.payload.length !== input.header.payloadLength) {
    fail('invalid_length', 'payload length differs from the header');
  }
  const header = encodeLogPageHeader(input.header);
  const plaintext = new Uint8Array(LOG_PAGE_PAYLOAD_CAPACITY);
  plaintext.set(input.payload);
  const ciphertext = logPageCtr(
    input.storageKey,
    input.header.keyEpoch,
    input.header.pageSeq,
    plaintext,
  );
  const authenticated = concatBytes(header, ciphertext);
  const mac = logPageMac(input.storageKey, authenticated);
  const page = new Uint8Array(LOG_PAGE_SIZE);
  page.set(authenticated);
  page.set(mac, LOG_PAGE_MAC_OFFSET);
  page.set(writePageCrc(page), LOG_PAGE_CRC_OFFSET);
  return page;
}

/** CRC-32 field of a page (u32 LE of the CRC of bytes 0..2043). */
export function writePageCrc(page: Uint8Array): Uint8Array {
  return new ByteWriter(4).u32(crc32(page.subarray(0, LOG_PAGE_CRC_OFFSET))).finish();
}

/** What a page is, without a key (the dock and the pod's scan only need this). */
export type PageInspection =
  | { status: 'erased' }
  | {
      status: 'crc_mismatch';
      /** The tail reads erased: the program was cut (power loss mid-page). */
      torn: boolean;
    }
  | { status: 'invalid_header'; code: string }
  | { status: 'valid'; header: LogPageHeader };

function isErased(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === ERASED_BYTE);
}

export function readPageCrc(page: Uint8Array): number {
  return new ByteReader(page.subarray(LOG_PAGE_CRC_OFFSET, LOG_PAGE_SIZE)).u32();
}

/**
 * Keyless check of a page: erased, CRC, header. A page whose CRC fails and whose
 * last bytes read erased is a torn write (power lost while programming).
 */
export function inspectLogPage(page: Uint8Array): PageInspection {
  if (page.length !== LOG_PAGE_SIZE) {
    fail('invalid_length', `a log page is ${String(LOG_PAGE_SIZE)} B`);
  }
  if (isErased(page)) {
    return { status: 'erased' };
  }
  if (crc32(page.subarray(0, LOG_PAGE_CRC_OFFSET)) !== readPageCrc(page)) {
    return { status: 'crc_mismatch', torn: isErased(page.subarray(LOG_PAGE_SIZE - 16)) };
  }
  try {
    return { status: 'valid', header: decodeLogPageHeader(page) };
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      return { status: 'invalid_header', code: error.code };
    }
    throw error;
  }
}

/**
 * Opens a page whose CRC and header already checked: verifies the CMAC with the
 * storage key of its epoch and decrypts. Returns the payload (without padding),
 * or throws `mac_mismatch`.
 */
export function openLogPage(input: {
  page: Uint8Array;
  header: LogPageHeader;
  storageKey: Uint8Array;
}): Uint8Array {
  const authenticated = input.page.subarray(0, LOG_PAGE_MAC_OFFSET);
  const mac = logPageMac(input.storageKey, authenticated);
  if (!equalBytes(mac, input.page.subarray(LOG_PAGE_MAC_OFFSET, LOG_PAGE_CRC_OFFSET))) {
    fail('mac_mismatch', `page ${String(input.header.pageSeq)}`);
  }
  const plaintext = logPageCtr(
    input.storageKey,
    input.header.keyEpoch,
    input.header.pageSeq,
    input.page.subarray(LOG_PAGE_HEADER_LENGTH, LOG_PAGE_MAC_OFFSET),
  );
  return plaintext.slice(0, input.header.payloadLength);
}
