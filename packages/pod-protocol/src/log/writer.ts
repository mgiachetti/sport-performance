import { assertUint } from '../bytes.js';
import { DEVICE_ID_LENGTH } from '../crypto.js';
import { fail } from '../errors.js';
import { LOG_FORMAT_VERSION, LOG_PAGE_PAYLOAD_CAPACITY } from './constants.js';
import { checkStorageKey, deriveLogPageKeys, type LogPageKeys } from './integrity.js';
import { sealLogPage } from './page.js';
import { encodeRecord, type LogRecord } from './records.js';

export interface LogWriterOptions {
  deviceId: Uint8Array;
  /** Persistent boot counter of the pod: the time epoch of the RTC ticks. */
  bootCounter: number;
  /** Recording segment id, monotonic per pod (persisted like the boot counter). */
  segmentId: number;
  /**
   * First page sequence of the segment. The pod persists a reservation of page
   * sequences and starts each boot above it, so a sequence is never reused
   * under the same storage key (it is the CTR IV).
   */
  firstPageSeq: number;
  keyEpoch: number;
  storageKey: Uint8Array;
}

/**
 * Reference encoder of the log (the firmware does the same in C and is tested
 * against the fixtures). Records are appended to the segment's byte stream and
 * cut into 1996 B page payloads; a record may span pages. Every sealed page is
 * returned to the caller, which programs it into the next free page of the
 * segment's blocks.
 */
export class LogWriter {
  private readonly deviceId: Uint8Array;
  private readonly bootCounter: number;
  private readonly segmentId: number;
  private keyEpoch: number;
  private keys: LogPageKeys;
  private nextPageSeq: number;
  private streamOffset = 0;
  private readonly buffer = new Uint8Array(LOG_PAGE_PAYLOAD_CAPACITY);
  private length = 0;
  private recordStarts: number[] = [];
  private closed = false;

  constructor(options: LogWriterOptions) {
    if (options.deviceId.length !== DEVICE_ID_LENGTH) {
      fail('field_out_of_range', `deviceId must be ${String(DEVICE_ID_LENGTH)} B`);
    }
    assertUint('bootCounter', options.bootCounter, 32);
    assertUint('segmentId', options.segmentId, 32);
    assertUint('firstPageSeq', options.firstPageSeq, 32);
    assertUint('keyEpoch', options.keyEpoch, 8);
    checkStorageKey(options.storageKey);
    this.deviceId = options.deviceId.slice();
    this.bootCounter = options.bootCounter;
    this.segmentId = options.segmentId;
    this.keyEpoch = options.keyEpoch;
    this.keys = deriveLogPageKeys(options.storageKey);
    this.nextPageSeq = options.firstPageSeq;
  }

  /** Page sequence the next sealed page will carry. */
  get pageSeq(): number {
    return this.nextPageSeq;
  }

  /** Bytes of the segment stream written so far (sealed or buffered). */
  get streamLength(): number {
    return this.streamOffset + this.length;
  }

  /**
   * New storage key (rotation at the dock). It applies from the page being
   * filled: the page sequence keeps counting, so no IV repeats across epochs.
   */
  rotateKey(keyEpoch: number, storageKey: Uint8Array): void {
    assertUint('keyEpoch', keyEpoch, 8);
    checkStorageKey(storageKey);
    this.keyEpoch = keyEpoch;
    this.keys = deriveLogPageKeys(storageKey);
  }

  /**
   * Pages that appending `record` would seal (programmed right away). The pod
   * checks it against `mayAppend` so a page always stays free for the close.
   */
  pagesSealedBy(record: LogRecord): number {
    return Math.floor((this.length + encodeRecord(record).length) / LOG_PAGE_PAYLOAD_CAPACITY);
  }

