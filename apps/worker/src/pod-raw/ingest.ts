import { randomUUID } from 'node:crypto';
import {
  POD_DATA_CONSENTS,
  POD_LOG_TRACE_ALGORITHM_VERSION,
  POD_SESSION_DEFAULT_DURATION_MIN,
  POD_TIME_BASE_MIN_ANCHORS,
  POD_TRACE_CHUNK_MAX_SAMPLES,
  consentCoverage,
  decimateByTime,
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
  FIX_QUALITIES,
  PodProtocolError,
  decodeLog,
  deriveStorageKey,
  encodeEraseCommand,
  fromHex,
  gnssMsToUnixMs,
  podRawIngestKey,
  readPodRawFile,
  slicePodRawFile,
  tickToGnssMs,
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

/**
 * Ingestion of the pod's NAND log (B-916, ADR 0106, ADR 0108), the
 * `pod-raw-ingest-club` job. Per club, in this order:
 *
 * 1. An upload whose window closed without bytes is rejected (`file_missing`).
 * 2. Assignments of a pod with uploads that were corrected or voided
 *    (`reprocess_requested_at`): while the raw is pending nothing was kept, so
 *    the trim uses the corrected ranges; after the trim it is reported
 *    (`assignment_corrected_after_trim`), never moved to another player. The
 *    flag is cleared.
 * 3. Every confirmed upload is decoded with the pod's storage keys (from the
 *    club's master key and the manifest's `DEVICEID`) and checked with
 *    `verifyUploadForErase`: `verified` with the canonical erase command the
 *    API signs, or `rejected`. The time base is reported when it is weak.
 * 4. A verified upload whose sessions ended and whose assignments closed (or
 *    whose pending days are over) is trimmed once: per player, only what is
 *    inside a session **and** a valid assignment **and** the `data` and
 *    `location` consents in force at that instant becomes data: a 1 Hz trace
 *    (`pod_trace_segment`, method `pod_log`) and a trimmed `pod_raw` of that
 *    player with only the pages of those windows (byte for byte: nothing is
 *    re-sealed). The original file is deleted.
 * 5. Traces past their retention are deleted.
 *
 * Idempotent: each step moves rows forward under `FOR UPDATE SKIP LOCKED`
 * and a re-run finds nothing to do. No metric is computed here (speed bands,
 * HSR, accelerations and `accel_load_au` come with B-919 and B-906, from the
 * trimmed raw). Logs carry ids and counts, never a position.
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
  readonly reprocessed: number;
  readonly verified: number;
  readonly rejected: number;
  readonly trimmed: number;
  readonly tracesDeleted: number;
  /** More work than one run does: the caller enqueues the job again. */
  readonly more: boolean;
}

/** Uploads decoded per run (each one reads a file of up to hundreds of MiB). */
export const POD_RAW_BATCH = 4;
/** Traces deleted per run by the retention. */
export const POD_TRACE_RETENTION_BATCH = 1000;
/** A gap longer than this between two kept samples starts a new trace row. */
export const POD_TRACE_GAP_MS = 10_000;

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

// ─── Decoding ────────────────────────────────────────────────────────────────────────

type Opened =
  | {
      ok: true;
      bytes: Uint8Array;
      pages: NandPageRead[];
      decoded: DecodedLog;
      manifest: PodRawManifest;
    }
  | { ok: false; reason: PodRawRejectionReason };

