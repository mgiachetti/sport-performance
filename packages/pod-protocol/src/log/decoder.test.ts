import { describe, expect, it } from 'vitest';

import {
  keysFor,
  NandSimulator,
  OTHER_DEVICE_ID,
  syntheticSession,
  TEST_DEVICE_ID,
  testStorageKey,
  writeSegment,
} from '../testing/log-samples.js';
import { LOG_PAGE_CRC_OFFSET, LOG_PAGE_PAYLOAD_CAPACITY, LOG_PAGE_SIZE } from './constants.js';
import { decodeLog, pagesFromDump, type NandPageRead } from './decoder.js';
import { deriveLogPageKeys } from './integrity.js';
import { inspectLogPage, openLogPage, sealLogPage, writePageCrc } from './page.js';
import { encodeRecord, type LogRecord } from './records.js';
import { LogWriter } from './writer.js';

const RECORDS = syntheticSession({ durationS: 20, rawGnss: true, dockAnchorAtEnd: true });
const PAGES = writeSegment(RECORDS);
const asReads = (pages: readonly Uint8Array[]): NandPageRead[] =>
  pages.map((data, i) => ({ physicalPage: 8 * 64 + i, data, ecc: 'ok' }));

function header(page: Uint8Array) {
  const inspection = inspectLogPage(page);
  if (inspection.status !== 'valid') throw new Error(`page is ${inspection.status}`);
  return inspection.header;
}

/** The record without the fields the decoder adds. */
function omit(value: object, keys: readonly string[]): LogRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => !keys.includes(k)),
  ) as unknown as LogRecord;
}

function allRecords(decoded: ReturnType<typeof decodeLog>): LogRecord[] {
  const segment = decoded.segments[0];
  if (!segment) return [];
  const s = segment.streams;
  return [
    ...s.firmware,
    ...s.config,
    ...s.pvt.map((p) => omit(p, ['duringRadioTx'])),
    ...s.raw,
    ...s.imu.map((b) => omit(b, ['firstSampleTick', 'lastSampleTick', 'timeSource'])),
    ...s.baro,
    ...s.anchors,
    ...s.sensorSyncs,
    ...s.markers,
    ...s.health,
    ...s.radioTx,
    ...s.events,
    ...s.unknown,
  ];
}

const byTick = (a: LogRecord, b: LogRecord): number =>
  a.tick - b.tick || (encodeRecord(a)[0] ?? 0) - (encodeRecord(b)[0] ?? 0);

function item<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new Error(`no item ${String(i)}`);
  return value;
}

