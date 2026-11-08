import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  LogWriter,
  RTC_TICK_HZ,
  buildPodRawFile,
  deriveStorageKey,
  fromHex,
  scanNand,
  unixMsToGnssMs,
  type LogRecord,
  type NandPageRead,
  type PodRawManifest,
} from '@sport-performance/pod-protocol';

/**
 * Test recordings of a pod (B-916), written with the protocol's reference
 * encoder under the **test** master key of the committed vectors
 * (`fixtures/v1/log-vectors.json`): never a real key.
 */

const require = createRequire(import.meta.url);

export const LOG_VECTORS = JSON.parse(
  readFileSync(
    require.resolve('@sport-performance/pod-protocol/fixtures/v1/log-vectors.json'),
    'utf8',
  ),
) as {
  keys: { masterKeyHex: string; deviceIdHex: string };
  podRaw: { manifest: PodRawManifest };
};

/** The committed `pod_raw` sample and its manifest. */
export const POD_RAW_SAMPLE = {
  bytes: new Uint8Array(
    readFileSync(require.resolve('@sport-performance/pod-protocol/fixtures/v1/pod-raw-sample.bin')),
  ),
  manifest: LOG_VECTORS.podRaw.manifest,
};

export const TEST_MASTER_KEY = fromHex(LOG_VECTORS.keys.masterKeyHex);
export const TEST_MASTER_KEY_BASE64 = Buffer.from(TEST_MASTER_KEY).toString('base64');
export const TEST_DEVICE_ID_HEX = LOG_VECTORS.keys.deviceIdHex;

const PAGES_PER_BLOCK = 64;
const START_TICK = 1_000_000;

export interface RecordingOptions {
  readonly deviceIdHex?: string;
  readonly startUnixMs: number;
  readonly durationS: number;
  readonly bootCounter?: number;
  readonly segmentId?: number;
  readonly firstPageSeq?: number;
  readonly keyEpoch?: number;
  /** Seconds with a PPS anchor (default: every second). */
  readonly anchorEveryS?: number;
  /** Stop after this many anchors (a weak time base). */
  readonly maxAnchors?: number;
  readonly firstBlock?: number;
  readonly podSerial?: string;
}

/**
 * A closed segment of `durationS` seconds: versions, PPS anchors, PVT at
 * 10 Hz moving north at 3 m/s and the recording markers, as a `pod_raw`
 * file with its manifest.
 */
export function podRecording(options: RecordingOptions): {
  bytes: Uint8Array;
  manifest: PodRawManifest;
} {
  const deviceIdHex = options.deviceIdHex ?? TEST_DEVICE_ID_HEX;
  const deviceId = fromHex(deviceIdHex);
  const keyEpoch = options.keyEpoch ?? 2;
  const startGnss = unixMsToGnssMs(options.startUnixMs);
  const tickAt = (s: number) => START_TICK + Math.round(s * RTC_TICK_HZ);
  const records: { t: number; order: number; record: LogRecord }[] = [];
  const at = (t: number, record: LogRecord, order = 5) => records.push({ t, order, record });
  at(
    0,
    { type: 'segment_marker', tick: tickAt(0), kind: 'recording_start', reason: 'undocked' },
    0,
  );
  at(
    0,
    {
      type: 'firmware_info',
      tick: tickAt(0),
      firmwareVersion: { major: 0, minor: 3, patch: 1 },
      firmwareBuildId: 0x87c1_2bec,
      hardwareRevision: 0,
      algorithmVersion: 1,
      radioProtocolVersion: 1,
      logFormatVersion: 1,
      gnssFirmware: 'LC29HAANR11A03S',
    },
    1,
  );
  const every = options.anchorEveryS ?? 1;
  let anchors = 0;
  for (let s = 0; s <= options.durationS; s += every) {
    if (options.maxAnchors !== undefined && anchors >= options.maxAnchors) break;
    anchors += 1;
    at(
      s,
      {
        type: 'time_anchor',
        tick: tickAt(s),
        source: 'gnss_pps',
        subTickNs: 0,
        gnssTimeMs: startGnss + s * 1000,
        uncertaintyUs: 1,
        gpsUtcOffsetS: 18,
      },
      2,
    );
  }
  for (let k = 0; k < options.durationS * 10; k += 1) {
    const s = k / 10;
    at(s, {
      type: 'gnss_pvt',
      tick: tickAt(s),
      gnssTimeMs: startGnss + k * 100,
      latE7: -345_123_456 + k * 27,
      lonE7: -585_123_456,
      heightEllipsoidMm: 21_300,
      velNorthMmS: 3000,
      velEastMmS: 0,
      velDownMmS: 0,
      groundSpeedMmS: 3000,
      headingCentiDeg: 0,
      hAccMm: 1400,
      vAccMm: 2100,
      speedAccMmS: 120,
      fixQuality: 'fix_3d',
      satellitesN: 24,
    });
  }
  at(
    options.durationS,
    {
      type: 'segment_marker',
      tick: tickAt(options.durationS),
      kind: 'recording_stop',
      reason: 'docked',
    },
    9,
  );
  records.sort((a, b) => a.t - b.t || a.order - b.order);
  const writer = new LogWriter({
    deviceId,
    bootCounter: options.bootCounter ?? 70_000,
    segmentId: options.segmentId ?? 5,
    firstPageSeq: options.firstPageSeq ?? 4096,
    keyEpoch,
    storageKey: deriveStorageKey({ masterKey: TEST_MASTER_KEY, deviceId, epoch: keyEpoch }),
  });
  const sealed: Uint8Array[] = [];
  for (const { record } of records) sealed.push(...writer.append(record));
  sealed.push(...writer.close());
  const firstBlock = options.firstBlock ?? 8;
  const pages: NandPageRead[] = sealed.map((data, i) => ({
    physicalPage: firstBlock * PAGES_PER_BLOCK + i,
    data,
    ecc: 'ok',
  }));
  // The dock reads every page of the segment's blocks: the rest of the last block is erased.
  const blocks = Math.ceil(pages.length / PAGES_PER_BLOCK);
  const erased = new Uint8Array(2048).fill(0xff);
  const full: NandPageRead[] = [...pages];
  for (let i = pages.length; i < blocks * PAGES_PER_BLOCK; i += 1) {
    full.push({ physicalPage: firstBlock * PAGES_PER_BLOCK + i, data: erased, ecc: 'ok' });
  }
  const [segment] = scanNand({ pages: full }).segments;
  if (segment === undefined) throw new Error('no segment');
  return buildPodRawFile({
    segment,
    pages,
    podSerial: options.podSerial ?? 'ORC-0001',
    startUnixMs: options.startUnixMs,
    endUnixMs: options.startUnixMs + options.durationS * 1000,
  });
}
