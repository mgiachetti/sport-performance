import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { toHex } from '../bytes.js';
import { PodProtocolError, type PodProtocolErrorCode } from '../errors.js';
import {
  keysFor,
  TEST_DEVICE_ID,
  NandSimulator,
  syntheticSession,
  writeSegment,
} from '../testing/log-samples.js';
import { decodeLog } from './decoder.js';
import { scanNand } from './nand.js';
import {
  buildPodRawFile,
  POD_RAW_ENTRY_LENGTH,
  POD_RAW_HEADER_LENGTH,
  readPodRawFile,
  type PodRawManifest,
} from './pod-raw.js';
import { gnssMsToUnixMs } from './timeline.js';

function codeOf(fn: () => unknown): PodProtocolErrorCode | 'none' {
  try {
    fn();
    return 'none';
  } catch (error) {
    if (error instanceof PodProtocolError) return error.code;
    throw error;
  }
}

function setup() {
  const nand = new NandSimulator();
  nand.badBlocks.add(9);
  nand.writeSegment(writeSegment(syntheticSession({ durationS: 50 })));
  const dump = nand.dump();
  const scan = scanNand({ pages: dump, geometry: nand.geometry, badBlocks: [9] });
  const [segment] = scan.segments;
  if (!segment) throw new Error('no segment');
  const pages = dump.filter(
    (p) =>
      segment.blocks.includes(Math.floor(p.physicalPage / 64)) && !p.data.every((b) => b === 0xff),
  );
  return { segment, pages };
}

describe('pod_raw file', () => {
  const { segment, pages } = setup();
  const { bytes, manifest } = buildPodRawFile({
    segment,
    pages,
    podSerial: 'ORC-0001',
    startUnixMs: gnssMsToUnixMs(1_446_000_000_000),
    endUnixMs: gnssMsToUnixMs(1_446_000_050_000),
  });

  it('carries the encrypted pages as on the NAND with a manifest', () => {
    expect(bytes.length).toBe(POD_RAW_HEADER_LENGTH + pages.length * POD_RAW_ENTRY_LENGTH);
    expect(toHex(bytes.subarray(0, 8))).toBe('5350525701010008');
    expect(manifest).toMatchObject({
      kind: 'pod_raw',
      containerVersion: 1,
      logFormatVersion: 1,
      podSerial: 'ORC-0001',
      bootCounter: 70_000,
      segmentId: 5,
      firstPageSeq: segment.firstPageSeq,
      lastPageSeq: segment.lastPageSeq,
      pagesN: pages.length,
      blocks: segment.blocks,
      keyEpochs: [2],
      closed: true,
      sizeB: bytes.length,
    });
    expect(manifest.sha256Hex).toBe(createHash('sha256').update(bytes).digest('hex'));
    // The page bytes are untouched (still CTR + CMAC).
    expect(
      toHex(
        bytes.subarray(POD_RAW_HEADER_LENGTH + 8, POD_RAW_ENTRY_LENGTH + POD_RAW_HEADER_LENGTH),
      ),
    ).toBe(toHex(pages[0]?.data ?? new Uint8Array()));
  });

  it('the worker reads it back and decodes the segment', () => {
    const read = readPodRawFile(bytes, manifest);
    expect(read.pages.map((p) => p.physicalPage)).toEqual(pages.map((p) => p.physicalPage));
    const decoded = decodeLog({
      pages: read.pages,
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.segments[0]).toMatchObject({ segmentId: 5, complete: true });
  });

  it('rejects a file that does not match its manifest or is malformed', () => {
    const flipped = bytes.slice();
    flipped[5_000] = (flipped[5_000] ?? 0) ^ 1;
    expect(codeOf(() => readPodRawFile(flipped, manifest))).toBe('manifest_mismatch');
    const wrongSegment: PodRawManifest = { ...manifest, segmentId: 6 };
    expect(() => readPodRawFile(bytes, wrongSegment)).toThrow('segmentId');
    expect(codeOf(() => readPodRawFile(bytes.subarray(0, bytes.length - 1)))).toBe(
      'invalid_container',
    );
    const magic = bytes.slice();
    magic[0] = 0;
    expect(codeOf(() => readPodRawFile(magic))).toBe('invalid_container');
    const version = bytes.slice();
    version[4] = 2;
    expect(codeOf(() => readPodRawFile(version))).toBe('unsupported_version');
    const ecc = bytes.slice();
    ecc[POD_RAW_HEADER_LENGTH + 4] = 9;
    expect(codeOf(() => readPodRawFile(ecc))).toBe('invalid_container');
  });

  it('keeps the ECC status of each read', () => {
    const marked = pages.map((p, i) => (i === 3 ? { ...p, ecc: 'uncorrectable' as const } : p));
    const file = buildPodRawFile({
      segment,
      pages: marked,
      podSerial: 'x',
      startUnixMs: null,
      endUnixMs: null,
    });
    const read = readPodRawFile(file.bytes, file.manifest);
    expect(read.pages[3]?.ecc).toBe('uncorrectable');
    const decoded = decodeLog({
      pages: read.pages,
      deviceId: TEST_DEVICE_ID,
      keyForEpoch: keysFor(2),
    });
    expect(decoded.pageIssues).toEqual([
      { physicalPage: pages[3]?.physicalPage, reason: 'uncorrectable_ecc' },
    ]);
  });
});
