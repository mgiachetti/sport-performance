import { randomUUID } from 'node:crypto';
import {
  POD_DATA_CONSENTS,
  POD_LOG_TRACE_ALGORITHM_VERSION,
  POD_SESSION_DEFAULT_DURATION_MIN,
  POD_TIME_BASE_MIN_ANCHORS,
  consentCoverage,
  fileExpiresAt,
  fileObjectKey,
  intersectIntervals,
  intervalsContain,
  intervalsOverlap,
  normalizeIntervals,
  podDataWindows,
  podRawTrimDue,
  sessionWindow,
  type ClubId,
  type ConsentCoverageRecord,
  type LocalDate,
  type PlayerId,
  type PodRawIssue,
  type PodRawIssueCode,
  type PodRawRejectionReason,
  type TimeInterval,
  type TimeZone,
} from '@sport-performance/domain';
import {
  PodProtocolError,
  decodeLog,
  deriveStorageKey,
  encodeEraseCommand,
  fromHex,
  gnssMsToUnixMs,
  podRawIngestKey,
  readPodRawFile,
  slicePodRawFile,
  toHex,
  verifyUploadForErase,
  type DecodedLog,
  type DecodedSegment,
  type NandPageRead,
  type PodRawManifest,
  type TimeBase,
} from '@sport-performance/pod-protocol';
import { ObjectTooLargeError, type ObjectStorage } from '@sport-performance/storage';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction, type ClubTransaction } from '../database.js';
import type { PodKeyProvider } from './keys.js';
import {
  assignPages,
  pagesStillOwned,
  timedPages,
  traceChunks,
  traceSamples,
  type TimedPage,
  type TraceSample,
} from './trim.js';

export { pagesOverlapping, traceChunks, traceSamples } from './trim.js';
import { lockPlayersLocation, playersStillKeepingLocation } from './locks.js';

/** The raw assignment ranges of each player of the pod (whatever their consent). */
function rangesByPlayer(assignments: readonly AssignmentRow[]): Map<string, TimeInterval[]> {
  const out = new Map<string, TimeInterval[]>();
  for (const a of assignments) {
    const list = out.get(a.player_id) ?? [];
    list.push({
      startMs: a.starts_at.getTime(),
      endMs: a.ends_at?.getTime() ?? Number.POSITIVE_INFINITY,
    });
    out.set(a.player_id, list);
  }
  for (const [player, list] of out) out.set(player, normalizeIntervals(list));
  return out;
}

/** The ranges of every player but `playerId`. */
function otherRanges(ranges: ReadonlyMap<string, readonly TimeInterval[]>, playerId: string) {
  return normalizeIntervals(
    [...ranges.entries()].filter(([p]) => p !== playerId).flatMap(([, r]) => r),
  );
}

/**
 * Ingestion of the pod's NAND log (B-916, ADR 0106, ADR 0108), the
 * `pod-raw-ingest-club` job. Per club, in this order:
 *
 * 1. An upload whose window closed without bytes is rejected (`file_missing`),
 *    and a pending one that could not be verified in its days (`expired`).
 *    Traces past their retention are deleted.
 * 2. Assignments of a pod with uploads that were corrected or voided
 *    (`reprocess_requested_at`): while the raw is pending nothing was kept, so
 *    the trim reads the corrected ranges. After the trim, whatever falls
 *    outside the corrected ranges is deleted (trace samples and pages of the
 *    player's trimmed file), never moved to another player: the original is
 *    gone. Reported as `assignment_corrected_after_trim` with the samples
 *    deleted. The flag is cleared.
 * 3. Every confirmed upload is decoded with the pod's storage keys (from the
 *    club's master key and the manifest's `DEVICEID`) and checked with
 *    `verifyUploadForErase`: `verified` with the canonical erase command the
 *    API signs, or `rejected`. The time base is reported when it is weak.
 * 4. A verified upload whose sessions ended and whose assignments closed (or
 *    whose pending days are over) is trimmed once: per player, only what is
 *    inside a session **and** a valid assignment **and** the `data` and
 *    `location` consents in force at that instant becomes data: a 1 Hz trace
 *    (`pod_trace_segment`, method `pod_log`), a trimmed `pod_raw` of that
 *    player with only the pages that are theirs alone (byte for byte: nothing
 *    is re-sealed), and its windows and page times (`pod_raw_trim`). The
 *    original file is deleted and its object removed right after the commit.
 *
 * One upload never blocks the rest: a bucket failure is reported and tried
 * again next run; a file that does not open is rejected; an unexpected error
 * is logged, the upload skipped, and the job fails at the end so it retries.
 * Idempotent: each step moves rows forward under `FOR UPDATE SKIP LOCKED`
 * and a re-run finds nothing to do. No metric is computed here (speed bands,
 * HSR, accelerations and `accel_load_au` come with B-919 and B-906, from the
 * trimmed raw). Files are read whole into memory (a 3 h session is about
 * 30 MiB). Logs carry ids and counts, never a position.
 */

export interface PodRawIngestDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly storage: ObjectStorage;
  readonly keys: PodKeyProvider;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface PodRawIngestReport {
  readonly expired: number;
  /** Corrected assignments processed (flags cleared). */
  readonly reprocessed: number;
  readonly verified: number;
  readonly rejected: number;
  readonly trimmed: number;
  readonly tracesDeleted: number;
  /** Uploads or corrections skipped by an unexpected error (the job then fails to retry). */
  readonly failed: number;
  /** More work than one run does: the caller enqueues the job again. */
  readonly more: boolean;
}

/** Uploads decoded per run (each one reads a file of up to hundreds of MiB). */
export const POD_RAW_BATCH = 4;
/** Traces deleted per run by the retention. */
export const POD_TRACE_RETENTION_BATCH = 1000;
/** Corrected assignments processed per run. */
export const POD_CORRECTIONS_BATCH = 20;

interface UploadRow {
  id: string;
  pod_id: string;
  ingest_key: string;
  chip_id: string;
  pod_serial: string;
  boot_counter: string;
  segment_id: string;
  first_page_seq: string;
  last_page_seq: string;
  pages_n: number;
  valid_pages_n: number;
  blocks: number[];
  key_epochs: number[];
  segment_closed: boolean;
  declared_start_at: Date | null;
  declared_end_at: Date | null;
  size_bytes: string;
  sha256_hex: string;
  file_id: string;
  state: string;
  pending_until: Date | null;
  recorded_from: Date | null;
  recorded_to: Date | null;
  firmware_version: string | null;
  gnss_firmware_version: string | null;
  issues: PodRawIssue[];
}

const UPLOAD_COLUMNS = `id, pod_id, ingest_key, chip_id, pod_serial, boot_counter, segment_id, first_page_seq,
  last_page_seq, pages_n, valid_pages_n, blocks, key_epochs, segment_closed, declared_start_at,
  declared_end_at, size_bytes, sha256_hex, file_id, state, pending_until, recorded_from, recorded_to,
  firmware_version, gnss_firmware_version, issues`;

