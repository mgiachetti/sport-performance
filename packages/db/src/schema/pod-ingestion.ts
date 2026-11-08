import {
  POD_METHOD_VARIANTS,
  POD_RAW_REJECTION_REASONS,
  POD_RAW_UPLOAD_STATES,
  POD_TRACE_CHUNK_MAX_SAMPLES,
  type PlayerId,
  type PodRawIssue,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from './columns.js';
import { file } from './files.js';
import { player } from './players.js';
import { pod, podDevice } from './pods.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';
import { trainingSession } from './training.js';

/**
 * Ingestion of the pod's NAND log (B-916, ADR 0106, ADR 0108). The RLS, the
 * guard of the manifest against the pod's device and the worker's grants are
 * written by hand in migration `0055_pod_raw_ingestion`.
 */

export const podRawUploadStateEnum = pgEnum('pod_raw_upload_state', POD_RAW_UPLOAD_STATES);
export const podRawRejectionReasonEnum = pgEnum(
  'pod_raw_rejection_reason',
  POD_RAW_REJECTION_REASONS,
);
export const podMethodVariantEnum = pgEnum('pod_method_variant', POD_METHOD_VARIANTS);

/**
 * One recording segment of a pod uploaded by the dock (`pod_raw`, ADR 0106):
 * the manifest as the dock declared it (checked against the pod's device by
 * `pod_raw_upload_guard`), the `file` that holds it while it is pending, and
 * what the worker found. Idempotent by (DEVICEID, boot, segment): one live
 * upload per segment; a rejected one leaves room to upload it again.
 *
 * `uploading` → (the API confirms the bytes) `pending` → (the worker decodes
 * it with the keys) `verified` (the erase command can be signed) or
 * `rejected` → (the sessions ended and the assignments closed, or the club's
 * pending days passed) `trimmed`: the original file is deleted and only the
 * per-player trimmed files and the traces remain. No history triggers (ADR
 * 0107): it is the pod's metadata, never a position.
 */
export const podRawUpload = pgTable(
  'pod_raw_upload',
  {
    ...tenantColumns(),
    podId: uuid('pod_id').notNull(),
    /** The global device of the pod (`pod_device`), fixed when the upload is created. */
    deviceId: uuid('device_id')
      .notNull()
      .references(() => podDevice.id, { onDelete: 'restrict' }),
    /** `podRawIngestKey` of the protocol: `<deviceid>/<boot>/<segment>`. */
    ingestKey: text('ingest_key').notNull(),
    /** FICR `DEVICEID` of the manifest (16 hex): the worker decodes with it. */
    chipId: text('chip_id').notNull(),
    podSerial: text('pod_serial').notNull(),
    bootCounter: bigint('boot_counter', { mode: 'number' }).notNull(),
    segmentId: bigint('segment_id', { mode: 'number' }).notNull(),
    firstPageSeq: bigint('first_page_seq', { mode: 'number' }).notNull(),
    lastPageSeq: bigint('last_page_seq', { mode: 'number' }).notNull(),
    pagesN: integer('pages_n').notNull(),
    validPagesN: integer('valid_pages_n').notNull(),
    blocks: integer('blocks').array().notNull(),
    keyEpochs: integer('key_epochs').array().notNull(),
    segmentClosed: boolean('segment_closed').notNull(),
    /** Time range of the pod's index (the dock's word; the worker uses the decoded time). */
    declaredStartAt: timestamptz('declared_start_at'),
    declaredEndAt: timestamptz('declared_end_at'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256Hex: text('sha256_hex').notNull(),
    /** The pending file (`pod_raw`, no player). Deleted once trimmed or rejected. */
    fileId: uuid('file_id').notNull(),
    state: podRawUploadStateEnum('state').notNull().default('uploading'),
    confirmedAt: timestamptz('confirmed_at'),
    /** Trimmed at the latest then: `confirmed_at` + the club's pending days. */
    pendingUntil: timestamptz('pending_until'),
    verifiedAt: timestamptz('verified_at'),
    /** Canonical bytes of the erase command (`encodeEraseCommand`, hex) the API signs. */
    eraseCommand: text('erase_command'),
    /** The recording's time from the decoded log (UTC); `NULL` without absolute time. */
    recordedFrom: timestamptz('recorded_from'),
    recordedTo: timestamptz('recorded_to'),
    firmwareVersion: text('firmware_version'),
    gnssFirmwareVersion: text('gnss_firmware_version'),
    /** What the worker reported (codes and counts, never a position). */
    issues: jsonb('issues').notNull().default([]).$type<readonly PodRawIssue[]>(),
    rejectionReason: podRawRejectionReasonEnum('rejection_reason'),
    rejectedAt: timestamptz('rejected_at'),
    trimmedAt: timestamptz('trimmed_at'),
    /** Players and 1 Hz samples the trim kept. */
    trimmedPlayersN: integer('trimmed_players_n'),
    trimmedSamplesN: integer('trimmed_samples_n'),
  },
  (t) => [
    ...tenantConstraints('pod_raw_upload', t),
    tenantReference('pod_raw_upload', t.clubId, t.podId, pod),
    tenantReference('pod_raw_upload', t.clubId, t.fileId, file),
    uniqueIndex('pod_raw_upload_file_key').on(t.clubId, t.fileId),
    uniqueIndex('pod_raw_upload_ingest_key')
      .on(t.clubId, t.ingestKey)
      .where(sql`${t.state} <> 'rejected'`),
    index('pod_raw_upload_pod_idx').on(t.clubId, t.podId, t.createdAt),
    index('pod_raw_upload_device_id_idx').on(t.deviceId),
    index('pod_raw_upload_open_idx')
      .on(t.clubId, t.state)
      .where(sql`${t.state} in ('pending', 'verified')`),
    check('pod_raw_upload_chip_id_format', sql`${t.chipId} ~ '^[0-9a-f]{16}$'`),
    check('pod_raw_upload_sha256_format', sql`${t.sha256Hex} ~ '^[0-9a-f]{64}$'`),
    check(
      'pod_raw_upload_ingest_key_format',
      sql`${t.ingestKey} = ${t.chipId} || '/' || ${t.bootCounter}::text || '/' || ${t.segmentId}::text`,
    ),
    check(
      'pod_raw_upload_manifest',
      sql`${t.bootCounter} between 0 and 4294967295 and ${t.segmentId} between 0 and 4294967295
          and ${t.firstPageSeq} between 0 and 4294967295 and ${t.lastPageSeq} between ${t.firstPageSeq} and 4294967295
          and ${t.pagesN} > 0 and ${t.validPagesN} between 0 and ${t.pagesN}
          and cardinality(${t.blocks}) between 1 and 65535 and cardinality(${t.keyEpochs}) >= 1
          and ${t.sizeBytes} > 0 and char_length(${t.podSerial}) between 1 and 64
          and (${t.declaredEndAt} is null or ${t.declaredStartAt} is null or ${t.declaredEndAt} >= ${t.declaredStartAt})`,
    ),
    check(
      'pod_raw_upload_lifecycle',
      sql`(${t.state} <> 'uploading' or ${t.confirmedAt} is null)
          and (${t.state} not in ('pending', 'verified', 'trimmed') or ${t.confirmedAt} is not null)
          and (${t.confirmedAt} is null) = (${t.pendingUntil} is null)
          and (${t.verifiedAt} is null) = (${t.eraseCommand} is null)
          and (${t.state} not in ('verified', 'trimmed') or ${t.verifiedAt} is not null)
          and (${t.state} = 'rejected') = (${t.rejectionReason} is not null)
          and (${t.rejectionReason} is null) = (${t.rejectedAt} is null)
          and (${t.state} = 'trimmed') = (${t.trimmedAt} is not null)
          and (${t.trimmedAt} is null) = (${t.trimmedSamplesN} is null)
          and (${t.trimmedAt} is null) = (${t.trimmedPlayersN} is null)
          and (${t.recordedTo} is null or ${t.recordedFrom} is null or ${t.recordedTo} >= ${t.recordedFrom})`,
    ),
    check(
      'pod_raw_upload_erase_command_format',
      sql`${t.eraseCommand} is null or ${t.eraseCommand} ~ '^([0-9a-f]{2})+$'`,
    ),
    check(
      'pod_raw_upload_versions_format',
      sql`(${t.firmwareVersion} is null or char_length(${t.firmwareVersion}) between 1 and 32)
          and (${t.gnssFirmwareVersion} is null or char_length(${t.gnssFirmwareVersion}) between 1 and 64)`,
    ),
  ],
);

/**
 * A player's position trace from the pod (B-916, ADR 0106): what the
 * one-time trim kept of a `pod_raw`, at 1 Hz, inside one session and a valid
 * assignment and with the `data` and `location` consents in force at each
 * instant. One row per contiguous stretch (at most an hour); the samples are
 * parallel arrays: milliseconds since `starts_at`, WGS84 in 1e-7 degrees,
 * ground speed (Doppler, mm/s, `NULL` = unknown), horizontal accuracy (mm,
 * `NULL` = unknown) and the fix quality as its index in the protocol's
 * `FIX_QUALITIES`.
 *
 * Method `pod` with its variant (`pod_log` for now), the version of the
 * server's algorithm and of the pod and GNSS firmware. RLS: the player their
 * own; the assigned coach and S&C and the administration with the player's
 * `location` granted; never the guardian, the medical staff nor support
 * access. Never in the change history (ADR 0107: it would keep a deleted
 * position); revoking `location` deletes the rows (`LOCATION_ERASURE_TABLES`).
 * Kept like its trimmed `pod_raw` (`expires_at`).
 */
export const podTraceSegment = pgTable(
  'pod_trace_segment',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    trainingSessionId: uuid('training_session_id').notNull(),
    podId: uuid('pod_id').notNull(),
    podRawUploadId: uuid('pod_raw_upload_id').notNull(),
    /** The trimmed `pod_raw` of this player the samples come from. */
    rawFileId: uuid('raw_file_id'),
    /** Order of the stretch within (upload, player, session). */
    chunkIndex: integer('chunk_index').notNull(),
    methodVariant: podMethodVariantEnum('method_variant').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    firmwareVersion: text('firmware_version'),
    gnssFirmwareVersion: text('gnss_firmware_version'),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    samplesN: integer('samples_n').notNull(),
    offsetsMs: integer('offsets_ms').array().notNull(),
    latE7: integer('lat_e7').array().notNull(),
    lonE7: integer('lon_e7').array().notNull(),
    speedMmS: integer('speed_mm_s').array().notNull(),
    hAccMm: integer('h_acc_mm').array().notNull(),
    fixQuality: smallint('fix_quality').array().notNull(),
    /** The boot's time base had few anchors or a step (`pod_raw_upload.issues`). */
    timeLowConfidence: boolean('time_low_confidence').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [
    ...tenantConstraints('pod_trace_segment', t),
    tenantReference('pod_trace_segment', t.clubId, t.playerId, player),
    tenantReference('pod_trace_segment', t.clubId, t.trainingSessionId, trainingSession),
    tenantReference('pod_trace_segment', t.clubId, t.podId, pod),
    tenantReference('pod_trace_segment', t.clubId, t.podRawUploadId, podRawUpload),
    tenantReference('pod_trace_segment', t.clubId, t.rawFileId, file),
    uniqueIndex('pod_trace_segment_chunk_key').on(
      t.clubId,
      t.podRawUploadId,
      t.playerId,
      t.trainingSessionId,
      t.chunkIndex,
    ),
    index('pod_trace_segment_player_idx').on(t.clubId, t.playerId, t.startsAt),
    index('pod_trace_segment_session_idx').on(t.clubId, t.trainingSessionId, t.playerId),
    index('pod_trace_segment_pod_id_idx').on(t.clubId, t.podId),
    index('pod_trace_segment_raw_file_id_idx')
      .on(t.clubId, t.rawFileId)
      .where(sql`${t.rawFileId} is not null`),
    index('pod_trace_segment_expires_idx').on(t.clubId, t.expiresAt),
    check('pod_trace_segment_range', sql`${t.endsAt} > ${t.startsAt} and ${t.chunkIndex} >= 0`),
    check(
      'pod_trace_segment_samples',
      sql`${t.samplesN} between 1 and ${sql.raw(String(POD_TRACE_CHUNK_MAX_SAMPLES))}
          and cardinality(${t.offsetsMs}) = ${t.samplesN} and cardinality(${t.latE7}) = ${t.samplesN}
          and cardinality(${t.lonE7}) = ${t.samplesN} and cardinality(${t.speedMmS}) = ${t.samplesN}
          and cardinality(${t.hAccMm}) = ${t.samplesN} and cardinality(${t.fixQuality}) = ${t.samplesN}`,
    ),
    check(
      'pod_trace_segment_versions_format',
      sql`char_length(${t.algorithmVersion}) between 1 and 64
          and (${t.firmwareVersion} is null or char_length(${t.firmwareVersion}) between 1 and 32)
          and (${t.gnssFirmwareVersion} is null or char_length(${t.gnssFirmwareVersion}) between 1 and 64)`,
    ),
  ],
);

/** A page of a trimmed `pod_raw` and the time of its records (UTC ms, both included). */
export interface PodRawTrimPage {
  readonly physicalPage: number;
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * What the one-time trim kept of a `pod_raw` for one player (B-916, ADR
 * 0108): their trimmed file, the windows that are their data (session ×
 * assignment × consent per instant) and the time of every page in the file,
 * so the metrics (B-919, B-906) clip the records at the edges and a
 * correction after the trim cuts the file again without the keys. A page
 * whose records overlap the windows of two players is in neither file. Read
 * like the traces (`position_trace.read`); erased with the `location`
 * consent; never in the change history.
 */
export const podRawTrim = pgTable(
  'pod_raw_trim',
  {
    ...tenantColumns(),
    podRawUploadId: uuid('pod_raw_upload_id').notNull(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** The trimmed file; `NULL` when no page was the player's alone (only the trace). */
    fileId: uuid('file_id'),
    /** `[{ startMs, endMs }]`, half-open, sorted, UTC ms. */
    windows: jsonb('windows').notNull().$type<readonly { startMs: number; endMs: number }[]>(),
    pages: jsonb('pages').notNull().$type<readonly PodRawTrimPage[]>(),
    /** Pages left out because they overlap another player's windows. */
    sharedPagesN: integer('shared_pages_n').notNull().default(0),
  },
  (t) => [
    ...tenantConstraints('pod_raw_trim', t),
    tenantReference('pod_raw_trim', t.clubId, t.podRawUploadId, podRawUpload),
    tenantReference('pod_raw_trim', t.clubId, t.playerId, player),
    tenantReference('pod_raw_trim', t.clubId, t.fileId, file),
    uniqueIndex('pod_raw_trim_player_key').on(t.clubId, t.podRawUploadId, t.playerId),
    index('pod_raw_trim_player_idx').on(t.clubId, t.playerId),
    index('pod_raw_trim_file_id_idx')
      .on(t.clubId, t.fileId)
      .where(sql`${t.fileId} is not null`),
    check(
      'pod_raw_trim_shape',
      sql`jsonb_typeof(${t.windows}) = 'array' and jsonb_typeof(${t.pages}) = 'array' and ${t.sharedPagesN} >= 0`,
    ),
  ],
);

/**
 * Every command the server signed for a pod (ADR 0106, 0108): which upload,
 * which key, the SHA-256 of the signed bytes, who asked (`created_by`) and
 * the request. Append-only: the application inserts, nobody changes or
 * deletes a row. Read by S&C, the administration and support, like the
 * uploads.
 */
export const podCommandAudit = pgTable(
  'pod_command_audit',
  {
    ...tenantColumns(),
    podRawUploadId: uuid('pod_raw_upload_id').notNull(),
    command: text('command').notNull(),
    keyId: text('key_id').notNull(),
    /** SHA-256 (hex) of the canonical bytes that were signed. */
    commandSha256: text('command_sha256').notNull(),
    requestId: text('request_id'),
  },
  (t) => [
    ...tenantConstraints('pod_command_audit', t),
    tenantReference('pod_command_audit', t.clubId, t.podRawUploadId, podRawUpload),
    index('pod_command_audit_upload_idx').on(t.clubId, t.podRawUploadId, t.createdAt),
    check('pod_command_audit_command', sql`${t.command} in ('erase')`),
    check('pod_command_audit_sha256_format', sql`${t.commandSha256} ~ '^[0-9a-f]{64}$'`),
    check('pod_command_audit_key_id_format', sql`${t.keyId} ~ '^[A-Za-z0-9._-]{1,64}$'`),
    check(
      'pod_command_audit_request_id_format',
      sql`${t.requestId} is null or ${t.requestId} ~ '^[A-Za-z0-9._:-]{1,128}$'`,
    ),
  ],
);
