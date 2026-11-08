import { describe, expect, it } from 'vitest';

import { toHex } from '../bytes.js';
import {
  keysFor,
  NandSimulator,
  syntheticSession,
  TEST_DEVICE_ID,
  writeSegment,
} from '../testing/log-samples.js';
import { decodeLog } from './decoder.js';
import { LOG_PAGE_CRC_OFFSET, W25N04KV } from './constants.js';
import {
  decodeEraseCommand,
  encodeEraseCommand,
  eraseDecision,
  type EraseCommand,
  nextWritableBlock,
  overlapsAny,
  planErase,
  scanNand,
  segmentKeyOf,
  selectSegmentsToUpload,
  type EraseDecision,
} from './nand.js';
import { writePageCrc } from './page.js';
import {
  buildPodRawFile,
  podRawIngestKey,
  readPodRawFile,
  sha256Hex,
  verifyUploadForErase,
} from './pod-raw.js';

const DAY_MS = 86_400_000;

function filledNand() {
  const nand = new NandSimulator();
  nand.badBlocks.add(10);
  const a = writeSegment(syntheticSession({ durationS: 100 }), { segmentId: 5, firstPageSeq: 100 });
  const b = writeSegment(syntheticSession({ durationS: 5 }), {
    bootCounter: 70_001,
    segmentId: 6,
    firstPageSeq: 1_000,
  });
  const pa = nand.writeSegment(a);
  const pb = nand.writeSegment(b);
  return { nand, a, b, pa, pb };
}

describe('scanNand', () => {
  it('indexes segments, blocks and free space without a key', () => {
    const { nand, a, b, pa, pb } = filledNand();
    const scan = scanNand({ pages: nand.dump(), geometry: nand.geometry, badBlocks: [10] });
    expect(scan.segments.map((s) => [s.segmentId, s.pagesN, s.blocks, s.closed])).toEqual([
      [5, a.length, [8, 9, 11], true],
      [6, b.length, [Math.floor((pb[0] ?? 0) / 64)], true],
    ]);
    // Segment b started on a fresh block, never sharing with a.
    expect(Math.floor((pb[0] ?? 0) / 64)).toBeGreaterThan(Math.floor((pa.at(-1) ?? 0) / 64));
    expect(scan.segments[0]?.deviceIdHex).toBe(toHex(TEST_DEVICE_ID));
    expect(scan.badBlocks).toEqual([10]);
    expect(scan.mixedBlocks).toEqual([]);
    expect(scan.orphanBlocks).toEqual([]);
    expect(scan.highestPageSeq).toBe(1_000 + b.length - 1);
    expect(scan.highestSegmentId).toBe(6);
    expect(scan.freeBlocks[0]).toBe(Math.floor((pb[0] ?? 0) / 64) + 1);
    expect(scan.pageCounts.valid).toBe(a.length + b.length);
  });

  it('the rebuilt index matches what the decoder sees, with time ranges', () => {
    const { nand } = filledNand();
    const scan = scanNand({ pages: nand.dump(), geometry: nand.geometry, badBlocks: [10] });
    const decoded = decodeLog({
      pages: nand.dump(),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
      badBlocks: [10],
    });
    expect(
      decoded.segments.map((s) => [s.segmentId, s.firstPageSeq, s.lastPageSeq, s.pagesN]),
    ).toEqual(scan.segments.map((s) => [s.segmentId, s.firstPageSeq, s.lastPageSeq, s.pagesN]));
    expect(decoded.segments.every((s) => s.gnssTimeRange !== null)).toBe(true);
  });

  it('a torn last page stays with its segment; debris alone in a block is an orphan', () => {
    const { nand, pb } = filledNand();
    const last = pb.at(-1) ?? 0;
    const torn = nand.pages.get(last)?.data.slice() ?? new Uint8Array();
    torn.fill(0xff, 1000);
    nand.pages.set(last, { physicalPage: last, data: torn, ecc: 'ok' });
    const debrisBlock = 20;
    nand.pages.set(debrisBlock * 64, { physicalPage: debrisBlock * 64, data: torn, ecc: 'ok' });
    const scan = scanNand({ pages: nand.dump(), geometry: nand.geometry, badBlocks: [10] });
    expect(scan.segments[1]?.closed).toBe(false);
    expect(scan.pageCounts.torn_write).toBe(2);
    expect(scan.orphanBlocks).toEqual([debrisBlock]);
    expect(scan.freeBlocks).not.toContain(debrisBlock);
  });

  it('memory full: no erased block left means stop recording', () => {
    const nand = new NandSimulator({ ...new NandSimulator().geometry, blocks: 10 });
    const pages = writeSegment(syntheticSession({ durationS: 60 }));
    expect(Math.ceil(pages.length / 64)).toBe(2);
    nand.writeSegment(pages);
    const scan = scanNand({ pages: nand.dump(), geometry: nand.geometry });
    expect(scan.freeBlocks).toEqual([]);
    expect(nextWritableBlock(scan)).toBeNull();
    expect(() => nand.writeSegment(pages)).toThrow('memory full');
  });

  it('nextWritableBlock never returns a programmed block', () => {
    const { nand } = filledNand();
    const scan = scanNand({ pages: nand.dump(), geometry: nand.geometry, badBlocks: [10] });
    const programmed = new Set(scan.segments.flatMap((s) => s.blocks));
    const next = nextWritableBlock(scan);
    expect(next).not.toBeNull();
    expect(programmed.has(next ?? -1)).toBe(false);
    expect(nextWritableBlock(scan, 1_000)).toBe(scan.freeBlocks[0]);
  });
  it('a page that was not read is never assumed erased', () => {
    const empty = scanNand({ pages: [] });
    expect(empty.freeBlocks).toEqual([]);
    expect(empty.unknownBlocks).toHaveLength(W25N04KV.blocks - W25N04KV.reservedBlocks);
    expect(nextWritableBlock(empty)).toBeNull();

    // A block read except one page: unknown, not free, and never erased.
    const { nand } = filledNand();
    const partial = nand.dump().filter((p) => p.physicalPage !== 20 * 64 + 5);
    const scan = scanNand({ pages: partial, geometry: nand.geometry, badBlocks: [10] });
    expect(scan.freeBlocks).not.toContain(20);
    expect(scan.unknownBlocks).toEqual([20]);
  });
});