/** The manifest the dock declared, as the protocol reads it. */
export function manifestOf(row: UploadRow): PodRawManifest {
  return {
    kind: 'pod_raw',
    containerVersion: 1,
    logFormatVersion: 1,
    deviceIdHex: row.chip_id,
    podSerial: row.pod_serial,
    bootCounter: Number(row.boot_counter),
    segmentId: Number(row.segment_id),
    firstPageSeq: Number(row.first_page_seq),
    lastPageSeq: Number(row.last_page_seq),
    pagesN: row.pages_n,
    validPagesN: row.valid_pages_n,
    blocks: row.blocks,
    keyEpochs: row.key_epochs,
    closed: row.segment_closed,
    startUnixMs: row.declared_start_at?.getTime() ?? null,
    endUnixMs: row.declared_end_at?.getTime() ?? null,
    sizeB: Number(row.size_bytes),
    sha256Hex: row.sha256_hex,
  };
}

function objectKey(clubId: ClubId, fileId: string): string {
  return fileObjectKey({ clubId, kind: 'pod_raw', id: fileId });
}

function mergeIssues(
  existing: readonly PodRawIssue[],
  added: readonly PodRawIssue[],
): PodRawIssue[] {
  const byCode = new Map<PodRawIssueCode, PodRawIssue>();
  for (const issue of [...existing, ...added]) byCode.set(issue.code, issue);
  return [...byCode.values()];
}

async function setIssues(
  tx: ClubTransaction,
  clubId: ClubId,
  row: Pick<UploadRow, 'id' | 'issues'>,
  issues: readonly PodRawIssue[],
): Promise<void> {
  if (JSON.stringify(issues) === JSON.stringify(row.issues)) return;
  await tx.client.query(
    `update pod_raw_upload set issues = $3::jsonb where club_id = $1 and id = $2`,
    [clubId, row.id, JSON.stringify(issues)],
  );
}

/** Removes objects whose rows were committed as deleted; the daily purge is the backstop. */
async function removeObjects(deps: PodRawIngestDependencies, keys: readonly string[]) {
  for (const key of keys) {
    try {
      await deps.storage.remove(key);
    } catch (error) {
      deps.logger.warn({ err: error }, 'pod_raw object not removed: the retention job will');
    }
  }
}

// ─── Decoding ────────────────────────────────────────────────────────────────────────

type Opened =
  | {
      ok: true;
      bytes: Uint8Array;
      pages: NandPageRead[];
      decoded: DecodedLog;
      manifest: PodRawManifest;
    }
  /** The bucket failed: not a rejection, the file is tried again next run. */
  | { ok: false; transient: true }
  | { ok: false; transient: false; reason: PodRawRejectionReason };

/** Reads the object and decodes it with the pod's storage keys of the manifest's epochs. */
async function openUpload(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  row: UploadRow,
  masterKey: Uint8Array,
): Promise<Opened> {
  const manifest = manifestOf(row);
  // The row was created for this segment: the same idempotency key as the protocol's.
  if (podRawIngestKey(manifest) !== row.ingest_key) {
    return { ok: false, transient: false, reason: 'manifest_mismatch' };
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await deps.storage.get(objectKey(clubId, row.file_id), manifest.sizeB);
  } catch (error) {
    // Bigger than the manifest says: not the declared file.
    if (error instanceof ObjectTooLargeError)
      return { ok: false, transient: false, reason: 'manifest_mismatch' };
    deps.logger.warn({ err: error, clubId, podRawUploadId: row.id }, 'pod_raw not read');
    return { ok: false, transient: true };
  }
  if (bytes === null) return { ok: false, transient: false, reason: 'file_missing' };
  let pages: NandPageRead[];
  try {
    pages = readPodRawFile(bytes, manifest).pages;
  } catch (error) {
    if (error instanceof PodProtocolError) {
      return {
        ok: false,
        transient: false,
        reason: error.code === 'manifest_mismatch' ? 'manifest_mismatch' : 'invalid_container',
      };
    }
    return { ok: false, transient: false, reason: 'decode_failed' };
  }
  // Always with the manifest's DEVICEID (checked against the pod's device on insert).
  const deviceId = fromHex(manifest.deviceIdHex);
  const epochs = new Set(manifest.keyEpochs);
  const keys = new Map<number, Uint8Array>();
  let decoded: DecodedLog;
  try {
    decoded = decodeLog({
      pages,
      deviceId,
      keyForEpoch: (epoch) => {
        if (!epochs.has(epoch)) return undefined;
        let key = keys.get(epoch);
        if (key === undefined) {
          key = deriveStorageKey({ masterKey, deviceId, epoch });
          keys.set(epoch, key);
        }
        return key;
      },
    });
  } catch (error) {
    // The decoder reports bad data instead of throwing; this is a bug, never retried forever.
    deps.logger.error({ err: error, clubId, podRawUploadId: row.id }, 'pod_raw did not decode');
    return { ok: false, transient: false, reason: 'decode_failed' };
  }
  return { ok: true, bytes, pages, decoded, manifest };
}

function timeBaseOf(decoded: DecodedLog, segment: DecodedSegment): TimeBase | undefined {
  return decoded.timeBases.find((b) => b.bootCounter === segment.bootCounter);
}

/** What the worker reports about a decoded segment (codes and counts only). */
export function decodeIssues(decoded: DecodedLog, segment: DecodedSegment): PodRawIssue[] {
  const issues: PodRawIssue[] = [];
  const base = timeBaseOf(decoded, segment);
  if (base === undefined || base.source === 'none' || base.points.length === 0) {
    issues.push({ code: 'time_base_none' });
  } else if (base.points.length < POD_TIME_BASE_MIN_ANCHORS) {
    issues.push({ code: 'time_base_few_anchors', count: base.points.length });
  }
  if (base !== undefined && base.steps.length > 0) {
    issues.push({ code: 'time_base_steps', count: base.steps.length });
  }
  if (decoded.timeIssues.length > 0)
    issues.push({ code: 'time_issues', count: decoded.timeIssues.length });
  if (decoded.pageIssues.length > 0)
    issues.push({ code: 'page_issues', count: decoded.pageIssues.length });
  const streamGaps = segment.gaps.filter((g) => g.kind === 'stream' || g.kind === 'stream_end');
  if (streamGaps.length > 0) issues.push({ code: 'stream_gaps', count: streamGaps.length });
  if (segment.recordIssues.length > 0) {
    issues.push({ code: 'record_issues', count: segment.recordIssues.length });
  }
  return issues;
}

const LOW_CONFIDENCE: readonly PodRawIssueCode[] = ['time_base_few_anchors', 'time_base_steps'];

