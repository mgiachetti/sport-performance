import { ByteReader, equalBytes, toHex } from '../bytes.js';
import { PodProtocolError } from '../errors.js';
import { RTC_TICK_HZ } from './constants.js';
import { deriveLogPageKeys, type LogPageKeys } from './integrity.js';
import { inspectLogPage, openLogPage, type LogPageHeader } from './page.js';
import {
  decodeRecordBody,
  RECORD_HEADER_LENGTH,
  type BaroBatchRecord,
  type ConfigAppliedRecord,
  type EventRecord,
  type FirmwareInfoRecord,
  type GnssPvtRecord,
  type GnssRawRecord,
  type HealthRecord,
  type ImuBatchRecord,
  type ImuChannel,
  type LogRecord,
  type RadioTxRecord,
  type SegmentMarkerRecord,
  type SensorSyncRecord,
  type TimeAnchorRecord,
  type UnknownRecord,
} from './records.js';
import {
  buildSensorClock,
  buildTimeBase,
  sensorTimestampToTick,
  tickToGnssMs,
  type SensorClock,
  type TimeBase,
} from './timeline.js';

/** ECC status of a read, from the W25N status register (ECC-1, ECC-0). */
export const ECC_STATUSES = ['ok', 'corrected', 'uncorrectable'] as const;
export type EccStatus = (typeof ECC_STATUSES)[number];

/** One page as read from the NAND (or from a `pod_raw` file). */
export interface NandPageRead {
  /** block × pages per block + page in block. */
  physicalPage: number;
  data: Uint8Array;
  ecc?: EccStatus;
}

export type PageIssueReason =
  | 'bad_block'
  | 'uncorrectable_ecc'
  | 'crc_mismatch'
  | 'torn_write'
  | 'invalid_header'
  | 'other_device'
  | 'unknown_key_epoch'
  | 'mac_mismatch'
  | 'duplicate_page';

export interface PageIssue {
  physicalPage: number;
  reason: PageIssueReason;
  /** From the header when it could be read. */
  pageSeq?: number;
  detail?: string;
}

export type RecordIssueReason =
  | 'malformed_record'
  | 'invalid_record_type'
  | 'record_misaligned'
  | 'truncated_by_gap'
  | 'truncated_at_end';

export interface RecordIssue {
  reason: RecordIssueReason;
  /** Byte offset in the segment stream. */
  streamOffset: number;
  typeCode?: number;
  detail?: string;
}

export interface ImuTiming {
  /** Fractional RTC ticks of the first and last sample. */
  firstSampleTick: number;
  lastSampleTick: number;
  /** `sensor_sync`: from the sensor timestamps; `read_time`: back from the FIFO read at the ODR. */
  timeSource: 'sensor_sync' | 'read_time';
}

export interface DecodedPvt extends GnssPvtRecord {
  /** The epoch overlaps a LoRa transmission (`null`: no time base to tell). */
  duringRadioTx: boolean | null;
}

export interface LogStreams {
  firmware: FirmwareInfoRecord[];
  config: ConfigAppliedRecord[];
  pvt: DecodedPvt[];
  raw: GnssRawRecord[];
  imu: (ImuBatchRecord & ImuTiming)[];
  baro: BaroBatchRecord[];
  anchors: TimeAnchorRecord[];
  sensorSyncs: SensorSyncRecord[];
  markers: SegmentMarkerRecord[];
  health: HealthRecord[];
  radioTx: RadioTxRecord[];
  events: EventRecord[];
  unknown: UnknownRecord[];
}

export type LogGap =
  | {
      /** Bytes of the stream missing between two readable pages (lost or unreadable pages). */
      kind: 'stream';
      afterPageSeq: number | null;
      beforePageSeq: number;
      lostBytes: number;
    }
  | {
      /** Two authentic pages cover the same stream bytes: the later one is skipped. */
      kind: 'stream_overlap';
      afterPageSeq: number;
      beforePageSeq: number;
      overlapBytes: number;
    }
  | {
      /** The segment has no readable closing page: its end was lost (power cut, bad page). */
      kind: 'stream_end';
      afterPageSeq: number;
    }
  | {
      kind: 'gnss_pvt';
      fromGnssMs: number;
      toGnssMs: number;
      missingEpochsN: number;
    }
  | {
      kind: 'imu';
      channel: ImuChannel;
      fromTick: number;
      toTick: number;
      reason: 'fifo_overrun' | 'timestamp_jump';
    }
  | { kind: 'baro'; fromTick: number; toTick: number };

