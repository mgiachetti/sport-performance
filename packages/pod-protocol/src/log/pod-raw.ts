import { sha256 } from '@noble/hashes/sha2.js';

import {
  asciiBytes,
  assertUint,
  ByteReader,
  ByteWriter,
  equalBytes,
  fromHex,
  toHex,
} from '../bytes.js';
import { DEVICE_ID_LENGTH } from '../crypto.js';
import { fail } from '../errors.js';
import { LOG_FORMAT_VERSION, LOG_PAGE_SIZE } from './constants.js';
import { ECC_STATUSES, type DecodedLog, type EccStatus, type NandPageRead } from './decoder.js';
import type { EraseCommand, SegmentSummary } from './nand.js';
import { decodeLogPageHeader } from './page.js';

/**
 * `pod_raw` file (ADR 0106, ADR 0044): the unit the dock uploads, one per
 * recording segment that overlaps a session. The pages go **as they are on the
 * NAND** (still encrypted and MACed): the dock has no key and the server keeps
 * the file encrypted while it is pending.
 *
 * ```
 * header (64 B)
 *   0..3   magic "SPRW"
 *   4      container version (1)
 *   5      log format version of the pages (1)
 *   6..7   page size (u16, 2048)
 *   8..15  DEVICEID
 *   16..19 boot counter (u32)
 *   20..23 segment id (u32)
 *   24..27 first page sequence (u32)
 *   28..31 last page sequence (u32)
 *   32..35 page count N (u32)
 *   36..63 reserved = 0
 * N × entry (2056 B)
 *   0..3   physical page (u32: block × 64 + page)
 *   4      ECC status of the read (0 ok, 1 corrected, 2 uncorrectable)
 *   5..7   reserved = 0
 *   8..    the 2048 B of the page
 * ```
 *
 * The SHA-256 of the whole file goes in the manifest and is what the server
 * confirms before the pod erases the segment.
 */

export const POD_RAW_MAGIC = asciiBytes('SPRW');
export const POD_RAW_CONTAINER_VERSION = 1;
export const POD_RAW_HEADER_LENGTH = 64;
export const POD_RAW_ENTRY_HEADER_LENGTH = 8;
export const POD_RAW_ENTRY_LENGTH = POD_RAW_ENTRY_HEADER_LENGTH + LOG_PAGE_SIZE;

/** Upload metadata of a `pod_raw` file (stored with the `file` row). */
export interface PodRawManifest {
  kind: 'pod_raw';
  containerVersion: number;
  logFormatVersion: number;
  deviceIdHex: string;
  /** System-wide serial number of the pod (the global device table). */
  podSerial: string;
  bootCounter: number;
  segmentId: number;
  firstPageSeq: number;
  lastPageSeq: number;
  /** Entries in the file (every programmed page of the segment's blocks). */
  pagesN: number;
  /** Pages with a valid CRC and header in the pod's scan. */
  validPagesN: number;
  blocks: number[];
  keyEpochs: number[];
  closed: boolean;
  /** Segment time range from the pod's index (UTC, Unix ms); `null` if the pod had no absolute time. */
  startUnixMs: number | null;
  endUnixMs: number | null;
  sizeB: number;
  sha256Hex: string;
}

export interface PodRawHeader {
  containerVersion: number;
  logFormatVersion: number;
  pageSizeB: number;
  deviceId: Uint8Array;
  bootCounter: number;
  segmentId: number;
  firstPageSeq: number;
  lastPageSeq: number;
  pagesN: number;
}