  /** Appends one record; returns the pages it completed. */
  append(record: LogRecord): Uint8Array[] {
    this.assertOpen();
    const bytes = encodeRecord(record);
    const pages: Uint8Array[] = [];
    this.recordStarts.push(this.length);
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = Math.min(bytes.length - offset, LOG_PAGE_PAYLOAD_CAPACITY - this.length);
      this.buffer.set(bytes.subarray(offset, offset + chunk), this.length);
      this.length += chunk;
      offset += chunk;
      if (this.length === LOG_PAGE_PAYLOAD_CAPACITY) {
        pages.push(this.seal({ continues: offset < bytes.length, segmentEnd: false }));
      }
    }
    return pages;
  }

  /**
   * Seals the page being filled even if it is not full (before sleeping or when
   * the RAM buffer has been waiting too long). The stream continues on the next
   * page at the next offset.
   */
  flush(): Uint8Array[] {
    this.assertOpen();
    return this.length === 0 ? [] : [this.seal({ continues: false, segmentEnd: false })];
  }

  /**
   * Closes the segment: seals the last page with the segment-end flag (an empty
   * page if the stream ended exactly on a page boundary).
   */
  close(): Uint8Array[] {
    this.assertOpen();
    const page = this.seal({ continues: false, segmentEnd: true });
    this.closed = true;
    return [page];
  }

  private assertOpen(): void {
    if (this.closed) {
      fail('field_out_of_range', 'the segment is closed');
    }
  }

  private seal(flags: { continues: boolean; segmentEnd: boolean }): Uint8Array {
    if (this.nextPageSeq > 0xffff_ffff) {
      fail('field_out_of_range', 'page sequence exhausted: rotate the storage key at the dock');
    }
    const firstRecordOffset = this.recordStarts[0];
    const page = sealLogPage({
      header: {
        formatVersion: LOG_FORMAT_VERSION,
        keyEpoch: this.keyEpoch,
        segmentStart: this.streamOffset === 0,
        segmentEnd: flags.segmentEnd,
        continues: flags.continues,
        recovered: false,
        deviceId: this.deviceId,
        bootCounter: this.bootCounter,
        segmentId: this.segmentId,
        pageSeq: this.nextPageSeq,
        streamOffset: this.streamOffset,
        payloadLength: this.length,
        firstRecordOffset: firstRecordOffset ?? null,
        recordCount: this.recordStarts.length,
      },
      payload: this.buffer.slice(0, this.length),
      keys: this.keys,
    });
    this.nextPageSeq += 1;
    this.streamOffset += this.length;
    this.length = 0;
    this.recordStarts = [];
    return page;
  }
}

/**
 * Recovery close (ADR 0106): at the next boot, before recording again, the pod
 * scans its NAND and, for a segment a power loss left open (no segment-end
 * page), programs this empty page with the segment-end and recovery flags in
 * the next erased page of the segment's last block (or a fresh block), with a
 * new page sequence and the current storage key. The segment is then final,
 * authenticated by the pod itself, and the server can confirm it like any
 * closed one; nothing the dock says decides it.
 */
export function sealRecoveryPage(input: {
  deviceId: Uint8Array;
  bootCounter: number;
  segmentId: number;
  /** End of the stream from the scan (`SegmentSummary.streamBytes`). */
  streamOffset: number;
  pageSeq: number;
  keyEpoch: number;
  storageKey: Uint8Array;
}): Uint8Array {
  return sealLogPage({
    header: {
      formatVersion: LOG_FORMAT_VERSION,
      keyEpoch: input.keyEpoch,
      segmentStart: input.streamOffset === 0,
      segmentEnd: true,
      continues: false,
      recovered: true,
      deviceId: input.deviceId,
      bootCounter: input.bootCounter,
      segmentId: input.segmentId,
      pageSeq: input.pageSeq,
      streamOffset: input.streamOffset,
      payloadLength: 0,
      firstRecordOffset: null,
      recordCount: 0,
    },
    payload: new Uint8Array(0),
    keys: deriveLogPageKeys(input.storageKey),
  });
}