export type UseIntervalKind = 'recording' | 'worn' | 'moving';

/** Intervals of use from the segment markers (the staff session owns the window, not these). */
export interface UseInterval {
  kind: UseIntervalKind;
  startTick: number;
  endTick: number;
  startGnssMs: number | null;
  endGnssMs: number | null;
  /** The opening or closing marker was missing (lost in a gap or never written). */
  truncated: boolean;
}

export interface DecodedSegment {
  deviceIdHex: string;
  bootCounter: number;
  segmentId: number;
  keyEpochs: number[];
  firstPageSeq: number;
  lastPageSeq: number;
  /** Pages decoded (copies of the same stream bytes counted once). */
  pagesN: number;
  /** Pages that passed CRC and CMAC, copies included: what the pod's scan counts as valid. */
  authenticPagesN: number;
  /** The closing page (segment-end flag) was read. */
  closed: boolean;
  /** Closed and without any stream gap. */
  complete: boolean;
  streamBytes: number;
  tickRange: { first: number; last: number } | null;
  gnssTimeRange: { startMs: number; endMs: number } | null;
  streams: LogStreams;
  gaps: LogGap[];
  intervals: UseInterval[];
  recordIssues: RecordIssue[];
}

export interface DecodedLog {
  segments: DecodedSegment[];
  /** One per boot counter seen. */
  timeBases: TimeBase[];
  pageIssues: PageIssue[];
  stats: { pagesRead: number; pagesErased: number; pagesValid: number; pagesSkipped: number };
}

export interface DecodeLogInput {
  pages: readonly NandPageRead[];
  /** Storage key of each key epoch (`deriveStorageKey`); `undefined` = not available. */
  keyForEpoch: (keyEpoch: number) => Uint8Array | undefined;
  /**
   * The pod the pages must come from (from the `pod_raw` manifest checked
   * against the device table). Required: the worker never decodes pages
   * without knowing whose they are; pages of another pod are reported and
   * skipped.
   */
  deviceId: Uint8Array;
  /** Bad blocks (factory marker or grown, from the pod's table): their pages are skipped. */
  badBlocks?: readonly number[];
  pagesPerBlock?: number;
}

interface OpenedPage {
  physicalPage: number;
  header: LogPageHeader;
  payload: Uint8Array;
}

function emptyStreams(): LogStreams {
  return {
    firmware: [],
    config: [],
    pvt: [],
    raw: [],
    imu: [],
    baro: [],
    anchors: [],
    sensorSyncs: [],
    markers: [],
    health: [],
    radioTx: [],
    events: [],
    unknown: [],
  };
}

function errorCode(error: unknown): string {
  return error instanceof PodProtocolError ? error.code : 'unknown';
}

// ---------------------------------------------------------------------------
// Page validation
// ---------------------------------------------------------------------------