export function sha256Hex(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

/**
 * Builds the file the dock uploads for one segment: every programmed page of
 * the segment's blocks (valid or not, so the worker reports what was lost), in
 * physical order, and its manifest.
 */
export function buildPodRawFile(input: {
  segment: SegmentSummary;
  pages: readonly NandPageRead[];
  podSerial: string;
  startUnixMs: number | null;
  endUnixMs: number | null;
}): { bytes: Uint8Array; manifest: PodRawManifest } {
  const { segment } = input;
  if (!segment.fullyRead) {
    fail('field_out_of_range', 'the segment was not read entirely: scan every page of its blocks');
  }
  const deviceId = fromHex(segment.deviceIdHex);
  if (deviceId.length !== DEVICE_ID_LENGTH) {
    fail('field_out_of_range', 'deviceIdHex must be 8 B');
  }
  const pages = [...input.pages].sort((a, b) => a.physicalPage - b.physicalPage);
  const w = new ByteWriter(POD_RAW_HEADER_LENGTH + pages.length * POD_RAW_ENTRY_LENGTH);
  w.raw(POD_RAW_MAGIC)
    .u8(POD_RAW_CONTAINER_VERSION)
    .u8(LOG_FORMAT_VERSION)
    .u16(LOG_PAGE_SIZE)
    .raw(deviceId)
    .u32(segment.bootCounter)
    .u32(segment.segmentId)
    .u32(segment.firstPageSeq)
    .u32(segment.lastPageSeq)
    .u32(pages.length)
    .raw(new Uint8Array(POD_RAW_HEADER_LENGTH - 36));
  for (const page of pages) {
    assertUint('physicalPage', page.physicalPage, 32);
    if (page.data.length !== LOG_PAGE_SIZE) {
      fail('invalid_length', `a page is ${String(LOG_PAGE_SIZE)} B`);
    }
    w.u32(page.physicalPage)
      .u8(ECC_STATUSES.indexOf(page.ecc ?? 'ok'))
      .raw(new Uint8Array(3))
      .raw(page.data);
  }
  const bytes = w.finish();
  return {
    bytes,
    manifest: {
      kind: 'pod_raw',
      containerVersion: POD_RAW_CONTAINER_VERSION,
      logFormatVersion: LOG_FORMAT_VERSION,
      deviceIdHex: segment.deviceIdHex,
      podSerial: input.podSerial,
      bootCounter: segment.bootCounter,
      segmentId: segment.segmentId,
      firstPageSeq: segment.firstPageSeq,
      lastPageSeq: segment.lastPageSeq,
      pagesN: pages.length,
      validPagesN: segment.pagesN,
      blocks: [...segment.blocks],
      keyEpochs: [...segment.keyEpochs],
      closed: segment.closed,
      startUnixMs: input.startUnixMs,
      endUnixMs: input.endUnixMs,
      sizeB: bytes.length,
      sha256Hex: sha256Hex(bytes),
    },
  };
}

/**
 * Parses a `pod_raw` file. With `manifest`, also checks the size, the SHA-256
 * and that the header matches (`manifest_mismatch`), which is what the server
 * does before confirming.
 */
export function readPodRawFile(
  bytes: Uint8Array,
  manifest?: PodRawManifest,
): { header: PodRawHeader; pages: NandPageRead[] } {
  if (bytes.length < POD_RAW_HEADER_LENGTH) {
    fail('invalid_container', 'shorter than the header');
  }
  const r = new ByteReader(bytes.subarray(0, POD_RAW_HEADER_LENGTH));
  if (!equalBytes(r.raw(4), POD_RAW_MAGIC)) {
    fail('invalid_container', 'bad magic');
  }
  const containerVersion = r.u8();
  if (containerVersion !== POD_RAW_CONTAINER_VERSION) {
    fail('unsupported_version', `pod_raw container ${String(containerVersion)}`);
  }
  const header: PodRawHeader = {
    containerVersion,
    logFormatVersion: r.u8(),
    pageSizeB: r.u16(),
    deviceId: r.raw(DEVICE_ID_LENGTH),
    bootCounter: r.u32(),
    segmentId: r.u32(),
    firstPageSeq: r.u32(),
    lastPageSeq: r.u32(),
    pagesN: r.u32(),
  };
  if (r.raw(POD_RAW_HEADER_LENGTH - 36).some((b) => b !== 0)) {
    fail('reserved_bits_set', 'pod_raw header');
  }
  if (header.logFormatVersion !== LOG_FORMAT_VERSION) {
    fail('unsupported_version', `log format ${String(header.logFormatVersion)}`);
  }
  if (header.pageSizeB !== LOG_PAGE_SIZE) {
    fail('invalid_container', 'unexpected page size');
  }
  if (bytes.length !== POD_RAW_HEADER_LENGTH + header.pagesN * POD_RAW_ENTRY_LENGTH) {
    fail('invalid_container', 'length does not match the page count');
  }
  if (manifest) {
    const mismatches: string[] = [];
    if (manifest.sizeB !== bytes.length) mismatches.push('sizeB');
    if (manifest.sha256Hex.toLowerCase() !== sha256Hex(bytes)) mismatches.push('sha256Hex');
    if (manifest.deviceIdHex.toLowerCase() !== toHex(header.deviceId))
      mismatches.push('deviceIdHex');
    if (manifest.bootCounter !== header.bootCounter) mismatches.push('bootCounter');
    if (manifest.segmentId !== header.segmentId) mismatches.push('segmentId');
    if (manifest.firstPageSeq !== header.firstPageSeq) mismatches.push('firstPageSeq');
    if (manifest.lastPageSeq !== header.lastPageSeq) mismatches.push('lastPageSeq');
    if (manifest.pagesN !== header.pagesN) mismatches.push('pagesN');
    if (manifest.logFormatVersion !== header.logFormatVersion) mismatches.push('logFormatVersion');
    if (mismatches.length > 0) {
      fail('manifest_mismatch', mismatches.join(', '));
    }
  }
  const pages: NandPageRead[] = [];
  for (let i = 0; i < header.pagesN; i += 1) {
    const at = POD_RAW_HEADER_LENGTH + i * POD_RAW_ENTRY_LENGTH;
    const entry = new ByteReader(bytes.subarray(at, at + POD_RAW_ENTRY_HEADER_LENGTH));
    const physicalPage = entry.u32();
    const ecc: EccStatus | undefined = ECC_STATUSES[entry.u8()];
    if (ecc === undefined) {
      fail('invalid_container', 'unknown ECC status');
    }
    if (entry.raw(3).some((b) => b !== 0)) {
      fail('reserved_bits_set', 'pod_raw entry');
    }
    pages.push({
      physicalPage,
      ecc,
      data: bytes.slice(at + POD_RAW_ENTRY_HEADER_LENGTH, at + POD_RAW_ENTRY_LENGTH),
    });
  }
  return { header, pages };
}

/** A `pod_raw` file cut down to some of its pages (`slicePodRawFile`). */
export interface SlicedPodRaw {
  bytes: Uint8Array;
  firstPageSeq: number;
  lastPageSeq: number;
  pagesN: number;
  sha256Hex: string;
}

/**
 * The one-time trim of a pending `pod_raw` (ADR 0106, amendment to ADR
 * 0005): a new container with only the entries of `keepPhysicalPages`, byte
 * for byte as they were (still encrypted and MACed: nothing is re-sealed, so
 * no CTR IV is ever reused), with the header's page range and count of what
 * was kept. `null` when nothing is kept. Every kept page must have a
 * readable header (the decoder already opened it).
 */
export function slicePodRawFile(
  bytes: Uint8Array,
  keepPhysicalPages: ReadonlySet<number>,
): SlicedPodRaw | null {
  const { pages } = readPodRawFile(bytes);
  const kept: { index: number; pageSeq: number }[] = [];
  pages.forEach((page, index) => {
    if (keepPhysicalPages.has(page.physicalPage)) {
      kept.push({ index, pageSeq: decodeLogPageHeader(page.data).pageSeq });
    }
  });
  if (kept.length === 0) {
    return null;
  }
  const firstPageSeq = Math.min(...kept.map((k) => k.pageSeq));
  const lastPageSeq = Math.max(...kept.map((k) => k.pageSeq));
  const out = new Uint8Array(POD_RAW_HEADER_LENGTH + kept.length * POD_RAW_ENTRY_LENGTH);
  out.set(bytes.subarray(0, POD_RAW_HEADER_LENGTH), 0);
  const w = new ByteWriter(12).u32(firstPageSeq).u32(lastPageSeq).u32(kept.length);
  out.set(w.finish(), 24);
  kept.forEach((k, i) => {
    const at = POD_RAW_HEADER_LENGTH + k.index * POD_RAW_ENTRY_LENGTH;
    out.set(
      bytes.subarray(at, at + POD_RAW_ENTRY_LENGTH),
      POD_RAW_HEADER_LENGTH + i * POD_RAW_ENTRY_LENGTH,
    );
  });
  // Same device, boot and segment: the rest of the header is copied as it was.
  return { bytes: out, firstPageSeq, lastPageSeq, pagesN: kept.length, sha256Hex: sha256Hex(out) };
}

/**
 * Idempotency key of the ingestion: one `pod_raw` per (DEVICEID, boot,
 * segment). A second upload of the same segment is the same file (same
 * SHA-256) or a conflict, never a second copy.
 */
export function podRawIngestKey(manifest: PodRawManifest): string {
  return `${manifest.deviceIdHex.toLowerCase()}/${String(manifest.bootCounter)}/${String(manifest.segmentId)}`;
}

export type UploadVerification =
  | { ok: true; command: EraseCommand }
  | {
      ok: false;
      reason:
        | 'segment_missing'
        | 'more_than_one_segment'
        | 'page_range_mismatch'
        | 'blocks_mismatch'
        | 'pages_not_authentic'
        | 'segment_not_closed';
    };

/**
 * What the server checks before signing an erase command, after
 * `readPodRawFile(bytes, manifest)` and `decodeLog` **with the storage keys**
 * on that file: the file holds exactly the manifest's segment, every page the
 * pod's scan counted as valid also passed the CMAC (`authenticPagesN`), the
 * page range matches, the physical pages of the file are in the manifest's
 * blocks, and the segment is closed (by its last page or, after a power loss,
 * by the recovery close the pod writes at the next boot): never on the dock's
 * word.
 * The command it returns names the segment exactly; the pod erases only if its
 * own scan still matches (`eraseDecision`).
 */
export function verifyUploadForErase(input: {
  manifest: PodRawManifest;
  /** The pages of the file (`readPodRawFile`): their physical addresses must be the manifest's blocks. */
  pages: readonly NandPageRead[];
  decoded: DecodedLog;
  pagesPerBlock?: number;
}): UploadVerification {
  const { manifest, decoded } = input;
  const pagesPerBlock = input.pagesPerBlock ?? 64;
  if (decoded.segments.length > 1) {
    return { ok: false, reason: 'more_than_one_segment' };
  }
  const segment = decoded.segments[0];
  if (
    segment?.deviceIdHex !== manifest.deviceIdHex.toLowerCase() ||
    segment.bootCounter !== manifest.bootCounter ||
    segment.segmentId !== manifest.segmentId
  ) {
    return { ok: false, reason: 'segment_missing' };
  }
  if (
    segment.firstPageSeq !== manifest.firstPageSeq ||
    segment.lastPageSeq !== manifest.lastPageSeq
  ) {
    return { ok: false, reason: 'page_range_mismatch' };
  }
  if (
    segment.authenticPagesN !== manifest.validPagesN ||
    decoded.pageIssues.some((i) => i.reason === 'mac_mismatch' || i.reason === 'unknown_key_epoch')
  ) {
    return { ok: false, reason: 'pages_not_authentic' };
  }
  const fileBlocks = [
    ...new Set(input.pages.map((p) => Math.floor(p.physicalPage / pagesPerBlock))),
  ].sort((a, b) => a - b);
  const manifestBlocks = [...manifest.blocks].sort((a, b) => a - b);
  if (
    fileBlocks.length !== manifestBlocks.length ||
    fileBlocks.some((b, i) => b !== manifestBlocks[i])
  ) {
    return { ok: false, reason: 'blocks_mismatch' };
  }
  // Closed by its own last page or by the pod's recovery close (both under the CMAC).
  if (!segment.closed) {
    return { ok: false, reason: 'segment_not_closed' };
  }
  return {
    ok: true,
    command: {
      deviceIdHex: manifest.deviceIdHex.toLowerCase(),
      bootCounter: manifest.bootCounter,
      segmentId: manifest.segmentId,
      firstPageSeq: manifest.firstPageSeq,
      lastPageSeq: manifest.lastPageSeq,
      validPagesN: manifest.validPagesN,
      blocks: [...manifest.blocks],
      sha256Hex: manifest.sha256Hex.toLowerCase(),
    },
  };
}
