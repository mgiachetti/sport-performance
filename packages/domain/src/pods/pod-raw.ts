import {
  countsOnlyWhenGranted,
  guardianConsentsLapseOn,
  majorityDate,
  type ConsentSigner,
  type ConsentType,
} from '../consent.js';
import { memberGuard, memberParser } from '../enum.js';
import { dayBoundsInTimeZone, type LocalDate, type TimeZone } from '../time.js';

/**
 * Ingestion of the pod's NAND log (B-916, ADR 0106, ADR 0108).
 *
 * The dock uploads one `pod_raw` file per recording segment that overlaps a
 * session. The server keeps it **pending** (encrypted, as the pages were on
 * the NAND) until every session it overlaps has ended and the pod's
 * assignments are closed, or for at most the club's N days; then it trims it
 * **once and for good**: only what falls inside a session **and** a valid
 * assignment of the pod to a player **and** that player's `data` and
 * `location` consents in force at that very instant becomes data. The rest is
 * deleted. This module holds the vocabulary and the pure rules; the decoding
 * lives in `@sport-performance/pod-protocol` and the job in the worker.
 */

// ─── Uploads ─────────────────────────────────────────────────────────────────────────

/**
 * Life of a `pod_raw` upload:
 * - `uploading`: the row and the upload URL exist; the bytes are not confirmed.
 * - `pending`: the bucket holds the declared file; the worker has not
 *   verified it with the keys yet.
 * - `verified`: it decoded with the pod's storage keys and holds exactly the
 *   manifest's closed segment: the signed erase command is available. Still
 *   pending trim (and reprocessable if an assignment is corrected).
 * - `trimmed`: cut down once to the valid windows; the original is deleted.
 * - `rejected`: it did not verify (`rejection_reason`); the pod keeps the
 *   segment and the dock may upload it again.
 */
export const POD_RAW_UPLOAD_STATES = [
  'uploading',
  'pending',
  'verified',
  'trimmed',
  'rejected',
] as const;
export type PodRawUploadState = (typeof POD_RAW_UPLOAD_STATES)[number];
export const isPodRawUploadState = memberGuard(POD_RAW_UPLOAD_STATES);
export const parsePodRawUploadState = memberParser(
  POD_RAW_UPLOAD_STATES,
  'invalid_argument',
  'pod_raw upload state',
);

/**
 * Why the worker rejected an upload: the object is missing or is not a
 * `pod_raw` container matching its manifest, or `verifyUploadForErase` of the
 * protocol said no (`segment_missing` … `segment_not_closed`), or it could not be
 * verified within its pending days (`expired`: no master key, for example),
 * the decoder failed on it (`decode_failed`), or a verified one reached the
 * end of its pending days while the club had no master key to trim it
 * (`master_key_missing_expired`: nothing of it becomes data).
 */
export const POD_RAW_REJECTION_REASONS = [
  'file_missing',
  'invalid_container',
  'manifest_mismatch',
  'segment_missing',
  'more_than_one_segment',
  'page_range_mismatch',
  'blocks_mismatch',
  'pages_not_authentic',
  'segment_not_closed',
  'expired',
  'decode_failed',
  'master_key_missing_expired',
] as const;
export type PodRawRejectionReason = (typeof POD_RAW_REJECTION_REASONS)[number];
export const isPodRawRejectionReason = memberGuard(POD_RAW_REJECTION_REASONS);

/**
 * What the worker reports about an upload without rejecting it (codes only,
 * never a position):
 * - `master_key_missing`: the club has no master key configured; it stays
 *   `pending` until there is one.
 * - `time_base_none`: no absolute time for the boot (no PPS, beacon or dock
 *   anchor): nothing of it can be placed in a session, so nothing becomes data.
 * - `time_base_few_anchors`: fewer than {@link POD_TIME_BASE_MIN_ANCHORS}
 *   anchors kept: the time of the markers and the IMU is of low confidence.
 * - `time_base_steps`: the time base has a step (a GNSS time jump); never
 *   interpolated across.
 * - `time_issues`: the decoder could not build part of the timing.
 * - `page_issues`, `stream_gaps`, `record_issues`: pages or stream bytes lost.
 * - `untimed_pages`: pages with no record time could not be placed and are
 *   left out of the trim.
 * - `shared_pages`: pages whose records overlap the windows of two players
 *   (a vest handed over): they go to neither trimmed file.
 * - `storage_unavailable`: the bucket failed while reading the file; it is
 *   tried again on the next run, without blocking the others.
 * - `assignment_corrected_after_trim`: an assignment of the pod was corrected
 *   after the one-time trim: what fell outside the corrected range was
 *   deleted (`count`: samples deleted); the data never moves to another
 *   player.
 */