function setupErase() {
  const { nand } = filledNand();
  const dump = nand.dump();
  const scan = scanNand({ pages: dump, geometry: nand.geometry, badBlocks: [10] });
  const [a, b] = scan.segments;
  if (!a || !b) throw new Error('two segments expected');
  const blockPages = (blocks: number[]) =>
    dump.filter(
      (p) => blocks.includes(Math.floor(p.physicalPage / 64)) && !p.data.every((x) => x === 0xff),
    );
  const fileA = buildPodRawFile({
    segment: a,
    pages: blockPages(a.blocks),
    podSerial: 'ORC-0001',
    startUnixMs: null,
    endUnixMs: null,
  });
  return { nand, scan, a, b, fileA };
}

describe('erase rules', () => {
  const now = Date.UTC(2026, 10, 8);
  const { scan, a, b, fileA } = setupErase();
  const verified = verifyUploadForErase({
    manifest: fileA.manifest,
    decoded: decodeLog({
      pages: readPodRawFile(fileA.bytes, fileA.manifest).pages,
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    }),
    podCurrentBootCounter: 70_000,
  });
  if (!verified.ok) throw new Error(verified.reason);
  const command: EraseCommand = verified.command;
  const base = {
    segment: a,
    recording: false,
    endedAtUnixMs: now - DAY_MS,
    overlapsSession: true,
    uploadedSha256Hex: fileA.manifest.sha256Hex,
    eraseCommand: null,
    nowUnixMs: now,
    offSessionRetentionDays: 7,
  } as const;

  it('the server signs only what it decoded valid and closed', () => {
    expect(command).toEqual({
      deviceIdHex: a.deviceIdHex,
      bootCounter: a.bootCounter,
      segmentId: a.segmentId,
      firstPageSeq: a.firstPageSeq,
      lastPageSeq: a.lastPageSeq,
      validPagesN: a.pagesN,
      blocks: a.blocks,
      sha256Hex: sha256Hex(fileA.bytes),
    });
    expect(decodeEraseCommand(encodeEraseCommand(command))).toEqual(command);
    expect(podRawIngestKey(fileA.manifest)).toBe(`${a.deviceIdHex}/70000/5`);

    // A page that passes the CRC but not the CMAC: not confirmed.
    const { pages } = readPodRawFile(fileA.bytes, fileA.manifest);
    const forged = pages.map((p, i) => {
      if (i !== 2) return p;
      const data = p.data.slice();
      data[100] = (data[100] ?? 0) ^ 1;
      data.set(writePageCrc(data), LOG_PAGE_CRC_OFFSET);
      return { ...p, data };
    });
    const decodedForged = decodeLog({
      pages: forged,
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(
      verifyUploadForErase({
        manifest: fileA.manifest,
        decoded: decodedForged,
        podCurrentBootCounter: 70_000,
      }),
    ).toEqual({ ok: false, reason: 'pages_not_authentic' });

    // Not closed (torn end) in the current boot: wait; from an earlier boot: it will never close.
    const unclosed = pages.map((p, i) =>
      i === pages.length - 1 ? { ...p, data: p.data.slice().fill(0xff, 1000) } : p,
    );
    const decodedUnclosed = decodeLog({
      pages: unclosed,
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    const manifestUnclosed = { ...fileA.manifest, validPagesN: fileA.manifest.validPagesN - 1 };
    const lastSeq = decodedUnclosed.segments[0]?.lastPageSeq ?? 0;
    const m = { ...manifestUnclosed, lastPageSeq: lastSeq };
    expect(
      verifyUploadForErase({
        manifest: m,
        decoded: decodedUnclosed,
        podCurrentBootCounter: 70_000,
      }),
    ).toEqual({ ok: false, reason: 'segment_not_closed' });
    expect(
      verifyUploadForErase({ manifest: m, decoded: decodedUnclosed, podCurrentBootCounter: 70_002 })
        .ok,
    ).toBe(true);
  });

  it('erases only with a signed command naming exactly the segment the pod sees', () => {
    expect(eraseDecision({ ...base })).toEqual({ erase: false, reason: 'awaiting_confirmation' });
    expect(eraseDecision({ ...base, uploadedSha256Hex: null })).toEqual({
      erase: false,
      reason: 'awaiting_upload',
    });
    expect(eraseDecision({ ...base, eraseCommand: command })).toEqual({
      erase: true,
      reason: 'server_confirmed',
      blocks: a.blocks,
    });
    expect(
      eraseDecision({ ...base, eraseCommand: { ...command, sha256Hex: 'cd'.repeat(32) } }),
    ).toEqual({ erase: false, reason: 'sha_mismatch' });
    // The pod's scan no longer matches what was uploaded (a page more, another block…).
    for (const changed of [
      { ...command, validPagesN: command.validPagesN + 1 },
      { ...command, lastPageSeq: command.lastPageSeq + 1 },
      { ...command, blocks: [...command.blocks, 30] },
      { ...command, segmentId: 6 },
    ]) {
      expect(eraseDecision({ ...base, eraseCommand: changed })).toEqual({
        erase: false,
        reason: 'command_mismatch',
      });
    }
    expect(eraseDecision({ ...base, recording: true, eraseCommand: command })).toEqual({
      erase: false,
      reason: 'recording',
    });
  });

  it('the single exception: off-session segments go after N days without upload', () => {
    const off = { ...base, overlapsSession: false, uploadedSha256Hex: null };
    expect(eraseDecision(off)).toEqual({ erase: false, reason: 'retained_off_session' });
    expect(eraseDecision({ ...off, endedAtUnixMs: now - 7 * DAY_MS })).toEqual({
      erase: true,
      reason: 'off_session_expired',
      blocks: a.blocks,
    });
    // Offline dock: overlap unknown, nothing goes by age.
    expect(
      eraseDecision({ ...off, overlapsSession: null, endedAtUnixMs: now - 30 * DAY_MS }),
    ).toEqual({
      erase: false,
      reason: 'overlap_unknown',
    });
    // Uploaded after all (a session loaded late): wait for the confirmation.
    expect(
      eraseDecision({
        ...off,
        endedAtUnixMs: now - 30 * DAY_MS,
        uploadedSha256Hex: 'ab'.repeat(32),
      }),
    ).toEqual({ erase: false, reason: 'awaiting_confirmation' });
  });

  it('planErase erases the blocks of erasable segments only', () => {
    const { nand } = setupErase();
    const decisions = new Map<string, EraseDecision>([
      [segmentKeyOf(a), eraseDecision({ ...base, eraseCommand: command })],
      [segmentKeyOf(b), eraseDecision({ ...base, segment: b })],
    ]);
    const blocks = planErase(scan, decisions);
    expect(blocks).toEqual(a.blocks);
    for (const block of blocks) nand.eraseBlock(block);
    const after = scanNand({ pages: nand.dump(), geometry: nand.geometry, badBlocks: [10] });
    expect(after.segments.map((s) => s.segmentId)).toEqual([6]);
    expect(after.freeBlocks).toEqual(expect.arrayContaining(a.blocks));
  });

  it('planErase never erases an unknown block', () => {
    const decision: EraseDecision = { erase: true, reason: 'server_confirmed', blocks: a.blocks };
    const withUnknown = { ...scan, unknownBlocks: [a.blocks[0] ?? 0] };
    expect(planErase(withUnknown, new Map([[segmentKeyOf(a), decision]]))).toEqual(
      a.blocks.slice(1),
    );
  });

  it('orphan blocks are erased only on request', () => {
    const { nand } = filledNand();
    const junk = new Uint8Array(2048).fill(0x11);
    nand.pages.set(25 * 64, { physicalPage: 25 * 64, data: junk });
    const scan = scanNand({ pages: nand.dump(), geometry: nand.geometry, badBlocks: [10] });
    expect(planErase(scan, new Map())).toEqual([]);
    expect(planErase(scan, new Map(), { eraseOrphanBlocks: true })).toEqual([25]);
  });
});

describe('minimisation at the dock', () => {
  const hour = 3_600_000;
  const segments = [
    { id: 'warmup-and-match', startUnixMs: 10 * hour, endUnixMs: 12 * hour },
    { id: 'bag-on-the-bus', startUnixMs: 14 * hour, endUnixMs: 15 * hour },
    { id: 'late-training', startUnixMs: 20 * hour, endUnixMs: 21 * hour },
  ];
  const sessions = [{ startUnixMs: 10.5 * hour, endUnixMs: 12.5 * hour }];

  it('uploads only the segments that overlap a session', () => {
    expect(selectSegmentsToUpload(segments, sessions).map((s) => s.id)).toEqual([
      'warmup-and-match',
    ]);
    // The staff loads the training late: next docking it goes up.
    const later = [...sessions, { startUnixMs: 20.25 * hour, endUnixMs: 21.5 * hour }];
    expect(selectSegmentsToUpload(segments, later).map((s) => s.id)).toEqual([
      'warmup-and-match',
      'late-training',
    ]);
  });

  it('the margin widens the windows', () => {
    const segment = { startUnixMs: 13 * hour, endUnixMs: 13.5 * hour };
    expect(overlapsAny(segment, sessions)).toBe(false);
    expect(overlapsAny(segment, sessions, 0.5 * hour)).toBe(true);
  });
});
