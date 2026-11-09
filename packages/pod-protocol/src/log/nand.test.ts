import { describe, expect, it } from 'vitest';

import { toHex } from '../bytes.js';
import {
  keysFor,
  NandSimulator,
  syntheticSession,
  TEST_DEVICE_ID,
  testStorageKey,
  writeSegment,
} from '../testing/log-samples.js';
import { decodeLog } from './decoder.js';
import { LOG_PAGE_CRC_OFFSET, POD_NAND } from './constants.js';
import {
  canStartSegment,
  DEFAULT_RESERVE_BLOCKS,
  mayAppend,
  planRecoveryPage,
  remainingSegmentPages,
  segmentNeedsRecovery,
  decodeEraseCommand,
  encodeEraseCommand,
  eraseDecision,
  type EraseCommand,
  type SegmentSummary,
  nextWritableBlock,
  overlapsAny,
  planErase,
  scanNand,
  segmentKeyOf,
  selectSegmentsToUpload,
  type EraseDecision,
} from './nand.js';
import { writePageCrc } from './page.js';
import { LogWriter, sealRecoveryPage } from './writer.js';
import { deriveLogPageKeys } from './integrity.js';
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
    expect(empty.unknownBlocks).toHaveLength(POD_NAND.blocks - POD_NAND.reservedBlocks);
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
  const filePages = readPodRawFile(fileA.bytes, fileA.manifest).pages;
  const verified = verifyUploadForErase({
    manifest: fileA.manifest,
    pages: filePages,
    decoded: decodeLog({ pages: filePages, deviceId: TEST_DEVICE_ID, keyForEpoch: keysFor(2) }),
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
      verifyUploadForErase({ manifest: fileA.manifest, pages: forged, decoded: decodedForged }),
    ).toEqual({ ok: false, reason: 'pages_not_authentic' });

    // Manifest blocks that are not where the file's pages are.
    expect(
      verifyUploadForErase({
        manifest: { ...fileA.manifest, blocks: [...fileA.manifest.blocks, 30] },
        pages,
        decoded: decodeLog({ pages, deviceId: TEST_DEVICE_ID, keyForEpoch: keysFor(2) }),
      }),
    ).toEqual({ ok: false, reason: 'blocks_mismatch' });
  });

  it('a segment cut by a power loss is confirmed only after the pod closes it itself', () => {
    const nand = new NandSimulator();
    const pages = writeSegment(syntheticSession({ durationS: 10 }), { firstPageSeq: 100 });
    const physical = nand.writeSegment(pages);
    const lastPhysical = physical.at(-1) ?? 0;
    const torn = (pages.at(-1) ?? new Uint8Array()).slice().fill(0xff, 1000);
    nand.pages.set(lastPhysical, { physicalPage: lastPhysical, data: torn, ecc: 'ok' });
    const fileOf = (scanSegment: SegmentSummary) =>
      buildPodRawFile({
        segment: scanSegment,
        pages: nand
          .dump()
          .filter(
            (p) =>
              scanSegment.blocks.includes(Math.floor(p.physicalPage / 64)) &&
              !p.data.every((x) => x === 0xff),
          ),
        podSerial: 'ORC-0001',
        startUnixMs: null,
        endUnixMs: null,
      });
    const verify = (file: ReturnType<typeof fileOf>) => {
      const read = readPodRawFile(file.bytes, file.manifest);
      return verifyUploadForErase({
        manifest: file.manifest,
        pages: read.pages,
        decoded: decodeLog({
          pages: read.pages,
          deviceId: TEST_DEVICE_ID,
          keyForEpoch: keysFor(2),
        }),
      });
    };
    const before = scanNand({ pages: nand.dump(), geometry: nand.geometry }).segments[0];
    if (!before) throw new Error('no segment');
    expect(before.closed).toBe(false);
    expect(verify(fileOf(before))).toEqual({ ok: false, reason: 'segment_not_closed' });

    // Next boot: the pod writes the recovery close in the next erased page.
    const recovery = sealRecoveryPage({
      deviceId: TEST_DEVICE_ID,
      bootCounter: before.bootCounter,
      segmentId: before.segmentId,
      streamOffset: before.streamBytes,
      pageSeq: 5_000,
      keyEpoch: 2,
      storageKey: testStorageKey(2),
    });
    nand.pages.set(lastPhysical + 1, { physicalPage: lastPhysical + 1, data: recovery, ecc: 'ok' });
    const after = scanNand({ pages: nand.dump(), geometry: nand.geometry }).segments[0];
    if (!after) throw new Error('no segment');
    expect(after).toMatchObject({ closed: true, recovered: true, lastPageSeq: 5_000 });
    const file = fileOf(after);
    const result = verify(file);
    expect(result.ok).toBe(true);
    const decoded = decodeLog({
      pages: readPodRawFile(file.bytes).pages,
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.segments[0]).toMatchObject({ closed: true, recovered: true });
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

  it('a segment block only partly read is never erased (pages not read may hold data)', () => {
    // A closed 5-page segment in block 8; the scans read only pages 0–2.
    const nand = new NandSimulator();
    const pages = writeSegment(syntheticSession({ durationS: 3 }), { firstPageSeq: 10 });
    expect(pages.length).toBeGreaterThanOrEqual(5);
    nand.writeSegment(pages);
    const partial = nand.dump().filter((p) => p.physicalPage < 8 * 64 + 3);
    const partialScan = scanNand({ pages: partial, geometry: nand.geometry });
    const [segment] = partialScan.segments;
    if (!segment) throw new Error('no segment');
    expect(segment).toMatchObject({ fullyRead: false, blocks: [8] });
    expect(partialScan.unknownBlocks).toContain(8);
    // The dock cannot build its file, the pod does not erase, and planErase keeps the block
    // even with a decision that says erase.
    expect(() =>
      buildPodRawFile({
        segment,
        pages: partial,
        podSerial: 'x',
        startUnixMs: null,
        endUnixMs: null,
      }),
    ).toThrow(/not read entirely/);
    const forgedCommand: EraseCommand = {
      deviceIdHex: segment.deviceIdHex,
      bootCounter: segment.bootCounter,
      segmentId: segment.segmentId,
      firstPageSeq: segment.firstPageSeq,
      lastPageSeq: segment.lastPageSeq,
      validPagesN: segment.pagesN,
      blocks: segment.blocks,
      sha256Hex: 'ab'.repeat(32),
    };
    expect(
      eraseDecision({
        ...base,
        segment,
        uploadedSha256Hex: 'ab'.repeat(32),
        eraseCommand: forgedCommand,
      }),
    ).toEqual({ erase: false, reason: 'segment_not_fully_read' });
    const decision: EraseDecision = { erase: true, reason: 'server_confirmed', blocks: [8] };
    expect(planErase(partialScan, new Map([[segmentKeyOf(segment), decision]]))).toEqual([]);
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

describe('memory full: a page always stays for the close', () => {
  /**
   * Records a long session the way the pod does: before each record it checks
   * that a page stays for the close (blocks 8 and 9 usable, block 10 kept as
   * the reserve), stops when it would not, and closes the segment.
   */
  function recordUntilFull() {
    const nand = new NandSimulator({ ...new NandSimulator().geometry, blocks: 11 });
    const scan0 = scanNand({ pages: nand.dump(), geometry: nand.geometry });
    expect(canStartSegment(scan0)).toBe(true);
    const free = [...scan0.freeBlocks];
    let block = nextWritableBlock(scan0) ?? -1;
    free.splice(free.indexOf(block), 1);
    let used = 0;
    const physical: number[] = [];
    const program = (data: Uint8Array): void => {
      if (used === 64) {
        expect(free.length).toBeGreaterThan(DEFAULT_RESERVE_BLOCKS);
        block = free.shift() ?? -1;
        used = 0;
      }
      const at = block * 64 + used;
      nand.pages.set(at, { physicalPage: at, data, ecc: 'ok' });
      physical.push(at);
      used += 1;
    };
    const writer = new LogWriter({
      deviceId: TEST_DEVICE_ID,
      bootCounter: 70_000,
      segmentId: 5,
      firstPageSeq: 100,
      keyEpoch: 2,
      storageKey: testStorageKey(2),
    });
    let stopped = false;
    for (const record of syntheticSession({ durationS: 200, rawGnss: true })) {
      const remainingPages = remainingSegmentPages({
        pagesUsedInBlock: used,
        pagesPerBlock: 64,
        freeBlocksN: free.length,
      });
      if (!mayAppend({ pagesSealed: writer.pagesSealedBy(record), remainingPages })) {
        stopped = true;
        break;
      }
      writer.append(record).forEach(program);
    }
    writer.close().forEach(program);
    return { nand, physical, stopped };
  }

  it('recording stops with the close in the last usable page; the reserve block stays free', () => {
    const { nand, stopped } = recordUntilFull();
    expect(stopped).toBe(true);
    const scan = scanNand({ pages: nand.dump(), geometry: nand.geometry });
    expect(scan.segments).toHaveLength(1);
    expect(scan.segments[0]).toMatchObject({ closed: true, blocks: [8, 9], fullyRead: true });
    expect(scan.freeBlocks).toEqual([10]);
    expect(canStartSegment(scan)).toBe(false);
    expect(nextWritableBlock(scan)).toBeNull();
    const close = scan.segments[0]?.closePhysicalPage ?? -1;
    expect(
      segmentNeedsRecovery({
        segment:
          scan.segments[0] ??
          (() => {
            throw new Error('no segment');
          })(),
        closePage: nand.pages.get(close)?.data ?? null,
        keys: deriveLogPageKeys(testStorageKey(2)),
      }),
    ).toBe(false);
  });

  it('a power cut on the close: recovered in the segment’s own block if a page is left, else in the reserve, and a torn recovery there is retried in that debris block', () => {
    const { nand, physical } = recordUntilFull();
    const closeAt = physical.at(-1) ?? -1;
    const torn = (nand.pages.get(closeAt)?.data ?? new Uint8Array()).slice().fill(0xff, 1000);
    nand.pages.set(closeAt, { physicalPage: closeAt, data: torn, ecc: 'ok' });
    const keys = deriveLogPageKeys(testStorageKey(2));

    const recover = (n: NandSimulator, tear = false) => {
      const dump = n.dump();
      const scan = scanNand({ pages: dump, geometry: n.geometry });
      const [segment] = scan.segments;
      if (!segment) throw new Error('no segment');
      expect(
        segmentNeedsRecovery({
          segment,
          closePage:
            segment.closePhysicalPage === null
              ? null
              : (n.pages.get(segment.closePhysicalPage)?.data ?? null),
          keys,
        }),
      ).toBe(true);
      const place = planRecoveryPage({ scan, segment, pages: dump });
      if (!place) throw new Error('no page for the recovery close');
      const page = sealRecoveryPage({
        deviceId: TEST_DEVICE_ID,
        bootCounter: segment.bootCounter,
        segmentId: segment.segmentId,
        streamOffset: segment.streamBytes,
        pageSeq: 9_000,
        keyEpoch: 2,
        storageKey: testStorageKey(2),
      });
      // A power cut while programming the recovery page itself tears it.
      const data = tear ? page.slice().fill(0xff, 700) : page;
      n.pages.set(place.physicalPage, { physicalPage: place.physicalPage, data, ecc: 'ok' });
      const after = scanNand({ pages: n.dump(), geometry: n.geometry });
      return { place, after };
    };

    // (a) The close was cut before the end of block 9: the next page of block 9.
    if (closeAt % 64 < 63) {
      const own = new NandSimulator(nand.geometry);
      nand.pages.forEach((v, k) => own.pages.set(k, v));
      const { place, after } = recover(own);
      expect(place).toEqual({ physicalPage: closeAt + 1, location: 'own_block' });
      expect(after.segments[0]).toMatchObject({ closed: true, recovered: true, blocks: [8, 9] });
      expect(after.freeBlocks).toEqual([10]);
    }

    // (b) Block 9 full (the cut page was its last one): the reserve block takes the close.
    for (let p = (closeAt % 64) + 1; p < 64; p += 1) {
      const at = 9 * 64 + p;
      nand.pages.set(at, { physicalPage: at, data: torn, ecc: 'ok' });
    }
    // (c) And the recovery attempt in the reserve is itself torn: the reserve is
    // now debris (no free block left), and the retry continues in it.
    const torn1 = recover(nand, true);
    expect(torn1.place).toEqual({ physicalPage: 10 * 64, location: 'free_block' });
    expect(torn1.after.freeBlocks).toEqual([]);
    expect(torn1.after.orphanBlocks).toEqual([10]);
    expect(torn1.after.segments[0]?.closed).toBe(false);
    const { place, after } = recover(nand);
    expect(place).toEqual({ physicalPage: 10 * 64 + 1, location: 'debris_block' });
    expect(after.segments[0]).toMatchObject({ closed: true, recovered: true, blocks: [8, 9, 10] });
    expect(after.freeBlocks).toEqual([]);
    expect(canStartSegment(after)).toBe(false);
    // Confirmed like any closed segment; erasing it frees the whole chip again.
    const [segment] = after.segments;
    if (!segment) throw new Error('no segment');
    const dump = nand.dump();
    const file = buildPodRawFile({
      segment,
      pages: dump.filter(
        (p) =>
          segment.blocks.includes(Math.floor(p.physicalPage / 64)) &&
          !p.data.every((x) => x === 0xff),
      ),
      podSerial: 'ORC-0001',
      startUnixMs: null,
      endUnixMs: null,
    });
    const read = readPodRawFile(file.bytes, file.manifest);
    const verified = verifyUploadForErase({
      manifest: file.manifest,
      pages: read.pages,
      decoded: decodeLog({ pages: read.pages, deviceId: TEST_DEVICE_ID, keyForEpoch: keysFor(2) }),
    });
    if (!verified.ok) throw new Error(verified.reason);
    const decision = eraseDecision({
      segment,
      recording: false,
      endedAtUnixMs: null,
      overlapsSession: true,
      uploadedSha256Hex: file.manifest.sha256Hex,
      eraseCommand: verified.command,
      nowUnixMs: 0,
      offSessionRetentionDays: 7,
    });
    const blocks = planErase(after, new Map([[segmentKeyOf(segment), decision]]));
    expect(blocks).toEqual([8, 9, 10]);
    for (const b of blocks) nand.eraseBlock(b);
    expect(canStartSegment(scanNand({ pages: nand.dump(), geometry: nand.geometry }))).toBe(true);
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
