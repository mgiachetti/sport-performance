import { toHex } from '../bytes.js';
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
 * - a segment is erased only when the server confirmed the SHA-256 of its
 *   `pod_raw` file, with one exception: a segment that overlaps no session is
 *   erased without upload after N days;
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
  /** Usable blocks with every page erased. */
  freeBlocks: number[];
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
 * header, ECC status. `pages` must cover every page of the usable blocks: a
 * page that is not given counts as erased.
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
  const orphanBlocks: number[] = [];
  const mixedBlocks: number[] = [];
  for (let block = geometry.reservedBlocks; block < geometry.blocks; block += 1) {
    if (bad.has(block)) {
      continue;
    }
    if (!programmedBlocks.has(block)) {
      freeBlocks.push(block);
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
    orphanBlocks,
    mixedBlocks,
    pageCounts: counts,
    highestPageSeq,
    highestSegmentId,
  };
}

/**
 * Next block to write: the lowest erased usable block (wear levelling is the
 * firmware's choice among erased blocks; it never picks a programmed one).
 * `null` = memory full: the pod stops recording, shows it on the LED and the
 * app tells the staff.
 */
export function nextWritableBlock(scan: NandScan, afterBlock = -1): number | null {
  return scan.freeBlocks.find((b) => b > afterBlock) ?? scan.freeBlocks[0] ?? null;
}

export interface SegmentRetentionInput {
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
  /** SHA-256 the server confirmed after storing the file, `null` = not confirmed. */
  serverConfirmedSha256Hex: string | null;
}

export type EraseDecision =
  | { erase: true; reason: 'server_confirmed' | 'off_session_expired' }
  | {
      erase: false;
      reason:
        | 'recording'
        | 'awaiting_upload'
        | 'awaiting_confirmation'
        | 'sha_mismatch'
        | 'retained_off_session'
        | 'overlap_unknown';
    };

const DAY_MS = 86_400_000;

/**
 * The erase rule of ADR 0106: only with the server's SHA-256 confirmation; the
 * single exception is a segment that overlaps no session, erased without upload
 * once it is `offSessionRetentionDays` old (club setting).
 */
export function eraseDecision(
  input: SegmentRetentionInput & { nowUnixMs: number; offSessionRetentionDays: number },
): EraseDecision {
  if (input.recording) {
    return { erase: false, reason: 'recording' };
  }
  if (input.serverConfirmedSha256Hex !== null) {
    if (
      input.uploadedSha256Hex !== null &&
      input.serverConfirmedSha256Hex.toLowerCase() === input.uploadedSha256Hex.toLowerCase()
    ) {
      return { erase: true, reason: 'server_confirmed' };
    }
    return { erase: false, reason: 'sha_mismatch' };
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
    ? { erase: true, reason: 'off_session_expired' }
    : { erase: false, reason: 'retained_off_session' };
}

/**
 * Blocks to erase given a decision per segment (keyed by `segmentKeyOf`). A
 * block is erased only if every segment with pages in it is erasable; mixed
 * blocks and orphan blocks are kept unless `eraseOrphanBlocks` (after the dock
 * uploaded them for diagnosis).
 */
export function planErase(
  scan: NandScan,
  decisions: ReadonlyMap<string, EraseDecision>,
  options: { eraseOrphanBlocks?: boolean } = {},
): number[] {
  const keepers = new Set<number>(scan.mixedBlocks);
  const candidates = new Set<number>();
  for (const segment of scan.segments) {
    const decision = decisions.get(segmentKeyOf(segment));
    for (const block of segment.blocks) {
      if (decision?.erase) {
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
