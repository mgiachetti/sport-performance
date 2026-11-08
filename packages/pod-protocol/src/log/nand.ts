import {
  asciiBytes,
  assertUint,
  ByteReader,
  ByteWriter,
  equalBytes,
  fromHex,
  toHex,
} from '../bytes.js';
import { fail } from '../errors.js';
import { W25N04KV, type NandGeometry } from './constants.js';
import type { NandPageRead } from './decoder.js';
import { inspectLogPage } from './page.js';

/**
 * Keyless scan of the NAND and the storage rules of ADR 0106 ("Log en la NAND",
 * "Minimización en la base"), as pure functions the firmware mirrors and the
 * dock and the tests use:
 *
 * - a recording segment always **starts on an erased block** and owns its
 *   blocks, so erasing a segment never touches another one;
 * - blocks are only taken from the erased ones: **nothing undownloaded is ever
 *   overwritten**; with no erased block left the pod stops recording;
 * - a segment is erased only with a signed erase command naming exactly the
 *   segment the pod still sees and the SHA-256 of the uploaded `pod_raw`,
 *   with one exception: a segment that overlaps no session is erased without
 *   upload after N days;
 * - bad blocks (factory marker, W25N LUT or grown) are never written or read.
 */

export type PageScanStatus =
  'valid' | 'erased' | 'torn_write' | 'crc_mismatch' | 'invalid_header' | 'uncorrectable_ecc';

export interface SegmentSummary {
  deviceIdHex: string;
  bootCounter: number;
  segmentId: number;
  keyEpochs: number[];
  firstPageSeq: number;
  lastPageSeq: number;
  pagesN: number;
  /** Blocks holding pages of the segment, ascending. */
  blocks: number[];
  /** A page with the segment-end flag was found. */
  closed: boolean;
  /** End of the stream according to the last valid page. */
  streamBytes: number;
}

export interface NandScan {
  geometry: NandGeometry;
  segments: SegmentSummary[];
  badBlocks: number[];
  /** Usable blocks whose every page was read and is erased: the only ones a pod may write. */
  freeBlocks: number[];
  /**
   * Usable blocks with no programmed page among those read but not every page
   * read: their state is unknown, so they are neither free nor erasable.
   */
  unknownBlocks: number[];
  /** Blocks with programmed pages none of which is a valid log page (debris of a cut write). */
  orphanBlocks: number[];
  /** Blocks with valid pages of more than one segment (should never happen; never erased). */
  mixedBlocks: number[];
  /** Pages per status (erased included). */
  pageCounts: Record<PageScanStatus, number>;
  /** Highest page sequence on the chip; the pod resumes above it (and above its reservation). */
  highestPageSeq: number | null;
  /** Highest segment id on the chip. */
  highestSegmentId: number | null;
}

function segmentKey(deviceIdHex: string, bootCounter: number, segmentId: number): string {
  return `${deviceIdHex}/${String(bootCounter)}/${String(segmentId)}`;
}

/**
 * Scans the pages of the chip without keys (the dock never has any): CRC,
 * header, ECC status. A block is free only if all its pages were read and are
 * erased; a page that is not given is never assumed erased.
 */