function openPages(input: DecodeLogInput): {
  opened: OpenedPage[];
  issues: PageIssue[];
  stats: DecodedLog['stats'];
} {
  const pagesPerBlock = input.pagesPerBlock ?? 64;
  const badBlocks = new Set(input.badBlocks ?? []);
  const issues: PageIssue[] = [];
  const opened: OpenedPage[] = [];
  const stats = { pagesRead: 0, pagesErased: 0, pagesValid: 0, pagesSkipped: 0 };
  const reportedBadBlocks = new Set<number>();
  /** Page keys derived once per epoch. */
  const derivedKeys = new Map<number, LogPageKeys>();

  for (const read of input.pages) {
    stats.pagesRead += 1;
    const block = Math.floor(read.physicalPage / pagesPerBlock);
    if (badBlocks.has(block)) {
      stats.pagesSkipped += 1;
      if (!reportedBadBlocks.has(block)) {
        reportedBadBlocks.add(block);
        issues.push({ physicalPage: block * pagesPerBlock, reason: 'bad_block' });
      }
      continue;
    }
    if (read.ecc === 'uncorrectable') {
      stats.pagesSkipped += 1;
      issues.push({ physicalPage: read.physicalPage, reason: 'uncorrectable_ecc' });
      continue;
    }
    const inspection = inspectLogPage(read.data);
    if (inspection.status === 'erased') {
      stats.pagesErased += 1;
      continue;
    }
    if (inspection.status === 'crc_mismatch') {
      stats.pagesSkipped += 1;
      issues.push({
        physicalPage: read.physicalPage,
        reason: inspection.torn ? 'torn_write' : 'crc_mismatch',
      });
      continue;
    }
    if (inspection.status === 'invalid_header') {
      stats.pagesSkipped += 1;
      issues.push({
        physicalPage: read.physicalPage,
        reason: 'invalid_header',
        detail: inspection.code,
      });
      continue;
    }
    const { header } = inspection;
    if (!equalBytes(input.deviceId, header.deviceId)) {
      stats.pagesSkipped += 1;
      issues.push({
        physicalPage: read.physicalPage,
        reason: 'other_device',
        pageSeq: header.pageSeq,
      });
      continue;
    }
    let key = derivedKeys.get(header.keyEpoch);
    if (!key) {
      const storageKey = input.keyForEpoch(header.keyEpoch);
      key = storageKey ? deriveLogPageKeys(storageKey) : undefined;
      if (key) {
        derivedKeys.set(header.keyEpoch, key);
      }
    }
    if (!key) {
      stats.pagesSkipped += 1;
      issues.push({
        physicalPage: read.physicalPage,
        reason: 'unknown_key_epoch',
        pageSeq: header.pageSeq,
        detail: `epoch ${String(header.keyEpoch)}`,
      });
      continue;
    }
    try {
      const payload = openLogPage({ page: read.data, header, storageKey: key });
      opened.push({ physicalPage: read.physicalPage, header, payload });
      stats.pagesValid += 1;
    } catch (error) {
      stats.pagesSkipped += 1;
      issues.push({
        physicalPage: read.physicalPage,
        reason: 'mac_mismatch',
        pageSeq: header.pageSeq,
        detail: errorCode(error),
      });
    }
  }
  return { opened, issues, stats };
}

// ---------------------------------------------------------------------------
// Stream → records
// ---------------------------------------------------------------------------

interface Run {
  pages: OpenedPage[];
  /** Stream offset of the first byte of the run. */
  streamOffset: number;
  bytes: Uint8Array;
  /** Run-relative positions where a record is known to start (one per page that has one). */
  recordStarts: number[];
  /** The run ends at a gap (more stream follows after missing bytes). */
  endsAtGap: boolean;
}

function buildRuns(pages: OpenedPage[], closed: boolean): { runs: Run[]; gaps: LogGap[] } {
  const runs: Run[] = [];
  const gaps: LogGap[] = [];
  let current: OpenedPage[] = [];
  const flush = (endsAtGap: boolean): void => {
    const first = current[0];
    if (!first) {
      return;
    }
    const total = current.reduce((sum, p) => sum + p.payload.length, 0);
    const bytes = new Uint8Array(total);
    const recordStarts: number[] = [];
    let at = 0;
    for (const page of current) {
      bytes.set(page.payload, at);
      if (page.header.firstRecordOffset !== null) {
        recordStarts.push(at + page.header.firstRecordOffset);
      }
      at += page.payload.length;
    }
    runs.push({
      pages: current,
      streamOffset: first.header.streamOffset,
      bytes,
      recordStarts,
      endsAtGap,
    });
    current = [];
  };
  let expected = 0;
  let previous: OpenedPage | null = null;
  for (const page of pages) {
    if (previous && page.header.streamOffset < expected) {
      // Authentic pages that overlap in the stream (a firmware bug): keep the
      // first, report the overlap, never a negative loss.
      gaps.push({
        kind: 'stream_overlap',
        afterPageSeq: previous.header.pageSeq,
        beforePageSeq: page.header.pageSeq,
        overlapBytes: expected - page.header.streamOffset,
      });
      continue;
    }
    if (page.header.streamOffset !== expected) {
      gaps.push({
        kind: 'stream',
        afterPageSeq: previous?.header.pageSeq ?? null,
        beforePageSeq: page.header.pageSeq,
        lostBytes: page.header.streamOffset - expected,
      });
      flush(true);
    }
    current.push(page);
    expected = page.header.streamOffset + page.header.payloadLength;
    previous = page;
  }
  flush(false);
  if (!closed && previous) {
    gaps.push({ kind: 'stream_end', afterPageSeq: previous.header.pageSeq });
  }
  return { runs, gaps };
}