/** Reads the object and decodes it with the pod's storage keys of the manifest's epochs. */
async function openUpload(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  row: UploadRow,
  masterKey: Uint8Array,
): Promise<Opened> {
  const manifest = manifestOf(row);
  // The row was created for this segment: the same idempotency key as the protocol's.
  if (podRawIngestKey(manifest) !== row.ingest_key)
    return { ok: false, reason: 'manifest_mismatch' };
  let bytes: Uint8Array | null;
  try {
    bytes = await deps.storage.get(objectKey(clubId, row.file_id), manifest.sizeB);
  } catch (error) {
    // Bigger than the manifest says: not the declared file.
    if (error instanceof ObjectTooLargeError) return { ok: false, reason: 'manifest_mismatch' };
    throw error;
  }
  if (bytes === null) return { ok: false, reason: 'file_missing' };
  let pages: NandPageRead[];
  try {
    pages = readPodRawFile(bytes, manifest).pages;
  } catch (error) {
    const code = error instanceof PodProtocolError ? error.code : 'unknown';
    if (code === 'manifest_mismatch') return { ok: false, reason: 'manifest_mismatch' };
    if (error instanceof PodProtocolError) return { ok: false, reason: 'invalid_container' };
    throw error;
  }
  // Always with the manifest's DEVICEID (checked against the pod's device on insert).
  const deviceId = fromHex(manifest.deviceIdHex);
  const epochs = new Set(manifest.keyEpochs);
  const keys = new Map<number, Uint8Array>();
  const decoded = decodeLog({
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

// ─── 1. Expired upload windows ───────────────────────────────────────────────────────

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

// ─── 2. Corrected assignments ────────────────────────────────────────────────────────

async function processReprocessFlags(tx: ClubTransaction, clubId: ClubId): Promise<number> {
  const { rows } = await tx.client.query<{
    id: string;
    pod_id: string;
    starts_at: Date;
    ends_at: Date | null;
  }>(
    `select a.id, a.pod_id, a.starts_at, a.ends_at from pod_assignment a
      where a.club_id = $1 and a.reprocess_requested_at is not null
        and exists (select 1 from pod_raw_upload u where u.club_id = a.club_id and u.pod_id = a.pod_id)
      order by a.reprocess_requested_at, a.id
      limit 100
      for update of a skip locked`,
    [clubId],
  );
  for (const assignment of rows) {
    const { rows: trimmed } = await tx.client.query<{ id: string; issues: PodRawIssue[] }>(
      `select id, issues from pod_raw_upload
        where club_id = $1 and pod_id = $2 and state = 'trimmed'
          and recorded_from is not null and recorded_to is not null
          and recorded_from < coalesce($4::timestamptz, 'infinity') and recorded_to >= $3
        for update`,
      [clubId, assignment.pod_id, assignment.starts_at, assignment.ends_at],
    );
    for (const upload of trimmed) {
      await tx.client.query(
        `update pod_raw_upload set issues = $3::jsonb where club_id = $1 and id = $2`,
        [
          clubId,
          upload.id,
          JSON.stringify(mergeIssues(upload.issues, [{ code: 'assignment_corrected_after_trim' }])),
        ],
      );
    }
    // Pending uploads need nothing: the trim reads the corrected ranges.
    await tx.client.query(
      `update pod_assignment set reprocess_requested_at = null where club_id = $1 and id = $2`,
      [clubId, assignment.id],
    );
  }
  return rows.length;
}

// ─── 3. Verification ─────────────────────────────────────────────────────────────────

async function lockNext(tx: ClubTransaction, clubId: ClubId, state: string, extra = '') {
  const { rows } = await tx.client.query<UploadRow>(
    `select ${UPLOAD_COLUMNS} from pod_raw_upload
      where club_id = $1 and state = $2 ${extra}
      order by confirmed_at, id
      limit 1
      for update skip locked`,
    [clubId, state],
  );
  return rows[0];
}

async function reject(
  tx: ClubTransaction,
  clubId: ClubId,
  row: UploadRow,
  reason: PodRawRejectionReason,
  now: Date,
): Promise<void> {
  await tx.client.query(
    `update pod_raw_upload set state = 'rejected', rejection_reason = $3, rejected_at = $4
      where club_id = $1 and id = $2`,
    [clubId, row.id, reason, now],
  );
  await deleteFile(tx, clubId, row.file_id, now);
}

/** Marks a file deleted now: the retention job removes the object (ADR 0044). */
async function deleteFile(tx: ClubTransaction, clubId: ClubId, fileId: string, now: Date) {
  await tx.client.query(
    `update file set status = 'deleted', deleted_at = coalesce(deleted_at, $3), expires_at = $3
      where club_id = $1 and id = $2 and status <> 'deleted'`,
    [clubId, fileId, now],
  );
}

type VerifyOutcome = 'verified' | 'rejected' | 'skipped' | 'none';

async function verifyNext(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  masterKey: Uint8Array | null,
  skip: readonly string[],
): Promise<{ outcome: VerifyOutcome; id?: string }> {
  const now = deps.now?.() ?? new Date();
  return inClubTransaction(deps.pool, clubId, async (tx) => {
    const row = await lockNext(
      tx,
      clubId,
      'pending',
      skip.length === 0 ? '' : `and id <> all ('{${skip.join(',')}}'::uuid[])`,
    );
    if (row === undefined) return { outcome: 'none' };
    if (masterKey === null) {
      // Kept pending until the club has a key (or its pending days are over).
      await tx.client.query(
        `update pod_raw_upload set issues = $3::jsonb where club_id = $1 and id = $2`,
        [clubId, row.id, JSON.stringify(mergeIssues(row.issues, [{ code: 'master_key_missing' }]))],
      );
      return { outcome: 'skipped', id: row.id };
    }
    const opened = await openUpload(deps, clubId, row, masterKey);
    if (!opened.ok) {
      await reject(tx, clubId, row, opened.reason, now);
      deps.logger.warn(
        { clubId, podRawUploadId: row.id, reason: opened.reason },
        'pod_raw rejected',
      );
      return { outcome: 'rejected', id: row.id };
    }
    const verification = verifyUploadForErase({
      manifest: opened.manifest,
      pages: opened.pages,
      decoded: opened.decoded,
    });
    if (!verification.ok) {
      await reject(tx, clubId, row, verification.reason, now);
      deps.logger.warn(
        { clubId, podRawUploadId: row.id, reason: verification.reason },
        'pod_raw rejected',
      );
      return { outcome: 'rejected', id: row.id };
    }
    const segment = opened.decoded.segments[0];
    if (segment === undefined) throw new Error('a verified upload has its segment');
    const base = timeBaseOf(opened.decoded, segment);
    const range = recordedRange(segment, base);
    const versions = versionsOf(segment);
    const issues = mergeIssues(
      row.issues.filter((i) => i.code !== 'master_key_missing'),
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
    return { outcome: 'verified', id: row.id };
  });
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

// ─── 4. The one-time trim ────────────────────────────────────────────────────────────

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
  reprocess_requested_at: Date | null;
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

async function assignmentsOverlapping(
  tx: ClubTransaction,
  clubId: ClubId,
  podId: string,
  from: Date,
  to: Date,
): Promise<AssignmentRow[]> {
  const { rows } = await tx.client.query<AssignmentRow>(
    `select id, player_id, training_session_id, starts_at, ends_at, reprocess_requested_at
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

interface TraceSample {
  timeMs: number;
  latE7: number;
  lonE7: number;
  speedMmS: number | null;
  hAccMm: number | null;
  fix: number;
}

interface PlayerTrim {
  playerId: string;
  windows: TimeInterval[];
  /** Session id → the windows inside it. */
  sessions: { id: string; windows: TimeInterval[] }[];
}

/** Per player, where their data is (sessions × assignments × consents per instant). */
async function playerTrims(
  tx: ClubTransaction,
  clubId: ClubId,
  timeZone: TimeZone,
  sessions: readonly SessionRow[],
  assignments: readonly AssignmentRow[],
): Promise<PlayerTrim[]> {
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
  const out: PlayerTrim[] = [];
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
    out.push({ playerId, windows, sessions: bySession });
  }
  return out;
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

/** The 1 Hz samples of the windows, from the PVT epochs with a fix. */
export function traceSamples(
  segment: DecodedSegment,
  base: TimeBase | undefined,
  windows: readonly TimeInterval[],
): TraceSample[] {
  const offset = base?.gpsUtcOffsetS;
  const samples: TraceSample[] = [];
  for (const pvt of segment.streams.pvt) {
    if (pvt.fixQuality === 'no_fix') continue;
    const timeMs = Math.round(gnssMsToUnixMs(pvt.gnssTimeMs, offset));
    if (!intervalsContain(windows, timeMs)) continue;
    samples.push({
      timeMs,
      latE7: pvt.latE7,
      lonE7: pvt.lonE7,
      speedMmS: pvt.groundSpeedMmS,
      hAccMm: pvt.hAccMm,
      fix: FIX_QUALITIES.indexOf(pvt.fixQuality),
    });
  }
  samples.sort((x, y) => x.timeMs - y.timeMs);
  return decimateByTime(samples);
}

/** Contiguous stretches of at most {@link POD_TRACE_CHUNK_MAX_SAMPLES}. */
export function traceChunks(samples: readonly TraceSample[]): TraceSample[][] {
  const chunks: TraceSample[][] = [];
  let current: TraceSample[] = [];
  for (const sample of samples) {
    const previous = current.at(-1);
    if (
      previous !== undefined &&
      (sample.timeMs - previous.timeMs > POD_TRACE_GAP_MS ||
        current.length >= POD_TRACE_CHUNK_MAX_SAMPLES)
    ) {
      chunks.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The physical pages whose records fall in the windows; untimed pages never do. */
export function pagesInWindows(
  segment: DecodedSegment,
  base: TimeBase | undefined,
  windows: readonly TimeInterval[],
): { keep: Set<number>; untimed: number } {
  const keep = new Set<number>();
  let untimed = 0;
  const offset = base?.gpsUtcOffsetS;
  for (const span of segment.pageTicks) {
    const from = base && span.firstTick !== null ? tickToGnssMs(base, span.firstTick) : null;
    const to = base && span.lastTick !== null ? tickToGnssMs(base, span.lastTick) : null;
    if (from === null || to === null) {
      untimed += 1;
      continue;
    }
    if (intervalsOverlap(windows, gnssMsToUnixMs(from, offset), gnssMsToUnixMs(to, offset))) {
      keep.add(span.physicalPage);
    }
  }
  return { keep, untimed };
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

type TrimOutcome = 'trimmed' | 'waiting' | 'none';

async function trimNext(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  masterKey: Uint8Array | null,
  skip: readonly string[],
): Promise<{ outcome: TrimOutcome; id?: string }> {
  const now = deps.now?.() ?? new Date();
  const written: string[] = [];
  try {
    return await inClubTransaction(deps.pool, clubId, async (tx) => {
      const row = await lockNext(
        tx,
        clubId,
        'verified',
        skip.length === 0 ? '' : `and id <> all ('{${skip.join(',')}}'::uuid[])`,
      );
      if (row === undefined) return { outcome: 'none' };
      const pendingUntil = row.pending_until ?? now;
      const from = row.recorded_from;
      const to = row.recorded_to;
      let sessions: SessionRow[] = [];
      let assignments: AssignmentRow[] = [];
      if (from !== null && to !== null) {
        sessions = await sessionsOverlapping(tx, clubId, from, to);
        assignments = await assignmentsOverlapping(tx, clubId, row.pod_id, from, to);
        const due = podRawTrimDue({
          now,
          pendingUntil,
          sessionEnds: sessions.map(
            (s) =>
              new Date(
                sessionWindow({ startsAt: s.starts_at, plannedDurationMin: s.planned_duration_min })
                  .endMs,
              ),
          ),
          openAssignment: assignments.some((a) => a.ends_at === null),
          reprocessPending: assignments.some((a) => a.reprocess_requested_at !== null),
        });
        if (!due) return { outcome: 'waiting', id: row.id };
      }
      // Without absolute time nothing can be placed in a session: nothing becomes data.
      let trims: PlayerTrim[] = [];
      let segment: DecodedSegment | undefined;
      let base: TimeBase | undefined;
      let bytes: Uint8Array | null = null;
      if (from !== null && to !== null && assignments.length > 0 && sessions.length > 0) {
        if (masterKey === null) return { outcome: 'waiting', id: row.id };
        trims = await playerTrims(
          tx,
          clubId,
          await clubTimeZone(tx, clubId),
          sessions,
          assignments,
        );
        if (trims.length > 0) {
          const opened = await openUpload(deps, clubId, row, masterKey);
          if (!opened.ok) throw new Error(`a verified pod_raw no longer opens: ${opened.reason}`);
          bytes = opened.bytes;
          segment = opened.decoded.segments[0];
          base = segment === undefined ? undefined : timeBaseOf(opened.decoded, segment);
        }
      }
      const lowConfidence = row.issues.some((i) => LOW_CONFIDENCE.includes(i.code));
      const expiresAt = fileExpiresAt('pod_raw', now) ?? now;
      let samplesTotal = 0;
      let players = 0;
      let untimedPages = 0;
      for (const trim of trims) {
        if (segment === undefined || bytes === null) break;
        const pages = pagesInWindows(segment, base, trim.windows);
        untimedPages = Math.max(untimedPages, pages.untimed);
        const sliced = slicePodRawFile(bytes, pages.keep);
        const perSession = trim.sessions.map((s) => ({
          id: s.id,
          chunks: traceChunks(traceSamples(segment, base, s.windows)),
        }));
        if (sliced === null && perSession.every((s) => s.chunks.length === 0)) continue;
        players += 1;
        let rawFileId: string | null = null;
        if (sliced !== null) {
          rawFileId = randomUUID();
          const checksum = Buffer.from(sliced.sha256Hex, 'hex').toString('base64');
          await deps.storage.put({
            key: objectKey(clubId, rawFileId),
            body: sliced.bytes,
            contentType: 'application/octet-stream',
            checksumSha256: checksum,
          });
          written.push(objectKey(clubId, rawFileId));
          await tx.client.query(
            `insert into file (id, club_id, kind, status, player_id, content_type, size_bytes,
                               checksum_sha256, file_name, uploaded_at, expires_at)
             values ($1, $2, 'pod_raw', 'ready', $3, 'application/octet-stream', $4, $5, $6, $7, $8)`,
            [
              rawFileId,
              clubId,
              trim.playerId,
              sliced.bytes.length,
              checksum,
              `${row.ingest_key.replaceAll('/', '-')}-trimmed.sprw`,
              now,
              expiresAt,
            ],
          );
        }
        for (const session of perSession) {
          for (const [index, chunk] of session.chunks.entries()) {
            const first = chunk[0];
            const last = chunk.at(-1);
            if (first === undefined || last === undefined) continue;
            samplesTotal += chunk.length;
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
                trim.playerId,
                session.id,
                row.pod_id,
                row.id,
                rawFileId,
                index,
                POD_LOG_TRACE_ALGORITHM_VERSION,
                row.firmware_version,
                row.gnss_firmware_version,
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
                lowConfidence,
                expiresAt,
              ],
            );
          }
        }
      }
      const issues =
        untimedPages > 0
          ? mergeIssues(row.issues, [{ code: 'untimed_pages', count: untimedPages }])
          : row.issues;
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
        { clubId, podRawUploadId: row.id, players, samples: samplesTotal },
        'pod_raw trimmed',
      );
      return { outcome: 'trimmed', id: row.id };
    });
  } catch (error) {
    // Objects written for a transaction that did not commit are untracked: remove them.
    await Promise.allSettled(written.map((key) => deps.storage.remove(key)));
    throw error;
  }
}

// ─── 5. Retention of the traces ──────────────────────────────────────────────────────

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

// ─── The job ─────────────────────────────────────────────────────────────────────────

export async function runClubPodRawIngest(
  deps: PodRawIngestDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<PodRawIngestReport> {
  const requestId = options.jobId === undefined ? {} : { requestId: `job:${options.jobId}` };
  const now = deps.now?.() ?? new Date();
  const { expired, reprocessed, tracesDeleted } = await inClubTransaction(
    deps.pool,
    clubId,
    async (tx) => ({
      expired: await rejectExpiredUploads(tx, clubId, now),
      reprocessed: await processReprocessFlags(tx, clubId),
      tracesDeleted: await deleteExpiredTraces(tx, clubId, now),
    }),
    requestId,
  );
  const masterKey = await deps.keys.masterKey(clubId);
  let verified = 0;
  let rejected = 0;
  let trimmed = 0;
  let budget = POD_RAW_BATCH;
  const skipVerify: string[] = [];
  while (budget > 0) {
    const result = await verifyNext(deps, clubId, masterKey, skipVerify);
    if (result.outcome === 'none') break;
    if (result.id !== undefined) skipVerify.push(result.id);
    if (result.outcome === 'skipped') continue;
    budget -= 1;
    if (result.outcome === 'verified') verified += 1;
    else rejected += 1;
  }
  const skipTrim: string[] = [];
  while (budget > 0) {
    const result = await trimNext(deps, clubId, masterKey, skipTrim);
    if (result.outcome === 'none') break;
    if (result.id !== undefined) skipTrim.push(result.id);
    if (result.outcome === 'waiting') continue;
    budget -= 1;
    trimmed += 1;
  }
  const report = {
    expired,
    reprocessed,
    verified,
    rejected,
    trimmed,
    tracesDeleted,
    more: budget === 0 || tracesDeleted === POD_TRACE_RETENTION_BATCH,
  };
  deps.logger.info({ clubId, jobId: options.jobId, ...report }, 'pod_raw ingestion');
  return report;
}

/** The clubs with ingestion work (`app.worker_pod_raw_clubs()`). */
export async function listPodRawClubs(pool: pg.Pool): Promise<ClubId[]> {
  const { rows } = await pool.query<{ club_id: ClubId }>(
    'select c as club_id from app.worker_pod_raw_clubs() c',
  );
  return rows.map((r) => r.club_id);
}