function versionsOf(segment: DecodedSegment): { firmware: string | null; gnss: string | null } {
  const info = segment.streams.firmware.at(-1);
  if (info === undefined) return { firmware: null, gnss: null };
  const { major, minor, patch } = info.firmwareVersion;
  return {
    firmware: `${String(major)}.${String(minor)}.${String(patch)}`,
    gnss: info.gnssFirmware === '' ? null : info.gnssFirmware.slice(0, 64),
  };
}

/** The recording's time in UTC from the decoded log, or `null` without absolute time. */
function recordedRange(segment: DecodedSegment, base: TimeBase | undefined): TimeInterval | null {
  const offset = base?.gpsUtcOffsetS;
  const pvt = segment.streams.pvt;
  const first = pvt[0];
  const last = pvt.at(-1);
  const fromPvt =
    first !== undefined && last !== undefined
      ? { startMs: first.gnssTimeMs, endMs: last.gnssTimeMs }
      : null;
  const gnss = segment.gnssTimeRange
    ? {
        startMs: Math.min(segment.gnssTimeRange.startMs, fromPvt?.startMs ?? Infinity),
        endMs: Math.max(segment.gnssTimeRange.endMs, fromPvt?.endMs ?? -Infinity),
      }
    : fromPvt;
  if (gnss === null) return null;
  return {
    startMs: Math.floor(gnssMsToUnixMs(gnss.startMs, offset)),
    endMs: Math.ceil(gnssMsToUnixMs(gnss.endMs, offset)),
  };
}

// ─── 1. Expired upload windows, retention ────────────────────────────────────────────

async function rejectExpiredUploads(
  tx: ClubTransaction,
  clubId: ClubId,
  now: Date,
): Promise<number> {
  // An upload window that closed without the bytes, and a confirmed upload past its pending
  // days that the worker could not decode (no master key): rejected, their files deleted.
  const { rows } = await tx.client.query<{ n: number }>(
    `with rejected as (
       update pod_raw_upload u
          set state = 'rejected', rejected_at = $2,
              rejection_reason = (case when u.state = 'uploading' then 'file_missing'
                                       else 'expired' end)::pod_raw_rejection_reason
        where u.club_id = $1
          and ((u.state = 'uploading' and exists (
                 select 1 from file f where f.club_id = u.club_id and f.id = u.file_id
                    and f.expires_at <= $2))
               or (u.state = 'pending' and u.pending_until <= $2))
        returning u.file_id),
     deleted as (
       update file set status = 'deleted', deleted_at = coalesce(deleted_at, $2),
                       expires_at = least(expires_at, $2)
        where club_id = $1 and id in (select file_id from rejected) and status <> 'deleted'
        returning id)
     select count(*)::int as n from rejected`,
    [clubId, now],
  );
  return rows[0]?.n ?? 0;
}

async function deleteExpiredTraces(tx: ClubTransaction, clubId: ClubId, now: Date) {
  const { rowCount } = await tx.client.query(
    `delete from pod_trace_segment
      where club_id = $1 and id in (
        select id from pod_trace_segment where club_id = $1 and expires_at <= $2
         order by expires_at limit $3)`,
    [clubId, now, POD_TRACE_RETENTION_BATCH],
  );
  return rowCount ?? 0;
}

// ─── Locking and rejecting ───────────────────────────────────────────────────────────

/** The next upload in `state`, not among `skip`, locked; its id goes into `skip` at once. */
async function lockNext(
  tx: ClubTransaction,
  clubId: ClubId,
  state: 'pending' | 'verified',
  skip: string[],
): Promise<UploadRow | undefined> {
  const { rows } = await tx.client.query<UploadRow>(
    `select ${UPLOAD_COLUMNS} from pod_raw_upload
      where club_id = $1 and state = $2 and not (id = any ($3::uuid[]))
      order by confirmed_at, id
      limit 1
      for update skip locked`,
    [clubId, state, skip],
  );
  const row = rows[0];
  // Before anything can fail: an error with this upload never makes the run take it again.
  if (row !== undefined) skip.push(row.id);
  return row;
}

async function reject(
  tx: ClubTransaction,
  clubId: ClubId,
  row: UploadRow,
  reason: PodRawRejectionReason,
  now: Date,
): Promise<string> {
  await tx.client.query(
    `update pod_raw_upload set state = 'rejected', rejection_reason = $3, rejected_at = $4
      where club_id = $1 and id = $2`,
    [clubId, row.id, reason, now],
  );
  await deleteFile(tx, clubId, row.file_id, now);
  return objectKey(clubId, row.file_id);
}

/** Marks a file deleted now; the caller removes the object after the commit. */
async function deleteFile(tx: ClubTransaction, clubId: ClubId, fileId: string, now: Date) {
  await tx.client.query(
    `update file set status = 'deleted', deleted_at = coalesce(deleted_at, $3), expires_at = $3
      where club_id = $1 and id = $2 and status <> 'deleted'`,
    [clubId, fileId, now],
  );
}

// ─── 3. Verification ─────────────────────────────────────────────────────────────────

type Outcome = 'verified' | 'rejected' | 'trimmed' | 'skipped' | 'waiting' | 'none';

interface StepResult {
  readonly outcome: Outcome;
  /** Objects to remove once the transaction committed. */
  readonly remove?: readonly string[];
}

async function verifyNext(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  masterKey: Uint8Array | null,
  skip: string[],
  now: Date,
): Promise<StepResult> {
  return inClubTransaction(deps.pool, clubId, async (tx) => {
    const row = await lockNext(tx, clubId, 'pending', skip);
    if (row === undefined) return { outcome: 'none' };
    if (masterKey === null) {
      // Kept pending until the club has a key (or its pending days are over).
      await setIssues(tx, clubId, row, mergeIssues(row.issues, [{ code: 'master_key_missing' }]));
      return { outcome: 'skipped' };
    }
    const opened = await openUpload(deps, clubId, row, masterKey);
    if (!opened.ok && opened.transient) {
      await setIssues(tx, clubId, row, mergeIssues(row.issues, [{ code: 'storage_unavailable' }]));
      return { outcome: 'skipped' };
    }
    if (!opened.ok) {
      const removed = await reject(tx, clubId, row, opened.reason, now);
      deps.logger.warn(
        { clubId, podRawUploadId: row.id, reason: opened.reason },
        'pod_raw rejected',
      );
      return { outcome: 'rejected', remove: [removed] };
    }
    const verification = verifyUploadForErase({
      manifest: opened.manifest,
      pages: opened.pages,
      decoded: opened.decoded,
    });
    if (!verification.ok) {
      const removed = await reject(tx, clubId, row, verification.reason, now);
      deps.logger.warn(
        { clubId, podRawUploadId: row.id, reason: verification.reason },
        'pod_raw rejected',
      );
      return { outcome: 'rejected', remove: [removed] };
    }
    const segment = opened.decoded.segments[0];
    if (segment === undefined) {
      const removed = await reject(tx, clubId, row, 'segment_missing', now);
      return { outcome: 'rejected', remove: [removed] };
    }
    const base = timeBaseOf(opened.decoded, segment);
    const range = recordedRange(segment, base);
    const versions = versionsOf(segment);
    const issues = mergeIssues(
      row.issues.filter((i) => i.code !== 'master_key_missing' && i.code !== 'storage_unavailable'),
      decodeIssues(opened.decoded, segment),
    );
    await tx.client.query(
      `update pod_raw_upload
          set state = 'verified', verified_at = $3, erase_command = $4, recorded_from = $5,
              recorded_to = $6, firmware_version = $7, gnss_firmware_version = $8, issues = $9::jsonb
        where club_id = $1 and id = $2`,
      [
        clubId,
        row.id,
        now,
        toHex(encodeEraseCommand(verification.command)),
        range === null ? null : new Date(range.startMs),
        range === null ? null : new Date(range.endMs),
        versions.firmware,
        versions.gnss,
        JSON.stringify(issues),
      ],
    );
    deps.logger.info(
      { clubId, podRawUploadId: row.id, issues: issues.map((i) => i.code) },
      'pod_raw verified',
    );
    return { outcome: 'verified' };
  });
}