function parseRun(run: Run, records: LogRecord[], issues: RecordIssue[]): void {
  const { bytes, recordStarts } = run;
  // A run that does not start the stream begins inside a record: resync at the
  // first record start a page header announces.
  let position = run.streamOffset === 0 ? 0 : (recordStarts[0] ?? bytes.length);
  let nextStart = 0;
  const advanceStarts = (after: number): void => {
    while (nextStart < recordStarts.length && (recordStarts[nextStart] ?? 0) <= after) {
      nextStart += 1;
    }
  };
  while (position < bytes.length) {
    advanceStarts(position);
    const remaining = bytes.length - position;
    const streamOffset = run.streamOffset + position;
    if (remaining < RECORD_HEADER_LENGTH) {
      issues.push({
        reason: run.endsAtGap ? 'truncated_by_gap' : 'truncated_at_end',
        streamOffset,
      });
      return;
    }
    const header = new ByteReader(bytes.subarray(position, position + RECORD_HEADER_LENGTH));
    const typeCode = header.u8();
    const length = header.u16();
    const tick = header.u48();
    const resyncAt = recordStarts[nextStart];
    if (typeCode === 0x00 || typeCode === 0xff) {
      issues.push({ reason: 'invalid_record_type', streamOffset, typeCode });
      if (resyncAt === undefined) {
        return;
      }
      position = resyncAt;
      continue;
    }
    const end = position + RECORD_HEADER_LENGTH + length;
    if (end > bytes.length) {
      issues.push({
        reason: run.endsAtGap ? 'truncated_by_gap' : 'truncated_at_end',
        streamOffset,
        typeCode,
      });
      return;
    }
    if (resyncAt !== undefined && end > resyncAt) {
      // The record would swallow a start a page header announces: corruption
      // the MAC did not catch (an encoder bug). Trust the page header.
      issues.push({ reason: 'record_misaligned', streamOffset, typeCode });
      position = resyncAt;
      continue;
    }
    try {
      records.push(
        decodeRecordBody(typeCode, tick, bytes.subarray(position + RECORD_HEADER_LENGTH, end)),
      );
    } catch (error) {
      issues.push({
        reason: 'malformed_record',
        streamOffset,
        typeCode,
        detail: errorCode(error),
      });
    }
    position = end;
  }
}

function sortStreams(records: readonly LogRecord[]): LogStreams {
  const streams = emptyStreams();
  for (const record of records) {
    switch (record.type) {
      case 'firmware_info':
        streams.firmware.push(record);
        break;
      case 'config_applied':
        streams.config.push(record);
        break;
      case 'gnss_pvt':
        streams.pvt.push({ ...record, duringRadioTx: null });
        break;
      case 'gnss_raw':
        streams.raw.push(record);
        break;
      case 'imu_batch':
        // Timing is filled once the sensor clock is known.
        streams.imu.push({
          ...record,
          firstSampleTick: record.tick,
          lastSampleTick: record.tick,
          timeSource: 'read_time',
        });
        break;
      case 'baro_batch':
        streams.baro.push(record);
        break;
      case 'time_anchor':
        streams.anchors.push(record);
        break;
      case 'sensor_sync':
        streams.sensorSyncs.push(record);
        break;
      case 'segment_marker':
        streams.markers.push(record);
        break;
      case 'health':
        streams.health.push(record);
        break;
      case 'radio_tx':
        streams.radioTx.push(record);
        break;
      case 'event':
        streams.events.push(record);
        break;
      case 'unknown':
        streams.unknown.push(record);
        break;
    }
  }
  return streams;
}

// ---------------------------------------------------------------------------
// Timing, gaps and intervals
// ---------------------------------------------------------------------------

function imuSamplePeriodTicks(batch: ImuBatchRecord): number {
  return (RTC_TICK_HZ * 1000) / batch.odrMilliHz;
}