describe('LogWriter', () => {
  it('cuts the stream into pages with records spanning pages', () => {
    const streamBytes = RECORDS.reduce((sum, r) => sum + encodeRecord(r).length, 0);
    expect(PAGES.length).toBe(Math.ceil(streamBytes / LOG_PAGE_PAYLOAD_CAPACITY));
    const headers = PAGES.map(header);
    expect(headers[0]?.segmentStart).toBe(true);
    expect(headers.at(-1)?.segmentEnd).toBe(true);
    expect(headers.map((h) => h.pageSeq)).toEqual(PAGES.map((_, i) => 4_096 + i));
    expect(
      headers.slice(1).every((h, i) => h.streamOffset === (headers[i]?.streamOffset ?? 0) + 1996),
    ).toBe(true);
    // Raw GNSS epochs (≈ 2 kB) always span pages.
    expect(headers.some((h) => h.continues)).toBe(true);
  });

  it('flush seals a short page and the stream continues', () => {
    const writer = new LogWriter({
      deviceId: TEST_DEVICE_ID,
      bootCounter: 1,
      segmentId: 1,
      firstPageSeq: 0,
      keyEpoch: 2,
      storageKey: testStorageKey(2),
    });
    const sample = RECORDS.slice(0, 3);
    for (const r of sample) writer.append(r);
    const [short] = writer.flush();
    expect(writer.flush()).toEqual([]);
    writer.append(item(RECORDS, 3));
    const [last] = writer.close();
    if (!short || !last) throw new Error('missing pages');
    const decoded = decodeLog({
      pages: asReads([short, last]),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(header(last).streamOffset).toBe(header(short).payloadLength);
    expect(decoded.segments[0]?.complete).toBe(true);
    expect(allRecords(decoded).sort(byTick)).toEqual(RECORDS.slice(0, 4).sort(byTick));
    expect(() => writer.append(item(RECORDS, 0))).toThrow();
  });

  it('closing exactly on a page boundary writes an empty closing page', () => {
    const writer = new LogWriter({
      deviceId: TEST_DEVICE_ID,
      bootCounter: 1,
      segmentId: 1,
      firstPageSeq: 0,
      keyEpoch: 2,
      storageKey: testStorageKey(2),
    });
    // One unknown record filling the page exactly.
    const pages = writer.append({
      type: 'unknown',
      tick: 1,
      typeCode: 0x7e,
      body: new Uint8Array(LOG_PAGE_PAYLOAD_CAPACITY - 9),
    });
    expect(pages).toHaveLength(1);
    const [end] = writer.close();
    if (!end) throw new Error('no closing page');
    expect(header(end)).toMatchObject({
      payloadLength: 0,
      firstRecordOffset: null,
      segmentEnd: true,
    });
    const decoded = decodeLog({
      pages: asReads([...pages, end]),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.segments[0]?.complete).toBe(true);
    expect(decoded.segments[0]?.streams.unknown).toHaveLength(1);
  });
});

describe('decodeLog', () => {
  it('round-trips a whole segment with every stream', () => {
    const decoded = decodeLog({
      pages: asReads(PAGES),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.pageIssues).toEqual([]);
    expect(decoded.segments).toHaveLength(1);
    const [segment] = decoded.segments;
    if (!segment) throw new Error('no segment');
    expect(segment).toMatchObject({
      bootCounter: 70_000,
      segmentId: 5,
      keyEpochs: [2],
      closed: true,
      complete: true,
      pagesN: PAGES.length,
      gaps: [],
      recordIssues: [],
    });
    expect(allRecords(decoded).sort(byTick)).toEqual([...RECORDS].sort(byTick));
    expect(segment.streams.imu.every((b) => b.timeSource === 'sensor_sync')).toBe(true);
    expect(decoded.stats).toEqual({
      pagesRead: PAGES.length,
      pagesErased: 0,
      pagesValid: PAGES.length,
      pagesSkipped: 0,
    });
  });

  it('flags the GNSS epochs that overlap a LoRa transmission', () => {
    const decoded = decodeLog({
      pages: asReads(PAGES),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    const pvt = decoded.segments[0]?.streams.pvt ?? [];
    const flagged = pvt
      .filter((p) => p.duringRadioTx)
      .map((p) => (p.gnssTimeMs - 1_446_000_000_000) % 2000);
    // TX at +300 ms for 102,7 ms every 2 s: the epochs at 300, 400 and 500 ms see it.
    expect(new Set(flagged)).toEqual(new Set([300, 400, 500]));
    expect(pvt.every((p) => p.duringRadioTx !== null)).toBe(true);
  });

  it('use intervals come from the markers', () => {
    const decoded = decodeLog({
      pages: asReads(PAGES),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    const intervals = decoded.segments[0]?.intervals ?? [];
    expect(intervals.map((i) => [i.kind, i.truncated])).toEqual([
      ['recording', false],
      ['worn', false],
      ['moving', false],
    ]);
    const worn = intervals.find((i) => i.kind === 'worn');
    expect(worn?.startGnssMs).not.toBeNull();
    expect(worn?.endGnssMs).not.toBeNull();
    expect(Math.round(((worn?.endGnssMs ?? 0) - (worn?.startGnssMs ?? 0)) / 100)).toBe(195);
  });

  it('a corrupted page is reported and its records lost, the rest decodes', () => {
    const pages = PAGES.slice();
    const bad = item(pages, 3).slice();
    bad[700] = (bad[700] ?? 0) ^ 0x01;
    pages[3] = bad;
    const decoded = decodeLog({
      pages: asReads(pages),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.pageIssues).toEqual([{ physicalPage: 8 * 64 + 3, reason: 'crc_mismatch' }]);
    const [segment] = decoded.segments;
    expect(segment?.complete).toBe(false);
    expect(segment?.closed).toBe(true);
    expect(segment?.gaps.filter((g) => g.kind === 'stream')).toEqual([
      { kind: 'stream', afterPageSeq: 4_098, beforePageSeq: 4_100, lostBytes: 1996 },
    ]);
    const lost = RECORDS.length - allRecords(decoded).length;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(20);
  });

  it('a page re-CRCed after tampering is a MAC failure', () => {
    const pages = PAGES.slice();
    const bad = item(pages, 2).slice();
    bad[45] = (bad[45] ?? 0) ^ 0x10;
    bad.set(writePageCrc(bad), LOG_PAGE_CRC_OFFSET);
    pages[2] = bad;
    const decoded = decodeLog({
      pages: asReads(pages),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.pageIssues).toMatchObject([{ reason: 'mac_mismatch', pageSeq: 4_098 }]);
  });

  it('skips bad blocks and uncorrectable pages and reports them', () => {
    const nand = new NandSimulator();
    nand.badBlocks.add(9);
    // Garbage in the bad block: never read.
    const garbage = new Uint8Array(LOG_PAGE_SIZE).fill(0x5a);
    for (let p = 0; p < 64; p += 1) {
      nand.pages.set(9 * 64 + p, { physicalPage: 9 * 64 + p, data: garbage, ecc: 'ok' });
    }
    const big = writeSegment(syntheticSession({ durationS: 60 }));
    expect(big.length).toBeGreaterThan(64);
    const physical = nand.writeSegment(big);
    expect(physical.some((p) => Math.floor(p / 64) === 9)).toBe(false);
    expect(Math.floor((physical[64] ?? 0) / 64)).toBe(10);
    const clean = decodeLog({
      pages: nand.dump(),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
      badBlocks: [9],
    });
    expect(clean.pageIssues).toEqual([{ physicalPage: 9 * 64, reason: 'bad_block' }]);
    expect(clean.segments[0]?.complete).toBe(true);

    // A grown bad page: uncorrectable ECC on read.
    const dump = nand
      .dump()
      .map((p) => (p.physicalPage === physical[10] ? { ...p, ecc: 'uncorrectable' as const } : p));
    const decoded = decodeLog({
      pages: dump,
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
      badBlocks: [9],
    });
    expect(decoded.pageIssues).toContainEqual({
      physicalPage: physical[10],
      reason: 'uncorrectable_ecc',
    });
    expect(decoded.segments[0]?.gaps[0]).toMatchObject({ kind: 'stream', lostBytes: 1996 });
  });

  it('power loss mid-page: the torn page and the unwritten tail are lost, the rest decodes', () => {
    // Recording cut at page 6: page 6 half programmed, nothing after it.
    const torn = item(PAGES, 6).slice();
    torn.fill(0xff, 900);
    const pages = [...PAGES.slice(0, 6), torn];
    const decoded = decodeLog({
      pages: asReads(pages),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.pageIssues).toEqual([{ physicalPage: 8 * 64 + 6, reason: 'torn_write' }]);
    const [segment] = decoded.segments;
    expect(segment).toMatchObject({ closed: false, complete: false });
    expect(segment?.gaps).toContainEqual({ kind: 'stream_end', afterPageSeq: 4_101 });
    // The record cut at the end of page 5 is reported, not invented.
    expect(segment?.recordIssues.map((i) => i.reason)).toEqual(['truncated_at_end']);
    // Open intervals end at the last record and are marked truncated.
    expect(segment?.intervals.every((i) => i.truncated)).toBe(true);
  });

  it('key epoch change mid-segment: each page opens with its own key', () => {
    const records = syntheticSession({ durationS: 10 });
    const rotateAt = Math.floor(records.length / 2);
    const pages = writeSegment(records, { rotate: { at: rotateAt, epoch: 3 } });
    const epochs = pages.map((p) => header(p).keyEpoch);
    expect(new Set(epochs)).toEqual(new Set([2, 3]));
    // Sequences keep counting across the change, so no IV repeats.
    expect(pages.map((p) => header(p).pageSeq)).toEqual(pages.map((_, i) => 4_096 + i));
    const both = decodeLog({
      pages: asReads(pages),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2, 3),
    });
    expect(both.segments[0]).toMatchObject({ complete: true, keyEpochs: [2, 3] });
    expect(both.segments[0]?.streams.pvt.length).toBe(
      records.filter((r) => r.type === 'gnss_pvt').length,
    );

    // Without the new key: those pages are reported and the stream ends early.
    const onlyOld = decodeLog({
      pages: asReads(pages),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    const missing = epochs.filter((e) => e === 3).length;
    expect(onlyOld.pageIssues.filter((i) => i.reason === 'unknown_key_epoch')).toHaveLength(
      missing,
    );
    expect(onlyOld.segments[0]?.complete).toBe(false);
  });

  it('authentic pages that overlap in the stream are an overlap, never a negative loss', () => {
    const second = header(item(PAGES, 1));
    const payload = openLogPage({
      page: item(PAGES, 1),
      header: second,
      keys: deriveLogPageKeys(testStorageKey(2)),
    });
    const overlapping = sealLogPage({
      header: {
        ...second,
        pageSeq: second.pageSeq + 5_000,
        streamOffset: second.streamOffset + 100,
      },
      payload,
      keys: deriveLogPageKeys(testStorageKey(2)),
    });
    const decoded = decodeLog({
      pages: [...asReads(PAGES), { physicalPage: 77 * 64, data: overlapping }],
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    const gaps = decoded.segments[0]?.gaps ?? [];
    expect(gaps).toEqual([
      {
        kind: 'stream_overlap',
        afterPageSeq: second.pageSeq,
        beforePageSeq: second.pageSeq + 5_000,
        overlapBytes: 1996 - 100,
      },
    ]);
    expect(gaps.every((g) => g.kind !== 'stream' || g.lostBytes > 0)).toBe(true);
    expect(allRecords(decoded).length).toBe(RECORDS.length);
  });

  it('a page programmed twice (rewrite after a failed program) decodes once', () => {
    const copy = header(item(PAGES, 4));
    const payload = openLogPage({
      page: item(PAGES, 4),
      header: copy,
      keys: deriveLogPageKeys(testStorageKey(2)),
    });
    const rewrite = sealLogPage({
      header: { ...copy, pageSeq: copy.pageSeq + 1_000 },
      payload,
      keys: deriveLogPageKeys(testStorageKey(2)),
    });
    // The failed program still reads, the rewrite has a later sequence.
    const decoded = decodeLog({
      pages: [...asReads(PAGES), { physicalPage: 99 * 64, data: rewrite }],
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.pageIssues).toEqual([]);
    expect(decoded.segments[0]?.complete).toBe(true);
    expect(allRecords(decoded).length).toBe(RECORDS.length);
  });

  it('pages of another pod are skipped when the device is given', () => {
    const other = writeSegment(syntheticSession({ durationS: 1 }), { deviceId: OTHER_DEVICE_ID });
    const decoded = decodeLog({
      pages: [...asReads(PAGES), ...other.map((data, i) => ({ physicalPage: 50 * 64 + i, data }))],
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.pageIssues.every((i) => i.reason === 'other_device')).toBe(true);
    expect(decoded.segments).toHaveLength(1);
  });

  it('several segments and boots decode apart, each with its time base', () => {
    const first = writeSegment(syntheticSession({ durationS: 3 }), { segmentId: 5 });
    const second = writeSegment(syntheticSession({ durationS: 3, startTick: 50 }), {
      bootCounter: 70_001,
      segmentId: 6,
      firstPageSeq: 8_192,
    });
    const decoded = decodeLog({
      pages: asReads([...second, ...first]),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.segments.map((s) => [s.bootCounter, s.segmentId, s.complete])).toEqual([
      [70_000, 5, true],
      [70_001, 6, true],
    ]);
    expect(decoded.timeBases.map((b) => [b.bootCounter, b.source])).toEqual([
      [70_000, 'gnss_pps'],
      [70_001, 'gnss_pps'],
    ]);
  });

  it('hostile anchors (30 000 in groups of 3 at different offsets) never crash the worker', () => {
    const records: LogRecord[] = Array.from({ length: 30_000 }, (_, s) => ({
      type: 'time_anchor',
      tick: 1_000 + s * 32_768,
      source: 'gnss_pps',
      subTickNs: 0,
      gnssTimeMs: 1_446_000_000_000 + s * 1000 + Math.floor(s / 3) * 7_919,
      uncertaintyUs: 1,
      gpsUtcOffsetS: 18,
    }));
    const pages = writeSegment(records);
    const started = performance.now();
    const decoded = decodeLog({
      pages: asReads(pages),
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(decoded.segments[0]?.complete).toBe(true);
    expect(decoded.segments[0]?.streams.anchors).toHaveLength(30_000);
    expect(decoded.timeIssues).toEqual([]);
  });

  it('splits a raw dump into page reads', () => {
    const dump = new Uint8Array(3 * LOG_PAGE_SIZE + 10);
    const pages = pagesFromDump(dump, { firstPhysicalPage: 640 });
    expect(pages.map((p) => [p.physicalPage, p.data.length])).toEqual([
      [640, 2048],
      [641, 2048],
      [642, 2048],
    ]);
  });
});