// ─── Windows: sessions × assignments × consent per instant ───────────────────────────

interface SessionRow {
  id: string;
  starts_at: Date;
  planned_duration_min: number | null;
  category_id: string | null;
  local_date: string;
}

interface AssignmentRow {
  id: string;
  player_id: PlayerId;
  training_session_id: string | null;
  starts_at: Date;
  ends_at: Date | null;
}

/** Sessions of the club whose window overlaps `[from, to]`, not archived. */
async function sessionsOverlapping(
  tx: ClubTransaction,
  clubId: ClubId,
  from: Date,
  to: Date,
): Promise<SessionRow[]> {
  const { rows } = await tx.client.query<SessionRow>(
    `select id, starts_at, planned_duration_min, category_id, local_date::text
       from training_session
      where club_id = $1 and archived_at is null and starts_at <= $3
        and starts_at + make_interval(mins => coalesce(planned_duration_min, $4)) > $2`,
    [clubId, from, to, POD_SESSION_DEFAULT_DURATION_MIN],
  );
  return rows;
}

/** Live (not voided) assignments of the pod overlapping `[from, to]`. */
async function assignmentsOverlapping(
  tx: ClubTransaction,
  clubId: ClubId,
  podId: string,
  from: Date,
  to: Date,
): Promise<AssignmentRow[]> {
  const { rows } = await tx.client.query<AssignmentRow>(
    `select id, player_id, training_session_id, starts_at, ends_at
       from pod_assignment
      where club_id = $1 and pod_id = $2 and archived_at is null
        and starts_at <= $4 and (ends_at is null or ends_at > $3)
      order by starts_at, id`,
    [clubId, podId, from, to],
  );
  return rows;
}

/** Players of each session: a participation that is not an absence, or its category that day. */
async function sessionPlayers(
  tx: ClubTransaction,
  clubId: ClubId,
  sessionIds: readonly string[],
  playerIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (sessionIds.length === 0 || playerIds.length === 0) return out;
  const { rows } = await tx.client.query<{ session_id: string; player_id: string }>(
    `select s.id as session_id, p.id as player_id
       from training_session s
       join player p on p.club_id = s.club_id and p.id = any ($3::uuid[])
       left join participation pa
         on pa.club_id = s.club_id and pa.training_session_id = s.id and pa.player_id = p.id
      where s.club_id = $1 and s.id = any ($2::uuid[])
        and (pa.status in ('full', 'partial')
             or (pa.id is null and exists (
                   select 1 from player_category pc
                    where pc.club_id = s.club_id and pc.player_id = p.id
                      and pc.category_id = s.category_id
                      and pc.valid_from <= s.local_date
                      and (pc.valid_to is null or pc.valid_to > s.local_date))))`,
    [clubId, [...sessionIds], [...playerIds]],
  );
  for (const row of rows) {
    const set = out.get(row.session_id) ?? new Set<string>();
    set.add(row.player_id);
    out.set(row.session_id, set);
  }
  return out;
}

/** The `data` and `location` consent rows of a player, with when each text was superseded. */
async function consentRecords(
  tx: ClubTransaction,
  clubId: ClubId,
  playerId: string,
): Promise<ConsentCoverageRecord[]> {
  const { rows } = await tx.client.query<{
    type: 'data' | 'location';
    signer_kind: 'guardian' | 'player';
    signed_at: Date;
    revoked_at: Date | null;
    superseded_at: Date | null;
    has_document: boolean;
  }>(
    `select c.type::text as type, c.signer_kind::text as signer_kind, c.signed_at, c.revoked_at,
            (select min(newer.published_at) from consent_document d
               join consent_document newer
                 on newer.club_id = d.club_id and newer.type = d.type
                and (newer.published_at, newer.id) > (d.published_at, d.id)
              where d.club_id = c.club_id and d.type = c.type
                and (d.id = c.document_id or (c.document_id is null and d.version = c.document_version))
           ) as superseded_at,
            exists (select 1 from consent_document d
                     where d.club_id = c.club_id and d.type = c.type
                       and (d.id = c.document_id or (c.document_id is null and d.version = c.document_version))
                   ) as has_document
       from consent c
      where c.club_id = $1 and c.player_id = $2 and c.type::text = any ($3::text[])`,
    [clubId, playerId, [...POD_DATA_CONSENTS]],
  );
  return rows.map((r) => ({
    type: r.type,
    signerKind: r.signer_kind,
    signedAt: r.signed_at,
    revokedAt: r.revoked_at,
    // A location signature without its text never counts (as app.current_consent_types).
    supersededAt: r.type === 'location' && !r.has_document ? r.signed_at : r.superseded_at,
  }));
}

interface PlayerTrim {
  playerId: string;
  windows: TimeInterval[];
  /** Session id → the windows inside it. */
  sessions: { id: string; windows: TimeInterval[] }[];
}

/** `a` minus `b` (both normalized). */
function subtract(a: readonly TimeInterval[], b: readonly TimeInterval[]): TimeInterval[] {
  const out: TimeInterval[] = [];
  for (const interval of a) {
    let pieces: TimeInterval[] = [interval];
    for (const cut of b) {
      pieces = pieces.flatMap((p) => {
        if (cut.endMs <= p.startMs || cut.startMs >= p.endMs) return [p];
        const parts: TimeInterval[] = [];
        if (cut.startMs > p.startMs) parts.push({ startMs: p.startMs, endMs: cut.startMs });
        if (cut.endMs < p.endMs) parts.push({ startMs: cut.endMs, endMs: p.endMs });
        return parts;
      });
    }
    out.push(...pieces);
  }
  return normalizeIntervals(out);
}

async function clubTimeZone(tx: ClubTransaction, clubId: ClubId): Promise<TimeZone> {
  const { rows } = await tx.client.query<{ time_zone: TimeZone }>(
    'select time_zone from club where id = $1',
    [clubId],
  );
  const zone = rows[0]?.time_zone;
  if (zone === undefined) throw new Error('club not found');
  return zone;
}