export function scanNand(input: {
  pages: readonly NandPageRead[];
  geometry?: NandGeometry;
  badBlocks?: readonly number[];
}): NandScan {
  const geometry = input.geometry ?? W25N04KV;
  const bad = new Set(input.badBlocks ?? []);
  const counts: Record<PageScanStatus, number> = {
    valid: 0,
    erased: 0,
    torn_write: 0,
    crc_mismatch: 0,
    invalid_header: 0,
    uncorrectable_ecc: 0,
  };
  const programmedBlocks = new Set<number>();
  /** Distinct pages read erased, per block. */
  const erasedPages = new Map<number, Set<number>>();
  const blocksWithValid = new Map<number, Set<string>>();
  const segments = new Map<string, SegmentSummary>();
  let highestPageSeq: number | null = null;
  let highestSegmentId: number | null = null;

  for (const read of input.pages) {
    const block = Math.floor(read.physicalPage / geometry.pagesPerBlock);
    if (bad.has(block) || block < geometry.reservedBlocks) {
      continue;
    }
    if (read.ecc === 'uncorrectable') {
      counts.uncorrectable_ecc += 1;
      programmedBlocks.add(block);
      continue;
    }
    const inspection = inspectLogPage(read.data);
    if (inspection.status === 'erased') {
      counts.erased += 1;
      const set = erasedPages.get(block) ?? new Set<number>();
      set.add(read.physicalPage);
      erasedPages.set(block, set);
      continue;
    }
    programmedBlocks.add(block);
    if (inspection.status === 'crc_mismatch') {
      counts[inspection.torn ? 'torn_write' : 'crc_mismatch'] += 1;
      continue;
    }
    if (inspection.status === 'invalid_header') {
      counts.invalid_header += 1;
      continue;
    }
    counts.valid += 1;
    const { header } = inspection;
    const deviceIdHex = toHex(header.deviceId);
    const key = segmentKey(deviceIdHex, header.bootCounter, header.segmentId);
    const inBlock = blocksWithValid.get(block) ?? new Set<string>();
    inBlock.add(key);
    blocksWithValid.set(block, inBlock);
    highestPageSeq = Math.max(highestPageSeq ?? 0, header.pageSeq);
    highestSegmentId = Math.max(highestSegmentId ?? 0, header.segmentId);
    const end = header.streamOffset + header.payloadLength;
    const existing = segments.get(key);
    if (!existing) {
      segments.set(key, {
        deviceIdHex,
        bootCounter: header.bootCounter,
        segmentId: header.segmentId,
        keyEpochs: [header.keyEpoch],
        firstPageSeq: header.pageSeq,
        lastPageSeq: header.pageSeq,
        pagesN: 1,
        blocks: [block],
        closed: header.segmentEnd,
        streamBytes: end,
      });
    } else {
      existing.pagesN += 1;
      existing.firstPageSeq = Math.min(existing.firstPageSeq, header.pageSeq);
      existing.lastPageSeq = Math.max(existing.lastPageSeq, header.pageSeq);
      if (!existing.keyEpochs.includes(header.keyEpoch)) {
        existing.keyEpochs.push(header.keyEpoch);
      }
      if (!existing.blocks.includes(block)) {
        existing.blocks.push(block);
      }
      existing.closed ||= header.segmentEnd;
      existing.streamBytes = Math.max(existing.streamBytes, end);
    }
  }

  // Programmed pages that are not valid still belong to the segment whose
  // valid pages share their block (a torn last page, say).
  const freeBlocks: number[] = [];
  const unknownBlocks: number[] = [];
  const orphanBlocks: number[] = [];
  const mixedBlocks: number[] = [];
  for (let block = geometry.reservedBlocks; block < geometry.blocks; block += 1) {
    if (bad.has(block)) {
      continue;
    }
    if (!programmedBlocks.has(block)) {
      if ((erasedPages.get(block)?.size ?? 0) === geometry.pagesPerBlock) {
        freeBlocks.push(block);
      } else {
        unknownBlocks.push(block);
      }
      continue;
    }
    const owners = blocksWithValid.get(block);
    if (!owners) {
      orphanBlocks.push(block);
    } else if (owners.size > 1) {
      mixedBlocks.push(block);
    }
  }
  const list = [...segments.values()]
    .map((s) => ({
      ...s,
      keyEpochs: [...s.keyEpochs].sort((a, b) => a - b),
      blocks: [...s.blocks].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.firstPageSeq - b.firstPageSeq);
  return {
    geometry,
    segments: list,
    badBlocks: [...bad].sort((a, b) => a - b),
    freeBlocks,
    unknownBlocks,
    orphanBlocks,
    mixedBlocks,
    pageCounts: counts,
    highestPageSeq,
    highestSegmentId,
  };
}

/**
 * Next block to write: the lowest usable block read entirely erased (wear
 * levelling is the firmware's choice among those; it never picks a programmed
 * or an unread one).
 * `null` = memory full: the pod stops recording, shows it on the LED and the
 * app tells the staff.
 */
export function nextWritableBlock(scan: NandScan, afterBlock = -1): number | null {
  return scan.freeBlocks.find((b) => b > afterBlock) ?? scan.freeBlocks[0] ?? null;
}

// ---------------------------------------------------------------------------
// Erase: bound to exactly what was uploaded and verified
// ---------------------------------------------------------------------------

/**
 * What the server signs (ECDSA P-256 with the key pinned in the pod, ADR 0106)
 * to let a pod erase one segment. It names the segment exactly as the pod's
 * own scan sees it; the pod erases only if its scan still matches.
 */
export interface EraseCommand {
  deviceIdHex: string;
  bootCounter: number;
  segmentId: number;
  firstPageSeq: number;
  lastPageSeq: number;
  /** Pages with a valid CRC and header in the pod's scan (`SegmentSummary.pagesN`). */
  validPagesN: number;
  /** Blocks of the segment, ascending. */
  blocks: number[];
  /** SHA-256 of the `pod_raw` file the server verified. */
  sha256Hex: string;
}

export const ERASE_COMMAND_MAGIC = asciiBytes('SPER');
export const ERASE_COMMAND_VERSION = 1;

/**
 * Canonical bytes of an erase command (what the server signs):
 *
 * ```
 * 0..3    magic "SPER"
 * 4       version (1)
 * 5..12   DEVICEID
 * 13..16  boot counter (u32)
 * 17..20  segment id (u32)
 * 21..24  first page sequence (u32)
 * 25..28  last page sequence (u32)
 * 29..32  valid pages (u32)
 * 33..64  SHA-256 of the pod_raw file
 * 65..66  block count N (u16)
 * 67…     N × block (u16, ascending)
 * ```
 */
export function encodeEraseCommand(command: EraseCommand): Uint8Array {
  const deviceId = fromHex(command.deviceIdHex);
  const sha = fromHex(command.sha256Hex);
  if (deviceId.length !== 8 || sha.length !== 32) {
    fail('field_out_of_range', 'deviceIdHex must be 8 B and sha256Hex 32 B');
  }
  assertUint('bootCounter', command.bootCounter, 32);
  assertUint('segmentId', command.segmentId, 32);
  assertUint('firstPageSeq', command.firstPageSeq, 32);
  assertUint('lastPageSeq', command.lastPageSeq, 32);
  assertUint('validPagesN', command.validPagesN, 32);
  assertUint('blocks.length', command.blocks.length, 16);
  const w = new ByteWriter(67 + 2 * command.blocks.length)
    .raw(ERASE_COMMAND_MAGIC)
    .u8(ERASE_COMMAND_VERSION)
    .raw(deviceId)
    .u32(command.bootCounter)
    .u32(command.segmentId)
    .u32(command.firstPageSeq)
    .u32(command.lastPageSeq)
    .u32(command.validPagesN)
    .raw(sha)
    .u16(command.blocks.length);
  let previous = -1;
  for (const block of command.blocks) {
    assertUint('block', block, 16);
    if (block <= previous) {
      fail('field_out_of_range', 'blocks must be ascending and distinct');
    }
    previous = block;
    w.u16(block);
  }
  return w.finish();
}

export function decodeEraseCommand(bytes: Uint8Array): EraseCommand {
  const r = new ByteReader(bytes);
  if (!equalBytes(r.raw(4), ERASE_COMMAND_MAGIC)) {
    fail('invalid_container', 'not an erase command');
  }
  const version = r.u8();
  if (version !== ERASE_COMMAND_VERSION) {
    fail('unsupported_version', `erase command ${String(version)}`);
  }
  const deviceIdHex = toHex(r.raw(8));
  const bootCounter = r.u32();
  const segmentId = r.u32();
  const firstPageSeq = r.u32();
  const lastPageSeq = r.u32();
  const validPagesN = r.u32();
  const sha256Hex = toHex(r.raw(32));
  const count = r.u16();
  const blocks = Array.from({ length: count }, () => r.u16());
  r.end();
  const command: EraseCommand = {
    deviceIdHex,
    bootCounter,
    segmentId,
    firstPageSeq,
    lastPageSeq,
    validPagesN,
    blocks,
    sha256Hex,
  };
  // Validates the block order.
  encodeEraseCommand(command);
  return command;
}

/** Whether a (signature-verified) erase command names exactly this segment of the pod's scan. */
export function eraseCommandMatches(command: EraseCommand, segment: SegmentSummary): boolean {
  return (
    command.deviceIdHex.toLowerCase() === segment.deviceIdHex.toLowerCase() &&
    command.bootCounter === segment.bootCounter &&
    command.segmentId === segment.segmentId &&
    command.firstPageSeq === segment.firstPageSeq &&
    command.lastPageSeq === segment.lastPageSeq &&
    command.validPagesN === segment.pagesN &&
    command.blocks.length === segment.blocks.length &&
    command.blocks.every((b, i) => b === segment.blocks[i])
  );
}

export interface SegmentRetentionInput {
  /** The segment as the pod's own scan sees it right now. */
  segment: SegmentSummary;
  /** Segment the pod is recording right now (never erased). */
  recording: boolean;
  /** End of the segment (Unix ms, from the pod's index), `null` if unknown. */
  endedAtUnixMs: number | null;
  /**
   * Whether the segment overlaps a session window of the club. `null` = the
   * dock could not ask the server (offline): nothing is erased by age.
   */
  overlapsSession: boolean | null;
  /** SHA-256 of the `pod_raw` file the dock built and uploaded, `null` if not uploaded. */
  uploadedSha256Hex: string | null;
  /**
   * Erase command from the server, passed only **after** the pod verified its
   * signature with the pinned server key; `null` = not confirmed.
   */
  eraseCommand: EraseCommand | null;
}

export type EraseDecision =
  | { erase: true; reason: 'server_confirmed' | 'off_session_expired'; blocks: number[] }
  | {
      erase: false;
      reason:
        | 'recording'
        | 'awaiting_upload'
        | 'awaiting_confirmation'
        | 'sha_mismatch'
        | 'command_mismatch'
        | 'retained_off_session'
        | 'overlap_unknown';
    };

const DAY_MS = 86_400_000;

/**
 * The erase rule of ADR 0106: only with a signed erase command from the server
 * that names exactly this segment (DEVICEID, boot, segment, page range, valid
 * pages, blocks) as the pod's own scan sees it, and the SHA-256 of the file
 * that was uploaded. The single exception is a segment that overlaps no
 * session, erased without upload once it is `offSessionRetentionDays` old
 * (club setting).
 */
export function eraseDecision(
  input: SegmentRetentionInput & { nowUnixMs: number; offSessionRetentionDays: number },
): EraseDecision {
  if (input.recording) {
    return { erase: false, reason: 'recording' };
  }
  const command = input.eraseCommand;
  if (command !== null) {
    if (command.sha256Hex.toLowerCase() !== input.uploadedSha256Hex?.toLowerCase()) {
      return { erase: false, reason: 'sha_mismatch' };
    }
    if (!eraseCommandMatches(command, input.segment)) {
      return { erase: false, reason: 'command_mismatch' };
    }
    return { erase: true, reason: 'server_confirmed', blocks: [...command.blocks] };
  }
  if (input.overlapsSession === true) {
    return {
      erase: false,
      reason: input.uploadedSha256Hex === null ? 'awaiting_upload' : 'awaiting_confirmation',
    };
  }
  if (input.overlapsSession === null || input.endedAtUnixMs === null) {
    return { erase: false, reason: 'overlap_unknown' };
  }
  if (input.uploadedSha256Hex !== null) {
    // Uploaded anyway (a session loaded late): wait for the confirmation.
    return { erase: false, reason: 'awaiting_confirmation' };
  }
  const ageMs = input.nowUnixMs - input.endedAtUnixMs;
  return ageMs >= input.offSessionRetentionDays * DAY_MS
    ? { erase: true, reason: 'off_session_expired', blocks: [...input.segment.blocks] }
    : { erase: false, reason: 'retained_off_session' };
}

/**
 * Blocks to erase given a decision per segment (keyed by `segmentKeyOf`). Only
 * the blocks a decision names that are still the segment's blocks in this
 * scan, and only if every segment with pages in them is erasable; mixed,
 * unknown and orphan blocks are kept (orphans go only with
 * `eraseOrphanBlocks`, after the dock uploaded them for diagnosis).
 */
export function planErase(
  scan: NandScan,
  decisions: ReadonlyMap<string, EraseDecision>,
  options: { eraseOrphanBlocks?: boolean } = {},
): number[] {
  const keepers = new Set<number>([...scan.mixedBlocks, ...scan.unknownBlocks]);
  const candidates = new Set<number>();
  for (const segment of scan.segments) {
    const decision = decisions.get(segmentKeyOf(segment));
    const named = decision?.erase ? new Set(decision.blocks) : new Set<number>();
    for (const block of segment.blocks) {
      if (named.has(block)) {
        candidates.add(block);
      } else {
        keepers.add(block);
      }
    }
  }
  if (options.eraseOrphanBlocks) {
    for (const block of scan.orphanBlocks) {
      candidates.add(block);
    }
  }
  return [...candidates].filter((b) => !keepers.has(b)).sort((a, b) => a - b);
}

export function segmentKeyOf(segment: {
  deviceIdHex: string;
  bootCounter: number;
  segmentId: number;
}): string {
  return segmentKey(segment.deviceIdHex, segment.bootCounter, segment.segmentId);
}

export interface TimeWindow {
  startUnixMs: number;
  endUnixMs: number;
}

/** Whether a segment overlaps any session window (with a margin on both sides). */
export function overlapsAny(
  segment: TimeWindow,
  windows: readonly TimeWindow[],
  marginMs = 0,
): boolean {
  return windows.some(
    (w) =>
      segment.startUnixMs <= w.endUnixMs + marginMs &&
      segment.endUnixMs >= w.startUnixMs - marginMs,
  );
}

/**
 * Minimisation at the dock: of the segments in the pod's index, the ones that
 * overlap a session window of the club are uploaded; the rest stay encrypted on
 * the pod until `eraseDecision` lets them go.
 */
export function selectSegmentsToUpload<T extends TimeWindow>(
  segments: readonly T[],
  sessionWindows: readonly TimeWindow[],
  marginMs = 0,
): T[] {
  return segments.filter((s) => overlapsAny(s, sessionWindows, marginMs));
}
