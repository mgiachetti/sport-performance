import { readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from '../bytes.js';
import { kdfInfo } from '../crypto.js';
import {
  keysFor,
  syntheticSession,
  TEST_DEVICE_ID,
  TEST_MASTER_KEY,
  testStorageKey,
  writeSegment,
} from '../testing/log-samples.js';
import {
  hoursPerChip,
  pagesPerHour,
  profileStreamRateBps,
  RAW_GNSS_STREAM_PROFILE,
  DEFAULT_STREAM_PROFILE,
  segmentBlocks,
  sessionsPerChip,
} from './capacity.js';
import {
  LOG_FORMAT_VERSION,
  LOG_PAGE_CRC_OFFSET,
  LOG_PAGE_HEADER_LENGTH,
  LOG_PAGE_MAC_OFFSET,
  LOG_PAGE_MAC_LENGTH,
  LOG_PAGE_PAYLOAD_CAPACITY,
  LOG_PAGE_SIZE,
  W25N02KV,
  W25N04KV,
} from './constants.js';
import { decodeLog, type DecodedLog, type EccStatus, type NandPageRead } from './decoder.js';
import { logPageIv } from './integrity.js';
import { scanNand } from './nand.js';
import { inspectLogPage, openLogPage, readPageCrc, writePageCrc } from './page.js';
import { buildPodRawFile, readPodRawFile } from './pod-raw.js';
import { decodeRecord, encodeRecord, RECORD_HEADER_LENGTH, type LogRecord } from './records.js';
import { buildTimeBase, tickToGnssMs } from './timeline.js';

/**
 * Golden vectors of the NAND log (`fixtures/v1/log-vectors.json` and
 * `fixtures/v1/pod-raw-sample.bin`), shared with the firmware. Regenerated from
 * the definitions below; the test fails if the committed files differ. To
 * change them on purpose: `pnpm --filter @sport-performance/pod-protocol fixtures:update`.
 */

const VECTORS_PATH = new URL('../../fixtures/v1/log-vectors.json', import.meta.url);
const POD_RAW_PATH = new URL('../../fixtures/v1/pod-raw-sample.bin', import.meta.url);

const WRITER = { bootCounter: 70_000, segmentId: 5, firstPageSeq: 4_096, keyEpoch: 2 };
const BASE_PHYSICAL = 8 * 64;

// ---------------------------------------------------------------------------
// JSON ↔ records (byte fields as hex)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function recordToJson(record: LogRecord): JsonRecord {
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (value instanceof Uint8Array) {
      out[`${key}Hex`] = toHex(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function recordFromJson(json: JsonRecord): LogRecord {
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(json)) {
    if (key.endsWith('Hex') && typeof value === 'string') {
      out[key.slice(0, -3)] = fromHex(value);
    } else {
      out[key] = value;
    }
  }
  return out as unknown as LogRecord;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function pageVector(page: Uint8Array, key: Uint8Array) {
  const inspection = inspectLogPage(page);
  if (inspection.status !== 'valid') throw new Error('invalid page in a vector');
  const { header } = inspection;
  return {
    header: { ...header, deviceId: undefined, deviceIdHex: toHex(header.deviceId) },
    ivHex: toHex(logPageIv(header.keyEpoch, header.pageSeq)),
    plaintextHex: toHex(openLogPage({ page, header, storageKey: key })),
    macHex: toHex(page.subarray(LOG_PAGE_MAC_OFFSET, LOG_PAGE_CRC_OFFSET)),
    crc32: readPageCrc(page),
    pageHex: toHex(page),
  };
}

function summarise(decoded: DecodedLog) {
  return {
    stats: decoded.stats,
    pageIssues: decoded.pageIssues,
    segments: decoded.segments.map((s) => ({
      bootCounter: s.bootCounter,
      segmentId: s.segmentId,
      keyEpochs: s.keyEpochs,
      firstPageSeq: s.firstPageSeq,
      lastPageSeq: s.lastPageSeq,
      pagesN: s.pagesN,
      closed: s.closed,
      complete: s.complete,
      streamBytes: s.streamBytes,
      tickRange: s.tickRange,
      gnssTimeRange: s.gnssTimeRange,
      recordsN: Object.fromEntries(
        Object.entries(s.streams).map(([name, list]) => [name, (list as unknown[]).length]),
      ),
      radioTxFlaggedPvtN: s.streams.pvt.filter((p) => p.duringRadioTx).length,
      gaps: s.gaps,
      intervals: s.intervals,
      recordIssues: s.recordIssues.map(({ reason, streamOffset }) => ({ reason, streamOffset })),
    })),
    timeBases: decoded.timeBases.map((b) => ({
      bootCounter: b.bootCounter,
      source: b.source,
      points: b.points,
      rejected: b.rejected,
    })),
  };
}

interface DamagedPage {
  physicalPage: number;
  ecc: EccStatus;
  /** Index into `segment.pages` when the page is unchanged. */
  segmentPage?: number;
  /** The page as read when it differs. */
  pageHex?: string;
}

function buildVectors() {
  const key2 = testStorageKey(2);
  const records = syntheticSession({
    durationS: 2,
    rawGnss: true,
    firstFixS: 0,
    dockAnchorAtEnd: true,
  });
  const pages = writeSegment(records, WRITER);
  const reads = (list: readonly Uint8Array[]): NandPageRead[] =>
    list.map((data, i) => ({ physicalPage: BASE_PHYSICAL + i, data, ecc: 'ok' }));

  // One record of each type and shape, with their exact bytes.
  const seen = new Set<string>();
  const sampleRecords: LogRecord[] = records.filter((r) => {
    const tag =
      r.type === 'segment_marker'
        ? `${r.type}/${r.kind}`
        : r.type === 'imu_batch'
          ? `${r.type}/${r.channel}`
          : r.type;
    const isNew = !seen.has(tag);
    seen.add(tag);
    return isNew;
  });
  sampleRecords.push(
    { type: 'event', tick: 123_456, code: 'nand_program_failed', value: 1_234 },
    {
      type: 'segment_marker',
      tick: 123_460,
      kind: 'staff_session_close',
      sessionSeq: 6,
      transitionGnssS: 1_446_000_002,
    },
    {
      type: 'gnss_pvt',
      tick: 123_470,
      gnssTimeMs: 1_446_000_002_100,
      latE7: -345_123_456,
      lonE7: -585_123_456,
      heightEllipsoidMm: 21_300,
      velNorthMmS: null,
      velEastMmS: null,
      velDownMmS: null,
      groundSpeedMmS: null,
      headingCentiDeg: null,
      hAccMm: null,
      vAccMm: null,
      speedAccMmS: null,
      fixQuality: 'dead_reckoning',
      satellitesN: 3,
    },
    { type: 'unknown', tick: 123_480, typeCode: 0x7e, body: Uint8Array.of(0xde, 0xad) },
  );

  // Key epoch change in the middle of a segment.
  // The new key applies from the page being filled: rotate once the first page is sealed.
  const rotated = syntheticSession({ durationS: 2, firstFixS: 0 });
  let streamed = 0;
  const rotateAt = rotated.findIndex((r) => (streamed += encodeRecord(r).length) > 2_500);
  const rotatedPages = writeSegment(rotated, {
    ...WRITER,
    segmentId: 6,
    firstPageSeq: 8_192,
    rotate: { at: rotateAt, epoch: 3 },
  });

  // Damaged reads of the main segment.
  const intact = (i: number, physicalPage = BASE_PHYSICAL + i): DamagedPage => ({
    physicalPage,
    ecc: 'ok',
    segmentPage: i,
  });
  const mutate = (
    i: number,
    fn: (p: Uint8Array) => void,
    physicalPage = BASE_PHYSICAL + i,
  ): DamagedPage => {
    const copy = (pages[i] ?? new Uint8Array()).slice();
    fn(copy);
    return { physicalPage, ecc: 'ok', pageHex: toHex(copy) };
  };
  const n = pages.length;
  const all = (except: number, replacement: DamagedPage): DamagedPage[] =>
    pages.map((_, i) => (i === except ? replacement : intact(i)));
  const damagedCases: {
    name: string;
    why: string;
    pagesPerBlock: number;
    badBlocks: number[];
    pages: DamagedPage[];
  }[] = [
    {
      name: 'crc_flip',
      why: 'one bit flipped in page 2: CRC fails, the page and the records it held are lost',
      pagesPerBlock: 64,
      badBlocks: [],
      pages: all(
        2,
        mutate(2, (p) => (p[700] = (p[700] ?? 0) ^ 0x01)),
      ),
    },
    {
      name: 'mac_flip_recrc',
      why: 'ciphertext altered and the CRC recomputed: only the CMAC catches it',
      pagesPerBlock: 64,
      badBlocks: [],
      pages: all(
        1,
        mutate(1, (p) => {
          p[LOG_PAGE_HEADER_LENGTH + 5] = (p[LOG_PAGE_HEADER_LENGTH + 5] ?? 0) ^ 0x10;
          p.set(writePageCrc(p), LOG_PAGE_CRC_OFFSET);
        }),
      ),
    },
    {
      name: 'torn_write',
      why: 'power lost while programming the last page: its tail reads erased; the segment is not closed',
      pagesPerBlock: 64,
      badBlocks: [],
      pages: pages.map((_, i) => (i === n - 1 ? mutate(i, (p) => p.fill(0xff, 900)) : intact(i))),
    },
    {
      name: 'uncorrectable_ecc',
      why: 'the W25N reports an uncorrectable ECC error on page 3: marked, skipped, reported',
      pagesPerBlock: 64,
      badBlocks: [],
      pages: pages.map((_, i) => (i === 3 ? { ...intact(i), ecc: 'uncorrectable' } : intact(i))),
    },
    {
      name: 'bad_block_skip',
      why: 'block 3 (4 pages per block here) is bad and holds garbage; the segment continues in block 4',
      pagesPerBlock: 4,
      badBlocks: [3],
      pages: [
        intact(0, 8),
        intact(1, 9),
        { physicalPage: 12, ecc: 'ok', pageHex: toHex(new Uint8Array(LOG_PAGE_SIZE).fill(0x5a)) },
        ...pages.slice(2).map((_, j) => intact(j + 2, 16 + j)),
      ],
    },
    {
      name: 'erased_and_other_order',
      why: 'pages given out of physical order with erased pages in between: order comes from the header',
      pagesPerBlock: 64,
      badBlocks: [],
      pages: [
        { physicalPage: 600, ecc: 'ok', pageHex: toHex(new Uint8Array(LOG_PAGE_SIZE).fill(0xff)) },
        ...[...pages.keys()].reverse().map((i) => intact(i, 601 + i)),
      ],
    },
  ];
  const resolve = (list: DamagedPage[]): NandPageRead[] =>
    list.map((p) => ({
      physicalPage: p.physicalPage,
      ecc: p.ecc,
      data: p.pageHex ? fromHex(p.pageHex) : (pages[p.segmentPage ?? 0] ?? new Uint8Array()),
    }));
  const damaged = damagedCases.map((c) => ({
    ...c,
    expected: summarise(
      decodeLog({
        pages: resolve(c.pages),
        keyForEpoch: keysFor(2),
        badBlocks: c.badBlocks,
        pagesPerBlock: c.pagesPerBlock,
      }),
    ),
  }));

  // pod_raw file of the main segment.
  const scan = scanNand({ pages: reads(pages) });
  const [summary] = scan.segments;
  if (!summary) throw new Error('no segment');
  const podRaw = buildPodRawFile({
    segment: summary,
    pages: reads(pages),
    podSerial: 'ORC-0001',
    startUnixMs: 1_761_000_000_000,
    endUnixMs: 1_761_000_002_000,
  });

  // Time base: drifting crystal (+18 ppm), PPS from t = 10 s, a dock anchor at 0.
  const rate = 32_768 * (1 + 18e-6);
  const anchors = [
    {
      type: 'time_anchor' as const,
      tick: 50_000,
      source: 'dock' as const,
      subTickNs: 0,
      gnssTimeMs: 1_446_000_000_012,
      uncertaintyUs: 50_000,
      gpsUtcOffsetS: 18,
    },
    ...Array.from({ length: 5 }, (_, i) => {
      const exact = 50_000 + (10 + i) * rate;
      return {
        type: 'time_anchor' as const,
        tick: Math.floor(exact),
        source: 'gnss_pps' as const,
        subTickNs: Math.round((exact - Math.floor(exact)) * (1e9 / 32_768)),
        gnssTimeMs: 1_446_000_000_000 + (10 + i) * 1000,
        uncertaintyUs: 1,
        gpsUtcOffsetS: 18,
      };
    }),
  ];
  const base = buildTimeBase(70_000, anchors);
  const timeline = {
    anchors,
    queries: [50_000, 50_000 + 5 * 32_768, 50_000 + 12.5 * 32_768, 50_000 + 20 * 32_768].map(
      (tick) => ({ tick, gnssTimeMs: tickToGnssMs(base, tick) }),
    ),
  };

  const capacity = [
    { name: 'sensors (pod-f3.md)', streamRateBps: 2_500 },
    { name: 'sensors + raw GNSS 1 Hz (pod-f3.md)', streamRateBps: 4_500 },
    {
      name: 'v1 records, default profile',
      streamRateBps: profileStreamRateBps(DEFAULT_STREAM_PROFILE),
    },
    {
      name: 'v1 records, raw GNSS 1 Hz',
      streamRateBps: profileStreamRateBps(RAW_GNSS_STREAM_PROFILE),
    },
  ].map((c) => ({
    ...c,
    pagesPerHour: pagesPerHour(c.streamRateBps),
    blocksPer3hSession: segmentBlocks(c.streamRateBps, 3 * 3600),
    sessions3hW25N04KV: sessionsPerChip({
      streamRateBps: c.streamRateBps,
      sessionDurationS: 3 * 3600,
    }),
    sessions3hW25N02KV: sessionsPerChip({
      streamRateBps: c.streamRateBps,
      sessionDurationS: 3 * 3600,
      geometry: W25N02KV,
    }),
    hoursW25N04KV: Math.round(hoursPerChip(c.streamRateBps) * 100) / 100,
  }));

  return {
    vectors: {
      format: 'sport-performance/pod-protocol/log-vectors',
      logFormatVersion: LOG_FORMAT_VERSION,
      readme: 'packages/pod-protocol/README.md',
      integers: 'little-endian',
      layout: {
        pageSizeB: LOG_PAGE_SIZE,
        headerB: LOG_PAGE_HEADER_LENGTH,
        payloadB: LOG_PAGE_PAYLOAD_CAPACITY,
        macB: LOG_PAGE_MAC_LENGTH,
        crcB: 4,
        recordHeaderB: RECORD_HEADER_LENGTH,
        pagesPerBlock: W25N04KV.pagesPerBlock,
      },
      keys: {
        masterKeyHex: toHex(TEST_MASTER_KEY),
        deviceIdHex: toHex(TEST_DEVICE_ID),
        storage: [2, 3].map((epoch) => ({
          epoch,
          infoHex: toHex(kdfInfo('storage', TEST_DEVICE_ID, epoch)),
          keyHex: toHex(testStorageKey(epoch)),
        })),
      },
      records: sampleRecords.map((r) => ({ record: recordToJson(r), hex: toHex(encodeRecord(r)) })),
      segment: {
        writer: WRITER,
        records: records.map(recordToJson),
        pages: pages.map((p) => pageVector(p, key2)),
        expected: summarise(decodeLog({ pages: reads(pages), keyForEpoch: keysFor(2) })),
      },
      epochChange: {
        writer: { ...WRITER, segmentId: 6, firstPageSeq: 8_192 },
        rotateBeforeRecord: rotateAt,
        newKeyEpoch: 3,
        records: rotated.map(recordToJson),
        pages: rotatedPages.map((p) => {
          const h = inspectLogPage(p);
          const epoch = h.status === 'valid' ? h.header.keyEpoch : 2;
          return pageVector(p, testStorageKey(epoch));
        }),
        expected: summarise(decodeLog({ pages: reads(rotatedPages), keyForEpoch: keysFor(2, 3) })),
      },
      damaged,
      podRaw: { file: 'pod-raw-sample.bin', manifest: podRaw.manifest },
      timeline,
      capacity,
    },
    podRawBytes: podRaw.bytes,
  };
}

type Vectors = ReturnType<typeof buildVectors>['vectors'];

function serialise(vectors: Vectors): string {
  return `${JSON.stringify(vectors, null, 2)}\n`;
}

describe('golden log fixtures v1', () => {
  const generated = buildVectors();
  if (process.env.POD_PROTOCOL_UPDATE_FIXTURES === '1') {
    writeFileSync(VECTORS_PATH, serialise(generated.vectors));
    writeFileSync(POD_RAW_PATH, generated.podRawBytes);
  }

  it('the committed vectors match the implementation', () => {
    const committed: unknown = JSON.parse(readFileSync(VECTORS_PATH, 'utf8'));
    expect(committed).toEqual(JSON.parse(serialise(generated.vectors)));
    expect(toHex(new Uint8Array(readFileSync(POD_RAW_PATH)))).toBe(toHex(generated.podRawBytes));
  });

  // From here on, only the committed files are used: the checks another implementation runs.
  const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as Vectors;
  const keyOf = (epoch: number) => {
    const hex = vectors.keys.storage.find((k) => k.epoch === epoch)?.keyHex;
    return hex ? fromHex(hex) : undefined;
  };

  it('storage keys derive with Node HKDF', async () => {
    const { hkdfSync } = await import('node:crypto');
    for (const k of vectors.keys.storage) {
      const key = new Uint8Array(
        hkdfSync(
          'sha256',
          fromHex(vectors.keys.masterKeyHex),
          new Uint8Array(0),
          fromHex(k.infoHex),
          16,
        ),
      );
      expect(toHex(key)).toBe(k.keyHex);
    }
  });

  it('records encode to their bytes and back', () => {
    for (const v of vectors.records) {
      const record = recordFromJson(v.record);
      expect(toHex(encodeRecord(record))).toBe(v.hex);
      expect(decodeRecord(fromHex(v.hex))).toEqual(record);
    }
  });

  it('the segment pages are the records cut into pages (what the firmware must produce)', () => {
    const stream = vectors.segment.records
      .map((r) => toHex(encodeRecord(recordFromJson(r))))
      .join('');
    expect(vectors.segment.pages.map((p) => p.plaintextHex).join('')).toBe(stream);
    for (const p of vectors.segment.pages) {
      const page = fromHex(p.pageHex);
      const inspection = inspectLogPage(page);
      if (inspection.status !== 'valid') throw new Error('invalid page');
      const key = keyOf(inspection.header.keyEpoch);
      if (!key) throw new Error('no key');
      expect(toHex(openLogPage({ page, header: inspection.header, storageKey: key }))).toBe(
        p.plaintextHex,
      );
    }
  });

  it('decoding the committed pages gives the expected summary', () => {
    const decode = (pages: { pageHex: string }[], first = BASE_PHYSICAL) =>
      summarise(
        decodeLog({
          pages: pages.map((p, i) => ({
            physicalPage: first + i,
            data: fromHex(p.pageHex),
            ecc: 'ok',
          })),
          keyForEpoch: keyOf,
        }),
      );
    expect(decode(vectors.segment.pages)).toEqual(vectors.segment.expected);
    expect(decode(vectors.epochChange.pages)).toEqual(vectors.epochChange.expected);
    expect(vectors.epochChange.expected.segments[0]?.keyEpochs).toEqual([2, 3]);
  });

  it.each(vectors.damaged.map((c) => [c.name, c] as const))('damaged read %s', (_, c) => {
    const pages = c.pages.map((p: DamagedPage) => ({
      physicalPage: p.physicalPage,
      ecc: p.ecc,
      data: fromHex(p.pageHex ?? vectors.segment.pages[p.segmentPage ?? 0]?.pageHex ?? ''),
    }));
    const decoded = decodeLog({
      pages,
      keyForEpoch: keyOf,
      badBlocks: c.badBlocks,
      pagesPerBlock: c.pagesPerBlock,
    });
    expect(summarise(decoded)).toEqual(c.expected);
  });

  it('the damaged cases report what they say', () => {
    const reasons = Object.fromEntries(
      vectors.damaged.map((c) => [c.name, c.expected.pageIssues.map((i) => i.reason)]),
    );
    expect(reasons).toEqual({
      crc_flip: ['crc_mismatch'],
      mac_flip_recrc: ['mac_mismatch'],
      torn_write: ['torn_write'],
      uncorrectable_ecc: ['uncorrectable_ecc'],
      bad_block_skip: ['bad_block'],
      erased_and_other_order: [],
    });
    const byName = new Map(vectors.damaged.map((c) => [c.name, c.expected.segments[0]]));
    expect(byName.get('bad_block_skip')?.complete).toBe(true);
    expect(byName.get('erased_and_other_order')?.complete).toBe(true);
    expect(byName.get('torn_write')).toMatchObject({ closed: false, complete: false });
    expect(byName.get('crc_flip')).toMatchObject({ closed: true, complete: false });
  });

  it('the pod_raw sample opens against its manifest and decodes', () => {
    const bytes = new Uint8Array(readFileSync(POD_RAW_PATH));
    const { pages } = readPodRawFile(bytes, vectors.podRaw.manifest);
    const decoded = summarise(decodeLog({ pages, keyForEpoch: keyOf }));
    expect(decoded).toEqual(vectors.segment.expected);
  });

  it('time base queries', () => {
    const base = buildTimeBase(70_000, vectors.timeline.anchors);
    for (const q of vectors.timeline.queries) {
      expect(tickToGnssMs(base, q.tick)).toBe(q.gnssTimeMs);
    }
    // Before the first PPS, 5 s after the dock anchor (12 ms off): between the two.
    const before = (vectors.timeline.queries[1]?.gnssTimeMs ?? 0) - 1_446_000_005_000;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(12);
  });

  it('capacity table', () => {
    expect(vectors.capacity.map((c) => [c.pagesPerHour, c.sessions3hW25N04KV])).toEqual([
      [4510, 18],
      [8117, 10],
      [5159, 16],
      [8795, 9],
    ]);
  });
});