export const POD_RAW_ISSUE_CODES = [
  'master_key_missing',
  'time_base_none',
  'time_base_few_anchors',
  'time_base_steps',
  'time_issues',
  'page_issues',
  'stream_gaps',
  'record_issues',
  'untimed_pages',
  'shared_pages',
  'storage_unavailable',
  'assignment_corrected_after_trim',
] as const;
export type PodRawIssueCode = (typeof POD_RAW_ISSUE_CODES)[number];
export const isPodRawIssueCode = memberGuard(POD_RAW_ISSUE_CODES);

export interface PodRawIssue {
  readonly code: PodRawIssueCode;
  /** How many (pages, gaps, anchors kept…), when it applies. */
  readonly count?: number;
}

/** Fewer anchors than this in a boot's time base is a low-confidence time base. */
export const POD_TIME_BASE_MIN_ANCHORS = 3;

/** Days a verified upload may stay pending at most, by default and its bounds (club setting). */
export const POD_RAW_PENDING_DAYS_DEFAULT = 7;
export const POD_RAW_PENDING_DAYS_MIN = 1;
export const POD_RAW_PENDING_DAYS_MAX = 30;

export function isPodRawPendingDays(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= POD_RAW_PENDING_DAYS_MIN &&
    value <= POD_RAW_PENDING_DAYS_MAX
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The latest moment a file confirmed at `confirmedAt` stays pending before it is trimmed anyway. */
export function podRawPendingUntil(confirmedAt: Date, pendingDays: number): Date {
  return new Date(confirmedAt.getTime() + pendingDays * DAY_MS);
}

/**
 * Margin of a pending file over its pending time: the worker trims it by
 * `pendingUntil`; if it never could (no key, a failing job), the retention
 * job removes the object a day later anyway.
 */
export const POD_RAW_PENDING_FILE_GRACE_DAYS = 1;

/** `expires_at` of a confirmed pending `pod_raw` file. */
export function podRawPendingFileExpiresAt(pendingUntil: Date): Date {
  return new Date(pendingUntil.getTime() + POD_RAW_PENDING_FILE_GRACE_DAYS * DAY_MS);
}

// ─── Method variants ─────────────────────────────────────────────────────────────────

/**
 * The method of every pod value is `pod` (principle 4), with its variant
 * (ADR 0106): `pod_live` (the live summaries), `pod_log` (the full NAND log
 * reprocessed, no PPK), `pod_ppk`, `pod_rtk` and `pod_uwb`. Each value also
 * keeps the version of the algorithm and of the pod and GNSS firmware; a
 * series that mixes variants or versions is flagged, never compared silently.
 */
export const POD_METHOD_VARIANTS = [
  'pod_live',
  'pod_log',
  'pod_ppk',
  'pod_rtk',
  'pod_uwb',
] as const;
export type PodMethodVariant = (typeof POD_METHOD_VARIANTS)[number];
export const isPodMethodVariant = memberGuard(POD_METHOD_VARIANTS);

/** Version of the server's trace extraction from the log (`pod_log`): bump on any change. */
export const POD_LOG_TRACE_ALGORITHM_VERSION = 'pod-log-trace/1';

/**
 * Position traces are kept at 1 Hz (one PVT epoch per second): enough for
 * heat maps and distances between players, a tenth of the 10 Hz of the log.
 * The metrics (speed bands, HSR, accelerations, `accel_load_au`) come from
 * the trimmed `pod_raw`, which keeps every epoch and the IMU (ADR 0005).
 */
export const POD_TRACE_SAMPLE_INTERVAL_MS = 1000;
/** Samples per trace row at most (an hour at 1 Hz). */
export const POD_TRACE_CHUNK_MAX_SAMPLES = 3600;

// ─── Time windows ────────────────────────────────────────────────────────────────────

/** A half-open interval of instants `[startMs, endMs)` (Unix ms). */
export interface TimeInterval {
  readonly startMs: number;
  readonly endMs: number;
}

/** Sorted, merged (overlapping or touching) and without empty intervals. */
export function normalizeIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const sorted = intervals
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: { startMs: number; endMs: number }[] = [];
  for (const interval of sorted) {
    const last = out.at(-1);
    if (last !== undefined && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      out.push({ startMs: interval.startMs, endMs: interval.endMs });
    }
  }
  return out;
}

