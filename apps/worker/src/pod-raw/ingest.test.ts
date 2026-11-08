import {
  decodeLog,
  deriveStorageKey,
  fromHex,
  gnssMsToUnixMs,
  readPodRawFile,
  verifyUploadForErase,
} from '@sport-performance/pod-protocol';
import { describe, expect, it } from 'vitest';
import {
  POD_RAW_SAMPLE,
  TEST_MASTER_KEY,
  TEST_MASTER_KEY_BASE64,
  podRecording,
} from '../testing/pod-recording.js';
import { decodeIssues, pagesInWindows, traceChunks, traceSamples } from './ingest.js';
import { parsePodMasterKeys, staticPodKeyProvider } from './keys.js';

function decode(bytes: Uint8Array, manifest = POD_RAW_SAMPLE.manifest) {
  const { pages } = readPodRawFile(bytes, manifest);
  const deviceId = fromHex(manifest.deviceIdHex);
  const decoded = decodeLog({
    pages,
    deviceId,
    keyForEpoch: (epoch) => deriveStorageKey({ masterKey: TEST_MASTER_KEY, deviceId, epoch }),
  });
  const segment = decoded.segments[0];
  if (segment === undefined) throw new Error('no segment');
  const base = decoded.timeBases.find((b) => b.bootCounter === segment.bootCounter);
  return { pages, decoded, segment, base };
}

describe('master keys from the environment', () => {
  const club = '7a3f0f0e-0000-4000-8000-000000000001';

  it('parses club:key pairs of 32 bytes and never echoes a key', async () => {
    const parsed = parsePodMasterKeys(` ${club}:${TEST_MASTER_KEY_BASE64} ,`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const provider = staticPodKeyProvider(parsed.keys);
    expect(await provider.masterKey(club as never)).toEqual(TEST_MASTER_KEY);
    expect(await provider.masterKey('7a3f0f0e-0000-4000-8000-000000000002' as never)).toBeNull();
    for (const bad of [
      `not-a-club:${TEST_MASTER_KEY_BASE64}`,
      `${club}:c2hvcnQ=`,
      `${club}:${TEST_MASTER_KEY_BASE64},${club}:${TEST_MASTER_KEY_BASE64}`,
    ]) {
      const result = parsePodMasterKeys(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).not.toContain(TEST_MASTER_KEY_BASE64);
    }
    expect(parsePodMasterKeys('')).toEqual({ ok: true, keys: new Map() });
  });
});

describe('the committed pod_raw sample', () => {
  it('verifies with the test keys and reports a clean time base', () => {
    const { pages, decoded, segment } = decode(POD_RAW_SAMPLE.bytes);
    expect(verifyUploadForErase({ manifest: POD_RAW_SAMPLE.manifest, pages, decoded }).ok).toBe(
      true,
    );
    // Two PPS anchors and the dock's at the end: enough for a confident base.
    expect(decodeIssues(decoded, segment)).toEqual([]);
  });

  it('keeps the 1 Hz samples and the pages of a window only', () => {
    const { segment, base } = decode(POD_RAW_SAMPLE.bytes);
    const first = gnssMsToUnixMs(segment.streams.pvt[0]?.gnssTimeMs ?? 0);
    const all = [{ startMs: first - 10_000, endMs: first + 10_000 }];
    const samples = traceSamples(segment, base, all);
    expect(samples.map((s) => s.timeMs - first)).toEqual([0, 1000]);
    expect(samples[0]).toMatchObject({ latE7: -345_123_456, speedMmS: 3027, fix: 3 });
    expect(traceChunks(samples)).toHaveLength(1);
    expect(pagesInWindows(segment, base, all).keep.size).toBe(segment.pagesN);
    const none = [{ startMs: first + 60_000, endMs: first + 120_000 }];
    expect(traceSamples(segment, base, none)).toEqual([]);
    expect(pagesInWindows(segment, base, none).keep.size).toBe(0);
  });
});

describe('a longer recording', () => {
  const start = Date.parse('2026-11-04T21:00:00Z');
  const { bytes, manifest } = podRecording({ startUnixMs: start, durationS: 120 });

  it('trims to the window, at 1 Hz, split at gaps', () => {
    const { segment, base } = decode(bytes, manifest);
    const windows = [
      { startMs: start + 10_000, endMs: start + 40_000 },
      { startMs: start + 60_000, endMs: start + 70_000 },
    ];
    const samples = traceSamples(segment, base, windows);
    expect(samples).toHaveLength(40);
    expect(traceChunks(samples).map((c) => c.length)).toEqual([30, 10]);
    const pages = pagesInWindows(segment, base, windows);
    expect(pages.untimed).toBe(0);
    expect(pages.keep.size).toBeGreaterThan(0);
    expect(pages.keep.size).toBeLessThan(segment.pagesN);
  });

  it('reports a weak time base', () => {
    const weak = podRecording({ startUnixMs: start, durationS: 30, maxAnchors: 2 });
    const { decoded, segment } = decode(weak.bytes, weak.manifest);
    expect(decodeIssues(decoded, segment)).toContainEqual({
      code: 'time_base_few_anchors',
      count: 2,
    });
  });
});