/** Per player, where their data is in `[from, to]` (sessions × assignments × consents). */
async function playerTrims(
  tx: ClubTransaction,
  clubId: ClubId,
  podId: string,
  from: Date,
  to: Date,
): Promise<{ trims: PlayerTrim[]; sessions: SessionRow[]; assignments: AssignmentRow[] }> {
  const sessions = await sessionsOverlapping(tx, clubId, from, to);
  const assignments = await assignmentsOverlapping(tx, clubId, podId, from, to);
  if (sessions.length === 0 || assignments.length === 0) {
    return { trims: [], sessions, assignments };
  }
  const timeZone = await clubTimeZone(tx, clubId);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  // A session named by an assignment counts even if loaded with another window.
  const named = [
    ...new Set(
      assignments.flatMap((a) =>
        a.training_session_id !== null && !sessionById.has(a.training_session_id)
          ? [a.training_session_id]
          : [],
      ),
    ),
  ];
  if (named.length > 0) {
    const { rows } = await tx.client.query<SessionRow>(
      `select id, starts_at, planned_duration_min, category_id, local_date::text
         from training_session where club_id = $1 and id = any ($2::uuid[]) and archived_at is null`,
      [clubId, named],
    );
    for (const row of rows) sessionById.set(row.id, row);
  }
  const playerIds = [...new Set(assignments.map((a) => a.player_id))];
  const membership = await sessionPlayers(tx, clubId, [...sessionById.keys()], playerIds);
  const { rows: players } = await tx.client.query<{ id: string; birth_date: string }>(
    `select id, birth_date::text from player where club_id = $1 and id = any ($2::uuid[])`,
    [clubId, playerIds],
  );
  const birthOf = new Map(players.map((p) => [p.id, p.birth_date as LocalDate]));
  const trims: PlayerTrim[] = [];
  for (const playerId of playerIds) {
    const birthDate = birthOf.get(playerId);
    if (birthDate === undefined) continue;
    const own = [...sessionById.values()].filter((s) => membership.get(s.id)?.has(playerId));
    const records = await consentRecords(tx, clubId, playerId);
    const windows = podDataWindows({
      assignments: assignments
        .filter((a) => a.player_id === playerId)
        .map((a) => {
          const session =
            a.training_session_id === null ? undefined : sessionById.get(a.training_session_id);
          return {
            range: {
              startMs: a.starts_at.getTime(),
              endMs: a.ends_at?.getTime() ?? Number.POSITIVE_INFINITY,
            },
            // A named session the player does not take part in gives nothing.
            sessionWindow:
              a.training_session_id === null
                ? null
                : session !== undefined && membership.get(session.id)?.has(playerId)
                  ? sessionWindow({
                      startsAt: session.starts_at,
                      plannedDurationMin: session.planned_duration_min,
                    })
                  : { startMs: 0, endMs: 0 },
          };
        }),
      sessionWindows: own.map((s) =>
        sessionWindow({ startsAt: s.starts_at, plannedDurationMin: s.planned_duration_min }),
      ),
      consentCoverages: POD_DATA_CONSENTS.map((type) =>
        consentCoverage({ type, records, birthDate, timeZone }),
      ),
    });
    if (windows.length === 0) continue;
    // Each instant goes to the first session (by start) whose window holds it.
    let left = windows;
    const bySession: { id: string; windows: TimeInterval[] }[] = [];
    for (const session of [...own].sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())) {
      const inside = intersectIntervals(left, [
        sessionWindow({
          startsAt: session.starts_at,
          plannedDurationMin: session.planned_duration_min,
        }),
      ]);
      if (inside.length === 0) continue;
      bySession.push({ id: session.id, windows: inside });
      left = subtract(left, inside);
    }
    trims.push({ playerId, windows, sessions: bySession });
  }
  return { trims, sessions, assignments };
}

// ─── Writing what a player keeps ─────────────────────────────────────────────────────

interface TraceMeta {
  podId: string;
  uploadId: string;
  firmwareVersion: string | null;
  gnssFirmwareVersion: string | null;
  lowConfidence: boolean;
  expiresAt: Date;
}

async function insertTrace(
  tx: ClubTransaction,
  clubId: ClubId,
  meta: TraceMeta,
  playerId: string,
  sessionId: string,
  rawFileId: string | null,
  index: number,
  chunk: readonly TraceSample[],
): Promise<void> {
  const first = chunk[0];
  const last = chunk.at(-1);
  if (first === undefined || last === undefined) return;
  await tx.client.query(
    `insert into pod_trace_segment (club_id, player_id, training_session_id, pod_id,
       pod_raw_upload_id, raw_file_id, chunk_index, method_variant, algorithm_version,
       firmware_version, gnss_firmware_version, starts_at, ends_at, samples_n, offsets_ms,
       lat_e7, lon_e7, speed_mm_s, h_acc_mm, fix_quality, time_low_confidence, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'pod_log', $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21)
     on conflict (club_id, pod_raw_upload_id, player_id, training_session_id, chunk_index)
     do nothing`,
    [
      clubId,
      playerId,
      sessionId,
      meta.podId,
      meta.uploadId,
      rawFileId,
      index,
      POD_LOG_TRACE_ALGORITHM_VERSION,
      meta.firmwareVersion,
      meta.gnssFirmwareVersion,
      new Date(first.timeMs),
      // Exclusive end: one sample interval after the last.
      new Date(last.timeMs + 1000),
      chunk.length,
      chunk.map((s) => s.timeMs - first.timeMs),
      chunk.map((s) => s.latE7),
      chunk.map((s) => s.lonE7),
      chunk.map((s) => s.speedMmS),
      chunk.map((s) => s.hAccMm),
      chunk.map((s) => s.fix),
      meta.lowConfidence,
      meta.expiresAt,
    ],
  );
}

/** Puts a trimmed file of a player in the bucket and records it; returns its id. */
async function writeTrimmedFile(
  deps: PodRawIngestDependencies,
  tx: ClubTransaction,
  clubId: ClubId,
  playerId: string,
  bytes: Uint8Array,
  sha256Hex: string,
  now: Date,
  expiresAt: Date,
  written: string[],
): Promise<string> {
  const fileId = randomUUID();
  const checksum = Buffer.from(sha256Hex, 'hex').toString('base64');
  const key = objectKey(clubId, fileId);
  await deps.storage.put({
    key,
    body: bytes,
    contentType: 'application/octet-stream',
    checksumSha256: checksum,
  });
  written.push(key);
  await tx.client.query(
    `insert into file (id, club_id, kind, status, player_id, content_type, size_bytes,
                       checksum_sha256, file_name, uploaded_at, expires_at)
     values ($1, $2, 'pod_raw', 'ready', $3, 'application/octet-stream', $4, $5, $6, $7, $8)`,
    [fileId, clubId, playerId, bytes.length, checksum, 'pod-raw-trimmed.sprw', now, expiresAt],
  );
  return fileId;
}