function timeImu(streams: LogStreams, clocks: Map<string, SensorClock>): void {
  for (const batch of streams.imu) {
    const n = batch.samples.length;
    const clock = clocks.get(batch.sensor);
    const first = clock && sensorTimestampToTick(clock, batch.firstSensorTimestamp, batch.tick);
    const last = clock && sensorTimestampToTick(clock, batch.lastSensorTimestamp, batch.tick);
    if (typeof first === 'number' && typeof last === 'number') {
      batch.firstSampleTick = first;
      batch.lastSampleTick = last;
      batch.timeSource = 'sensor_sync';
    } else if (batch.odrMilliHz > 0) {
      // The record tick is the FIFO read: the last sample, the rest back at the ODR.
      batch.lastSampleTick = batch.tick;
      batch.firstSampleTick = batch.tick - Math.max(0, n - 1) * imuSamplePeriodTicks(batch);
    }
  }
}

function flagRadioTx(streams: LogStreams, base: TimeBase | undefined): void {
  if (!base || base.points.length === 0) {
    return;
  }
  const windows = streams.radioTx
    .map((tx) => {
      const start = tickToGnssMs(base, tx.tick);
      return start === null ? null : { start, end: start + tx.durationUs / 1000 };
    })
    .filter((w): w is { start: number; end: number } => w !== null)
    .sort((a, b) => a.start - b.start);
  const periodMs = 1000 / (streams.config.at(-1)?.gnssPvtRateHz ?? 10);
  let w = 0;
  for (const pvt of streams.pvt) {
    const epochStart = pvt.gnssTimeMs - periodMs;
    while (w < windows.length && (windows[w]?.end ?? 0) < epochStart) {
      w += 1;
    }
    const window = windows[w];
    pvt.duringRadioTx = window !== undefined && window.start <= pvt.gnssTimeMs;
  }
}

const U32 = 0x1_0000_0000;

function detectGaps(streams: LogStreams): LogGap[] {
  const gaps: LogGap[] = [];
  const pvtPeriodMs = 1000 / (streams.config.at(-1)?.gnssPvtRateHz ?? 10);
  for (let i = 1; i < streams.pvt.length; i += 1) {
    const a = streams.pvt[i - 1];
    const b = streams.pvt[i];
    if (a && b && b.gnssTimeMs - a.gnssTimeMs > 1.5 * pvtPeriodMs) {
      gaps.push({
        kind: 'gnss_pvt',
        fromGnssMs: a.gnssTimeMs,
        toGnssMs: b.gnssTimeMs,
        missingEpochsN: Math.round((b.gnssTimeMs - a.gnssTimeMs) / pvtPeriodMs) - 1,
      });
    }
  }
  const lastByChannel = new Map<ImuChannel, ImuBatchRecord & ImuTiming>();
  for (const batch of streams.imu) {
    if (batch.fifoOverrun) {
      gaps.push({
        kind: 'imu',
        channel: batch.channel,
        fromTick: lastByChannel.get(batch.channel)?.lastSampleTick ?? batch.firstSampleTick,
        toTick: batch.firstSampleTick,
        reason: 'fifo_overrun',
      });
    } else {
      const previous = lastByChannel.get(batch.channel);
      if (
        previous?.sensor === batch.sensor &&
        batch.odrMilliHz > 0 &&
        batch.sensorTickPeriodNs > 0
      ) {
        const periodSensor = 1e12 / (batch.odrMilliHz * batch.sensorTickPeriodNs);
        const step = (batch.firstSensorTimestamp - previous.lastSensorTimestamp + U32) % U32;
        if (step > 1.5 * periodSensor) {
          gaps.push({
            kind: 'imu',
            channel: batch.channel,
            fromTick: previous.lastSampleTick,
            toTick: batch.firstSampleTick,
            reason: 'timestamp_jump',
          });
        }
      }
    }
    lastByChannel.set(batch.channel, batch);
  }
  for (let i = 1; i < streams.baro.length; i += 1) {
    const a = streams.baro[i - 1];
    const b = streams.baro[i];
    if (a && b && b.odrMilliHz > 0) {
      const periodTicks = (RTC_TICK_HZ * 1000) / b.odrMilliHz;
      const lastA = a.tick + a.lastSampleDeltaTicks;
      if (b.tick - lastA > 1.5 * periodTicks) {
        gaps.push({ kind: 'baro', fromTick: lastA, toTick: b.tick });
      }
    }
  }
  return gaps;
}