/** The instants in both sets. */
export function intersectIntervals(
  a: readonly TimeInterval[],
  b: readonly TimeInterval[],
): TimeInterval[] {
  const left = normalizeIntervals(a);
  const right = normalizeIntervals(b);
  const out: TimeInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i];
    const y = right[j];
    if (x === undefined || y === undefined) break;
    const startMs = Math.max(x.startMs, y.startMs);
    const endMs = Math.min(x.endMs, y.endMs);
    if (endMs > startMs) out.push({ startMs, endMs });
    if (x.endMs < y.endMs) i += 1;
    else j += 1;
  }
  return out;
}

/** Whether an instant is inside a normalized set (binary search). */
export function intervalsContain(intervals: readonly TimeInterval[], atMs: number): boolean {
  let lo = 0;
  let hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const interval = intervals[mid];
    if (interval === undefined) return false;
    if (atMs < interval.startMs) hi = mid - 1;
    else if (atMs >= interval.endMs) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Whether `[startMs, endMs]` (both ends included) touches a normalized set. */
export function intervalsOverlap(
  intervals: readonly TimeInterval[],
  startMs: number,
  endMs: number,
): boolean {
  return intervals.some((i) => i.startMs <= endMs && startMs < i.endMs);
}

/**
 * Length of a session without a planned duration, for its window. A session
 * owns the window (ADR 0106): `[starts_at, starts_at + planned duration)`.
 */
export const POD_SESSION_DEFAULT_DURATION_MIN = 120;

export function sessionWindow(session: {
  readonly startsAt: Date;
  readonly plannedDurationMin: number | null;
}): TimeInterval {
  const startMs = session.startsAt.getTime();
  const minutes = session.plannedDurationMin ?? POD_SESSION_DEFAULT_DURATION_MIN;
  return { startMs, endMs: startMs + minutes * 60_000 };
}

// ─── Consent per instant ─────────────────────────────────────────────────────────────

/** A consent row as the ingestion sees it (revoked ones included). */
export interface ConsentCoverageRecord {
  readonly type: ConsentType;
  readonly signerKind: ConsentSigner;
  readonly signedAt: Date;
  readonly revokedAt: Date | null;
  /**
   * When a newer text of the type was published after the one it signed
   * (the signature became `outdated`); `null` while its text is the current
   * one. Only `location` stops counting there.
   */
  readonly supersededAt: Date | null;
}

/**
 * The instants a consent type of a player was in force (#305: the ingestion
 * checks it per instant, never with today's state):
 * - from the signature until it was revoked. A revoked `location` never
 *   counts again, not even before the revocation: revoking it erases every
 *   position (ADR 0106), so a pending file cannot bring them back;
 * - a guardian's signature until the player is of age (`location`) or until
 *   the grace period after that ends (the other types, ADR 0048);
 * - `location` only while its text was the current one; for the other types
 *   an older text still counts.
 *
 * Days are the club's (`timeZone`), like `app.current_consent_types`.
 */
export function consentCoverage(input: {
  readonly type: ConsentType;
  readonly records: readonly ConsentCoverageRecord[];
  readonly birthDate: LocalDate;
  readonly timeZone: TimeZone;
}): TimeInterval[] {
  const grantedOnly = countsOnlyWhenGranted(input.type);
  const guardianUntil: LocalDate = grantedOnly
    ? majorityDate(input.birthDate)
    : guardianConsentsLapseOn(input.birthDate);
  const guardianEndMs = dayBoundsInTimeZone(guardianUntil, input.timeZone).start.getTime();
  const intervals: TimeInterval[] = [];
  for (const record of input.records) {
    if (record.type !== input.type) continue;
    if (grantedOnly && record.revokedAt !== null) continue;
    let endMs = Number.POSITIVE_INFINITY;
    if (record.revokedAt !== null) endMs = Math.min(endMs, record.revokedAt.getTime());
    if (record.signerKind === 'guardian') endMs = Math.min(endMs, guardianEndMs);
    if (grantedOnly && record.supersededAt !== null) {
      endMs = Math.min(endMs, record.supersededAt.getTime());
    }
    intervals.push({ startMs: record.signedAt.getTime(), endMs });
  }
  return normalizeIntervals(intervals);
}

/** The consents the pod's data needs at every instant (ADR 0106). */
export const POD_DATA_CONSENTS = ['data', 'location'] as const satisfies readonly ConsentType[];

/**
 * Where a player's pod data becomes data: inside one of their sessions
 * **and** one of their assignments of the pod **and** with every consent of
 * {@link POD_DATA_CONSENTS} in force. An assignment made for a session only
 * counts inside that session's window.
 */
export function podDataWindows(input: {
  readonly assignments: readonly {
    readonly range: TimeInterval;
    /** The window of the assignment's own session, when it names one. */
    readonly sessionWindow: TimeInterval | null;
  }[];
  /** The windows of every session the player takes part in. */
  readonly sessionWindows: readonly TimeInterval[];
  /** One coverage per consent type ({@link consentCoverage}). */
  readonly consentCoverages: readonly (readonly TimeInterval[])[];
}): TimeInterval[] {
  let windows = normalizeIntervals(
    input.assignments.flatMap((a) =>
      intersectIntervals(
        [a.range],
        a.sessionWindow === null ? input.sessionWindows : [a.sessionWindow],
      ),
    ),
  );
  for (const coverage of input.consentCoverages) windows = intersectIntervals(windows, coverage);
  return windows;
}

/**
 * Whether a verified upload is trimmed now: every session it overlaps has
 * ended and every assignment of the pod in its time is closed, with at least
 * one session (a session loaded late still counts); or its pending time is
 * over, whatever the rest. (A corrected assignment needs no wait: the trim
 * reads the corrected ranges.)
 */
export function podRawTrimDue(input: {
  readonly now: Date;
  readonly pendingUntil: Date;
  /** Ends of the windows of the sessions that overlap the recording. */
  readonly sessionEnds: readonly Date[];
  /** An assignment of the pod in the recording's time is still open. */
  readonly openAssignment: boolean;
}): boolean {
  const now = input.now.getTime();
  if (now >= input.pendingUntil.getTime()) return true;
  if (input.sessionEnds.length === 0 || input.openAssignment) {
    return false;
  }
  return input.sessionEnds.every((end) => end.getTime() <= now);
}

/**
 * Keeps the first sample of every `intervalMs` bucket (samples sorted by
 * time): the 1 Hz trace from the 10 Hz PVT.
 */
export function decimateByTime<T extends { readonly timeMs: number }>(
  samples: readonly T[],
  intervalMs: number = POD_TRACE_SAMPLE_INTERVAL_MS,
): T[] {
  const out: T[] = [];
  let bucket = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    const current = Math.floor(sample.timeMs / intervalMs);
    if (current > bucket) {
      out.push(sample);
      bucket = current;
    }
  }
  return out;
}

// ─── Club settings ───────────────────────────────────────────────────────────────────

/** The pod settings of a club (`club.settings.pods`). */
export interface PodSettings {
  /** N: days a verified `pod_raw` waits at most for its sessions and assignments. */
  readonly rawPendingDays: number;
}

export const DEFAULT_POD_SETTINGS: PodSettings = { rawPendingDays: POD_RAW_PENDING_DAYS_DEFAULT };

/** The club's stored JSON over the defaults; an invalid value takes the default. */
export function resolvePodSettings(stored: unknown): PodSettings {
  const days = (stored as { rawPendingDays?: unknown } | null | undefined)?.rawPendingDays;
  return {
    rawPendingDays:
      typeof days === 'number' && isPodRawPendingDays(days)
        ? days
        : DEFAULT_POD_SETTINGS.rawPendingDays,
  };
}