// ─── 4. The one-time trim ────────────────────────────────────────────────────────────

async function trimNext(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  masterKey: Uint8Array | null,
  skip: string[],
  now: Date,
): Promise<StepResult> {
  const written: string[] = [];
  try {
    return await inClubTransaction(deps.pool, clubId, async (tx) => {
      const row = await lockNext(tx, clubId, 'verified', skip);
      if (row === undefined) return { outcome: 'none' };
      const pendingUntil = row.pending_until ?? now;
      const from = row.recorded_from;
      const to = row.recorded_to;
      let trims: PlayerTrim[] = [];
      let ranges = new Map<string, TimeInterval[]>();
      if (from !== null && to !== null) {
        const found = await playerTrims(tx, clubId, row.pod_id, from, to);
        ranges = rangesByPlayer(found.assignments);
        const due = podRawTrimDue({
          now,
          pendingUntil,
          sessionEnds: found.sessions.map(
            (s) =>
              new Date(
                sessionWindow({ startsAt: s.starts_at, plannedDurationMin: s.planned_duration_min })
                  .endMs,
              ),
          ),
          openAssignment: found.assignments.some((a) => a.ends_at === null),
        });
        if (!due) return { outcome: 'waiting' };
        trims = found.trims;
      }
      if (trims.length > 0) {
        // Serialized with the erasure of each player (revoking location), and checked again
        // under the lock: a revocation committed meanwhile keeps that player out.
        await lockPlayersLocation(
          tx,
          clubId,
          trims.map((t) => t.playerId),
        );
        // Read again under the lock: the consents may have changed since the first read.
        // Only the players locked: a consent signed between the two reads never adds one.
        if (from !== null && to !== null) {
          const locked = new Set(trims.map((t) => t.playerId));
          trims = (await playerTrims(tx, clubId, row.pod_id, from, to)).trims.filter((t) =>
            locked.has(t.playerId),
          );
        }
        const keeping = await playersStillKeepingLocation(
          tx,
          clubId,
          trims.map((t) => t.playerId),
        );
        trims = trims.filter((t) => keeping.has(t.playerId));
      }
      // Without absolute time nothing can be placed in a session: nothing becomes data.
      let segment: DecodedSegment | undefined;
      let base: TimeBase | undefined;
      let bytes: Uint8Array | null = null;
      if (trims.length > 0) {
        if (masterKey === null) {
          if (now < pendingUntil) return { outcome: 'waiting' };
          // Never decoded in time: nothing of it becomes data, before retention takes the object.
          const removed = await reject(tx, clubId, row, 'master_key_missing_expired', now);
          return { outcome: 'rejected', remove: [removed] };
        }
        const opened = await openUpload(deps, clubId, row, masterKey);
        if (!opened.ok && opened.transient) {
          await setIssues(
            tx,
            clubId,
            row,
            mergeIssues(row.issues, [{ code: 'storage_unavailable' }]),
          );
          return { outcome: 'skipped' };
        }
        if (!opened.ok) {
          const removed = await reject(tx, clubId, row, opened.reason, now);
          deps.logger.warn(
            { clubId, podRawUploadId: row.id, reason: opened.reason },
            'verified pod_raw rejected at the trim',
          );
          return { outcome: 'rejected', remove: [removed] };
        }
        bytes = opened.bytes;
        segment = opened.decoded.segments[0];
        base = segment === undefined ? undefined : timeBaseOf(opened.decoded, segment);
      }
      const meta: TraceMeta = {
        podId: row.pod_id,
        uploadId: row.id,
        firmwareVersion: row.firmware_version,
        gnssFirmwareVersion: row.gnss_firmware_version,
        lowConfidence: row.issues.some((i) => LOW_CONFIDENCE.includes(i.code)),
        expiresAt: fileExpiresAt('pod_raw', now) ?? now,
      };
      let samplesTotal = 0;
      let players = 0;
      let untimed = 0;
      let shared = 0;
      if (segment !== undefined && bytes !== null) {
        const timed = timedPages(segment, base);
        untimed = timed.untimed;
        // Ownership from the assignment ranges of every player, not only those with data.
        const assigned = assignPages(
          timed.pages,
          new Map(trims.map((trim) => [trim.playerId, trim.windows])),
          ranges,
        );
        shared = assigned.shared.length;
        for (const trim of trims) {
          const pages = assigned.byPlayer.get(trim.playerId) ?? [];
          const perSession = trim.sessions.map((s) => ({
            id: s.id,
            chunks: traceChunks(traceSamples(segment, base, s.windows)),
          }));
          if (pages.length === 0 && perSession.every((s) => s.chunks.length === 0)) continue;
          players += 1;
          const sliced = slicePodRawFile(bytes, new Set(pages.map((p) => p.physicalPage)));
          const rawFileId =
            sliced === null
              ? null
              : await writeTrimmedFile(
                  deps,
                  tx,
                  clubId,
                  trim.playerId,
                  sliced.bytes,
                  sliced.sha256Hex,
                  now,
                  meta.expiresAt,
                  written,
                );
          // The pages left out because another player's windows touch them.
          const sharedOfPlayer = assigned.shared.filter((p) =>
            intervalsOverlap(trim.windows, p.fromMs, p.toMs),
          ).length;
          await tx.client.query(
            `insert into pod_raw_trim (club_id, pod_raw_upload_id, player_id, file_id, windows,
                                       pages, shared_pages_n)
             values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
            [
              clubId,
              row.id,
              trim.playerId,
              rawFileId,
              JSON.stringify(trim.windows),
              JSON.stringify(pages),
              sharedOfPlayer,
            ],
          );
          for (const session of perSession) {
            for (const [index, chunk] of session.chunks.entries()) {
              samplesTotal += chunk.length;
              await insertTrace(
                tx,
                clubId,
                meta,
                trim.playerId,
                session.id,
                rawFileId,
                index,
                chunk,
              );
            }
          }
        }
      }
      const added: PodRawIssue[] = [];
      if (untimed > 0) added.push({ code: 'untimed_pages', count: untimed });
      if (shared > 0) added.push({ code: 'shared_pages', count: shared });
      const issues = mergeIssues(
        row.issues.filter((i) => i.code !== 'storage_unavailable'),
        added,
      );
      await tx.client.query(
        `update pod_raw_upload
            set state = 'trimmed', trimmed_at = $3, trimmed_players_n = $4, trimmed_samples_n = $5,
                issues = $6::jsonb
          where club_id = $1 and id = $2`,
        [clubId, row.id, now, players, samplesTotal, JSON.stringify(issues)],
      );
      // The rest is deleted: the original pending file goes, only the trimmed ones stay.
      await deleteFile(tx, clubId, row.file_id, now);
      deps.logger.info(
        { clubId, podRawUploadId: row.id, players, samples: samplesTotal, shared },
        'pod_raw trimmed',
      );
      return { outcome: 'trimmed', remove: [objectKey(clubId, row.file_id)] };
    });
  } catch (error) {
    // Objects written for a transaction that did not commit are untracked: remove them.
    await Promise.allSettled(written.map((key) => deps.storage.remove(key)));
    throw error;
  }
}

// ─── 2. Corrections after the trim ───────────────────────────────────────────────────

interface TrimRow {
  id: string;
  player_id: string;
  file_id: string | null;
  windows: TimeInterval[];
  pages: TimedPage[];
}

interface TraceRow {
  training_session_id: string;
  chunk_index: number;
  starts_at: Date;
  offsets_ms: number[];
  lat_e7: number[];
  lon_e7: number[];
  speed_mm_s: (number | null)[];
  h_acc_mm: (number | null)[];
  fix_quality: number[];
  time_low_confidence: boolean;
  expires_at: Date;
}

function sameIntervals(a: readonly TimeInterval[], b: readonly TimeInterval[]): boolean {
  return (
    JSON.stringify(a.map((x) => [x.startMs, x.endMs])) ===
    JSON.stringify(b.map((x) => [x.startMs, x.endMs]))
  );
}

/**
 * Cuts what a player kept of a trimmed upload down to `kept`: the trace samples
 * outside it are deleted, and the pages of their file outside it too (a new
 * trimmed file of the pages left; the old one deleted). Returns the samples
 * deleted and the objects to remove after the commit.
 */
async function cutPlayer(
  deps: PodRawIngestDependencies,
  tx: ClubTransaction,
  clubId: ClubId,
  upload: UploadRow,
  trim: TrimRow,
  kept: TimeInterval[],
  pages: TimedPage[],
  now: Date,
  written: string[],
): Promise<{ samplesDeleted: number; remove: string[] }> {
  const remove: string[] = [];
  let fileId = trim.file_id;
  if (trim.file_id !== null && pages.length !== trim.pages.length) {
    const { rows } = await tx.client.query<{ size_bytes: string; expires_at: Date | null }>(
      `select size_bytes, expires_at from file where club_id = $1 and id = $2 and status = 'ready'`,
      [clubId, trim.file_id],
    );
    const current = rows[0];
    fileId = null;
    if (current !== undefined && pages.length > 0) {
      const bytes = await deps.storage.get(
        objectKey(clubId, trim.file_id),
        Number(current.size_bytes),
      );
      const sliced =
        bytes === null ? null : slicePodRawFile(bytes, new Set(pages.map((p) => p.physicalPage)));
      if (sliced !== null) {
        fileId = await writeTrimmedFile(
          deps,
          tx,
          clubId,
          trim.player_id,
          sliced.bytes,
          sliced.sha256Hex,
          now,
          current.expires_at ?? fileExpiresAt('pod_raw', now) ?? now,
          written,
        );
      }
    }
  }
  // The traces: cut and written again (they never change in place), with the new file.
  const { rows: traces } = await tx.client.query<TraceRow>(
    `select training_session_id, chunk_index, starts_at, offsets_ms, lat_e7, lon_e7, speed_mm_s,
            h_acc_mm, fix_quality, time_low_confidence, expires_at
       from pod_trace_segment where club_id = $1 and pod_raw_upload_id = $2 and player_id = $3
      order by training_session_id, chunk_index`,
    [clubId, upload.id, trim.player_id],
  );
  let samplesDeleted = 0;
  await tx.client.query(
    `delete from pod_trace_segment where club_id = $1 and pod_raw_upload_id = $2 and player_id = $3`,
    [clubId, upload.id, trim.player_id],
  );
  for (const trace of traces) {
    const start = trace.starts_at.getTime();
    const samples: TraceSample[] = [];
    trace.offsets_ms.forEach((offset, i) => {
      const timeMs = start + offset;
      if (!intervalsContain(kept, timeMs)) return;
      samples.push({
        timeMs,
        latE7: trace.lat_e7[i] ?? 0,
        lonE7: trace.lon_e7[i] ?? 0,
        speedMmS: trace.speed_mm_s[i] ?? null,
        hAccMm: trace.h_acc_mm[i] ?? null,
        fix: trace.fix_quality[i] ?? 0,
      });
    });
    samplesDeleted += trace.offsets_ms.length - samples.length;
    await insertTrace(
      tx,
      clubId,
      {
        podId: upload.pod_id,
        uploadId: upload.id,
        firmwareVersion: upload.firmware_version,
        gnssFirmwareVersion: upload.gnss_firmware_version,
        lowConfidence: trace.time_low_confidence,
        expiresAt: trace.expires_at,
      },
      trim.player_id,
      trace.training_session_id,
      fileId,
      trace.chunk_index,
      samples,
    );
  }
  if (trim.file_id !== null && fileId !== trim.file_id) {
    await deleteFile(tx, clubId, trim.file_id, now);
    remove.push(objectKey(clubId, trim.file_id));
  }
  if (kept.length === 0) {
    await tx.client.query(`delete from pod_raw_trim where club_id = $1 and id = $2`, [
      clubId,
      trim.id,
    ]);
  } else {
    await tx.client.query(
      `update pod_raw_trim set file_id = $3, windows = $4::jsonb, pages = $5::jsonb
        where club_id = $1 and id = $2`,
      [clubId, trim.id, fileId, JSON.stringify(kept), JSON.stringify(pages)],
    );
  }
  return { samplesDeleted, remove };
}

/**
 * One corrected or voided assignment: every trimmed upload of its pod where
 * its player kept something is cut down to what the current assignments,
 * sessions and consents still allow. Nothing is ever added: the original is
 * gone, the data cannot move to another player.
 */
async function correctAssignment(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  assignmentId: string,
  now: Date,
): Promise<{ done: boolean; remove: string[] }> {
  const written: string[] = [];
  try {
    return await inClubTransaction(deps.pool, clubId, async (tx) => {
      const { rows } = await tx.client.query<{ pod_id: string; player_id: string }>(
        `select pod_id, player_id from pod_assignment
          where club_id = $1 and id = $2 and reprocess_requested_at is not null
          for update skip locked`,
        [clubId, assignmentId],
      );
      const assignment = rows[0];
      if (assignment === undefined) return { done: false, remove: [] };
      const { rows: uploads } = await tx.client.query<UploadRow>(
        `select ${UPLOAD_COLUMNS} from pod_raw_upload u
          where u.club_id = $1 and u.pod_id = $2 and u.state = 'trimmed'
            and u.recorded_from is not null and u.recorded_to is not null
            and exists (select 1 from pod_raw_trim t
                         where t.club_id = u.club_id and t.pod_raw_upload_id = u.id
                           and t.player_id = $3)
          order by u.recorded_from
          for update of u`,
        [clubId, assignment.pod_id, assignment.player_id],
      );
      // Every player kept in these uploads, locked once and in order before their rows (an
      // erasure holds the same lock while it deletes them): a player whose location was
      // revoked, or has an erasure pending, keeps nothing.
      const { rows: keptRows } = await tx.client.query<{ player_id: string }>(
        `select distinct player_id from pod_raw_trim
          where club_id = $1 and pod_raw_upload_id = any ($2::uuid[])`,
        [clubId, uploads.map((u) => u.id)],
      );
      const players = keptRows.map((r) => r.player_id);
      await lockPlayersLocation(tx, clubId, players);
      const keeping = await playersStillKeepingLocation(tx, clubId, players);
      const remove: string[] = [];
      for (const upload of uploads) {
        if (upload.recorded_from === null || upload.recorded_to === null) continue;
        const { trims, assignments } = await playerTrims(
          tx,
          clubId,
          upload.pod_id,
          upload.recorded_from,
          upload.recorded_to,
        );
        const windowsNow = new Map(trims.map((t) => [t.playerId, t.windows]));
        // The current ranges of every player: a hand-over moved earlier takes pages away too.
        const rangesNow = rangesByPlayer(assignments);
        const { rows: trimRows } = await tx.client.query<TrimRow>(
          `select id, player_id, file_id, windows, pages from pod_raw_trim
            where club_id = $1 and pod_raw_upload_id = $2 for update`,
          [clubId, upload.id],
        );
        let samplesDeleted = 0;
        let changed = false;
        for (const trim of trimRows) {
          const kept = keeping.has(trim.player_id)
            ? intersectIntervals(trim.windows, windowsNow.get(trim.player_id) ?? [])
            : [];
          const pages = pagesStillOwned(trim.pages, kept, otherRanges(rangesNow, trim.player_id));
          if (
            sameIntervals(normalizeIntervals(trim.windows), kept) &&
            pages.length === trim.pages.length
          ) {
            continue;
          }
          changed = true;
          const cut = await cutPlayer(deps, tx, clubId, upload, trim, kept, pages, now, written);
          samplesDeleted += cut.samplesDeleted;
          remove.push(...cut.remove);
        }
        const previous = upload.issues.find((i) => i.code === 'assignment_corrected_after_trim');
        await setIssues(
          tx,
          clubId,
          upload,
          mergeIssues(upload.issues, [
            {
              code: 'assignment_corrected_after_trim',
              count: (previous?.count ?? 0) + samplesDeleted,
            },
          ]),
        );
        if (changed) {
          deps.logger.info(
            { clubId, podRawUploadId: upload.id, samplesDeleted },
            'pod_raw cut after a corrected assignment',
          );
        }
      }
      await tx.client.query(
        `update pod_assignment set reprocess_requested_at = null where club_id = $1 and id = $2`,
        [clubId, assignmentId],
      );
      return { done: true, remove };
    });
  } catch (error) {
    await Promise.allSettled(written.map((key) => deps.storage.remove(key)));
    throw error;
  }
}

async function flaggedAssignments(deps: PodRawIngestDependencies, clubId: ClubId) {
  return inClubTransaction(deps.pool, clubId, async (tx) => {
    // Voided ones too: a void is the widest correction.
    const { rows } = await tx.client.query<{ id: string }>(
      `select a.id from pod_assignment a
        where a.club_id = $1 and a.reprocess_requested_at is not null
          and exists (select 1 from pod_raw_upload u where u.club_id = a.club_id and u.pod_id = a.pod_id)
        order by a.reprocess_requested_at, a.id
        limit $2`,
      [clubId, POD_CORRECTIONS_BATCH],
    );
    return rows.map((r) => r.id);
  });
}

// ─── The job ─────────────────────────────────────────────────────────────────────────

export async function runClubPodRawIngest(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<PodRawIngestReport> {
  const requestId = options.jobId === undefined ? {} : { requestId: `job:${options.jobId}` };
  const now = deps.now?.() ?? new Date();
  const errors: unknown[] = [];
  const { expired, tracesDeleted } = await inClubTransaction(
    deps.pool,
    clubId,
    async (tx) => ({
      expired: await rejectExpiredUploads(tx, clubId, now),
      tracesDeleted: await deleteExpiredTraces(tx, clubId, now),
    }),
    requestId,
  );

  let reprocessed = 0;
  const flagged = await flaggedAssignments(deps, clubId);
  for (const assignmentId of flagged) {
    try {
      const result = await correctAssignment(deps, clubId, assignmentId, now);
      if (result.done) reprocessed += 1;
      await removeObjects(deps, result.remove);
    } catch (error) {
      errors.push(error);
      deps.logger.error({ err: error, clubId, assignmentId }, 'pod_raw correction failed');
    }
  }

  const masterKey = await deps.keys.masterKey(clubId);
  let verified = 0;
  let rejected = 0;
  let trimmed = 0;
  let budget = POD_RAW_BATCH;
  const step = async (
    run: (skip: string[]) => Promise<StepResult>,
    skip: string[],
  ): Promise<Outcome> => {
    try {
      const result = await run(skip);
      await removeObjects(deps, result.remove ?? []);
      return result.outcome;
    } catch (error) {
      // The upload is in `skip` already: the rest of the club's queue goes on.
      errors.push(error);
      deps.logger.error({ err: error, clubId, podRawUploadId: skip.at(-1) }, 'pod_raw step failed');
      return 'skipped';
    }
  };
  const skipVerify: string[] = [];
  while (budget > 0) {
    const outcome = await step(
      (skip) => verifyNext(deps, clubId, masterKey, skip, now),
      skipVerify,
    );
    if (outcome === 'none') break;
    if (outcome === 'skipped') continue;
    budget -= 1;
    if (outcome === 'verified') verified += 1;
    else rejected += 1;
  }
  const skipTrim: string[] = [];
  while (budget > 0) {
    const outcome = await step((skip) => trimNext(deps, clubId, masterKey, skip, now), skipTrim);
    if (outcome === 'none') break;
    if (outcome === 'waiting' || outcome === 'skipped') continue;
    budget -= 1;
    if (outcome === 'trimmed') trimmed += 1;
    else rejected += 1;
  }
  const report: PodRawIngestReport = {
    expired,
    reprocessed,
    verified,
    rejected,
    trimmed,
    tracesDeleted,
    failed: errors.length,
    more:
      budget === 0 ||
      tracesDeleted === POD_TRACE_RETENTION_BATCH ||
      flagged.length === POD_CORRECTIONS_BATCH,
  };
  deps.logger.info({ clubId, jobId: options.jobId, ...report }, 'pod_raw ingestion');
  // Everything else went on; failing now makes pg-boss retry (and Sentry see it).
  if (errors.length > 0) throw errors[0];
  return report;
}

/** The clubs with ingestion work (`app.worker_pod_raw_clubs()`). */
export async function listPodRawClubs(pool: pg.Pool): Promise<ClubId[]> {
  const { rows } = await pool.query<{ club_id: ClubId }>(
    'select c as club_id from app.worker_pod_raw_clubs() c',
  );
  return rows.map((r) => r.club_id);
}