const MARKER_INTERVAL: Partial<
  Record<SegmentMarkerRecord['kind'], { kind: UseIntervalKind; open: boolean }>
> = {
  recording_start: { kind: 'recording', open: true },
  recording_stop: { kind: 'recording', open: false },
  vest_on: { kind: 'worn', open: true },
  vest_off: { kind: 'worn', open: false },
  motion_start: { kind: 'moving', open: true },
  motion_stop: { kind: 'moving', open: false },
};

function buildIntervals(
  streams: LogStreams,
  range: { first: number; last: number } | null,
  base: TimeBase | undefined,
): UseInterval[] {
  if (!range) {
    return [];
  }
  const intervals: UseInterval[] = [];
  const open = new Map<UseIntervalKind, number>();
  const push = (kind: UseIntervalKind, start: number, end: number, truncated: boolean): void => {
    intervals.push({
      kind,
      startTick: start,
      endTick: end,
      startGnssMs: base ? tickToGnssMs(base, start) : null,
      endGnssMs: base ? tickToGnssMs(base, end) : null,
      truncated,
    });
  };
  for (const marker of streams.markers) {
    const rule = MARKER_INTERVAL[marker.kind];
    if (!rule) {
      continue;
    }
    const started = open.get(rule.kind);
    if (rule.open) {
      if (started === undefined) {
        open.set(rule.kind, marker.tick);
      }
    } else if (started !== undefined) {
      push(rule.kind, started, marker.tick, false);
      open.delete(rule.kind);
    } else {
      push(rule.kind, range.first, marker.tick, true);
    }
  }
  for (const [kind, start] of open) {
    push(kind, start, range.last, true);
  }
  return intervals.sort((a, b) => a.startTick - b.startTick || a.kind.localeCompare(b.kind));
}

function tickRangeOf(records: readonly LogRecord[]): { first: number; last: number } | null {
  if (records.length === 0) {
    return null;
  }
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    first = Math.min(first, record.tick);
    last = Math.max(last, record.tick);
  }
  return { first, last };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function dedupe(pages: OpenedPage[], issues: PageIssue[]): OpenedPage[] {
  const out: OpenedPage[] = [];
  for (const page of pages) {
    const previous = out.at(-1);
    if (previous?.header.streamOffset === page.header.streamOffset) {
      // A page programmed twice (a failed program that still reads, then its
      // rewrite in the next block): identical payloads are the same data.
      if (!equalBytes(previous.payload, page.payload)) {
        issues.push({
          physicalPage: page.physicalPage,
          reason: 'duplicate_page',
          pageSeq: page.header.pageSeq,
          detail: 'differs from the first copy',
        });
      }
      continue;
    }
    out.push(page);
  }
  return out;
}

/**
 * Decodes NAND pages (a whole dump or one `pod_raw` file) for the worker:
 * validates CRC and CMAC, decrypts, rebuilds each segment's record stream,
 * parses typed records, reconstructs the time base of each boot from its
 * anchors, times the IMU from its FIFO timestamps, flags GNSS epochs that
 * overlap a LoRa transmission and reports gaps, unreadable pages and use
 * intervals. Never throws on bad data: everything is reported.
 */
export function decodeLog(input: DecodeLogInput): DecodedLog {
  const { opened, issues, stats } = openPages(input);

  const bySegment = new Map<string, OpenedPage[]>();
  for (const page of opened) {
    const key = `${toHex(page.header.deviceId)}/${String(page.header.bootCounter)}/${String(page.header.segmentId)}`;
    const list = bySegment.get(key) ?? [];
    list.push(page);
    bySegment.set(key, list);
  }

  const partial: {
    segment: Omit<DecodedSegment, 'intervals' | 'gnssTimeRange'>;
    records: LogRecord[];
  }[] = [];
  const anchorsByBoot = new Map<number, TimeAnchorRecord[]>();
  for (const list of bySegment.values()) {
    // Stream order; a rewritten copy (same offset, later sequence) comes after the first.
    list.sort(
      (a, b) =>
        a.header.streamOffset - b.header.streamOffset ||
        a.header.pageSeq - b.header.pageSeq ||
        a.physicalPage - b.physicalPage,
    );
    const pages = dedupe(list, issues);
    const first = pages[0];
    const last = pages.at(-1);
    if (!first || !last) {
      continue;
    }
    const closed = last.header.segmentEnd;
    const { runs, gaps } = buildRuns(pages, closed);
    const records: LogRecord[] = [];
    const recordIssues: RecordIssue[] = [];
    for (const run of runs) {
      parseRun(run, records, recordIssues);
    }
    const streams = sortStreams(records);
    const anchors = anchorsByBoot.get(first.header.bootCounter) ?? [];
    anchors.push(...streams.anchors);
    anchorsByBoot.set(first.header.bootCounter, anchors);
    partial.push({
      segment: {
        deviceIdHex: toHex(first.header.deviceId),
        bootCounter: first.header.bootCounter,
        segmentId: first.header.segmentId,
        keyEpochs: [...new Set(pages.map((p) => p.header.keyEpoch))],
        firstPageSeq: Math.min(...pages.map((p) => p.header.pageSeq)),
        lastPageSeq: Math.max(...pages.map((p) => p.header.pageSeq)),
        pagesN: pages.length,
        authenticPagesN: list.length,
        closed,
        complete: closed && gaps.length === 0 && first.header.streamOffset === 0,
        streamBytes: last.header.streamOffset + last.header.payloadLength,
        tickRange: tickRangeOf(records),
        streams,
        gaps,
        recordIssues,
      },
      records,
    });
  }

  const timeBases = [...anchorsByBoot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([boot, anchors]) =>
      buildTimeBase(
        boot,
        [...anchors].sort((a, b) => a.tick - b.tick),
      ),
    );
  const baseByBoot = new Map(timeBases.map((b) => [b.bootCounter, b]));

  const syncsByBoot = new Map<number, SensorSyncRecord[]>();
  for (const { segment } of partial) {
    const list = syncsByBoot.get(segment.bootCounter) ?? [];
    list.push(...segment.streams.sensorSyncs);
    syncsByBoot.set(segment.bootCounter, list);
  }

  const segments: DecodedSegment[] = partial.map(({ segment }) => {
    const base = baseByBoot.get(segment.bootCounter);
    const syncs = [...(syncsByBoot.get(segment.bootCounter) ?? [])].sort((a, b) => a.tick - b.tick);
    const clocks = new Map<string, SensorClock>();
    for (const sensor of new Set(syncs.map((s) => s.sensor))) {
      // The nominal period of the sensor's counter comes from its batches.
      const period =
        segment.streams.imu.find((b) => b.sensor === sensor && b.sensorTickPeriodNs > 0)
          ?.sensorTickPeriodNs ?? 0;
      clocks.set(sensor, buildSensorClock(sensor, syncs, period));
    }
    timeImu(segment.streams, clocks);
    flagRadioTx(segment.streams, base);
    const range = segment.tickRange;
    const start = base && range ? tickToGnssMs(base, range.first) : null;
    const end = base && range ? tickToGnssMs(base, range.last) : null;
    return {
      ...segment,
      gaps: [...segment.gaps, ...detectGaps(segment.streams)],
      intervals: buildIntervals(segment.streams, range, base),
      gnssTimeRange: start !== null && end !== null ? { startMs: start, endMs: end } : null,
    };
  });
  segments.sort(
    (a, b) =>
      a.deviceIdHex.localeCompare(b.deviceIdHex) ||
      a.bootCounter - b.bootCounter ||
      a.segmentId - b.segmentId,
  );

  return { segments, timeBases, pageIssues: issues, stats };
}

/** Splits a contiguous dump (pages of `pageSizeB`, data area only) into page reads. */
export function pagesFromDump(
  dump: Uint8Array,
  options: { pageSizeB?: number; firstPhysicalPage?: number } = {},
): NandPageRead[] {
  const size = options.pageSizeB ?? 2048;
  const first = options.firstPhysicalPage ?? 0;
  const pages: NandPageRead[] = [];
  for (let offset = 0; offset + size <= dump.length; offset += size) {
    pages.push({ physicalPage: first + offset / size, data: dump.subarray(offset, offset + size) });
  }
  return pages;
}
