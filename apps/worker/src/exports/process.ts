import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLUB_DATA_EXPORT_MAX_ATTEMPTS,
  CLUB_DATA_EXPORT_STALE_RUNNING_MINUTES,
  FILE_KIND_POLICIES,
  clubDataExportFileName,
  fileExpiresAt,
  fileObjectKey,
  localDateInTimeZone,
  parseLocalDate,
  parseTimeZone,
  pendingUploadExpiresAt,
  type ClubDataExportDataset,
  type ClubDataExportErrorCode,
  type ClubId,
  type LocalDate,
} from '@sport-performance/domain';
import type { ObjectStorage } from '@sport-performance/storage';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction } from '../database.js';
import { ExportTooLargeError, writeExportZip, type ExportSpec } from './generate.js';

export interface ExportDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly storage: ObjectStorage;
  readonly logger: Logger;
  readonly now?: () => Date;
  /** Directory of the temporary ZIPs; default the system's. */
  readonly tempDir?: string;
  /** Largest ZIP; default the `data_export` file policy (tests lower it). */
  readonly maxSizeBytes?: number;
}

export interface ExportReport {
  /** Exports written and ready. */
  readonly ready: number;
  /** Exports that failed for good (no more attempts, or too large). */
  readonly failed: number;
  /** Another export of the club is waiting: the caller enqueues the job again. */
  readonly more: boolean;
}

interface ClaimedRow {
  id: string;
  requested_by: string | null;
  requester_role: string;
  datasets: ClubDataExportDataset[];
  from_date: string | null;
  to_date: string | null;
  requested_on: string;
  player_ids: string[];
  excluded_players_n: number;
  availability: Record<string, unknown> | null;
  attempts: number;
  started_at: Date;
  /**
   * `started_at` as exact epoch seconds (microseconds kept, unlike a `Date`): what a
   * statement compares to know the export is still this run's.
   */
  started_epoch: string;
  requester_name: string | null;
  club_name: string;
  club_slug: string;
  time_zone: string;
}

/** Thrown when the bucket refused the ZIP: the export fails as `storage_unavailable` at the end. */
class StorageError extends Error {
  override readonly name = 'StorageError';
}

const PENDING = `(e.status = 'queued' or (e.status = 'running'
  and e.started_at < now() - interval '${String(CLUB_DATA_EXPORT_STALE_RUNNING_MINUTES)} minutes'))`;

/**
 * One run of the CSV export job for a club (B-608, ADR 0072): takes the
 * oldest pending export (queued, or running for longer than the stale
 * window: a worker that died), writes its ZIP from one snapshot, stores it
 * in the bucket as a `data_export` file and marks it ready.
 *
 * - **Claim** in its own transaction (`FOR UPDATE SKIP LOCKED`, attempt
 *   counted): two workers never write the same export, and a crash leaves it
 *   `running` until the stale window lets another run take it.
 * - **Read** in a `REPEATABLE READ READ ONLY` transaction: every CSV from the
 *   same snapshot, with a cursor in batches.
 * - **Store**: the `file` row is committed `pending` (24 h to be purged)
 *   before the `PUT`, so an object the bucket got is always tracked; then the
 *   row and the export become `ready` together.
 * - **Scope check at the end**: if a player of the export was erased while it
 *   was being written (`player_ids` shrank), the ZIP is discarded and the
 *   export queued again without them (the attempt is given back: it did
 *   not fail).
 * - **Failures**: an attempt that fails leaves the export queued while it has
 *   attempts left (the error is rethrown: pg-boss retries with backoff) and
 *   `failed` with a code after the last one or when it is too large.
 */
export async function runClubExports(
  deps: ExportDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<ExportReport> {
  const now = () => deps.now?.() ?? new Date();
  const requestId = options.jobId === undefined ? undefined : `job:${options.jobId}`;
  const tx = <T>(work: (client: pg.PoolClient) => Promise<T>) =>
    inClubTransaction(deps.pool, clubId, ({ client }) => work(client), { requestId });
  let failed = 0;

  // Exports out of attempts (a worker died on each one) fail before taking the next.
  failed += await tx(async (client) => {
    const result = await client.query(
      `update club_data_export e
          set status = 'failed', completed_at = now(), error_code = 'generation_failed',
              availability = null
        where e.club_id = $1 and ${PENDING} and e.attempts >= $2`,
      [clubId, CLUB_DATA_EXPORT_MAX_ATTEMPTS],
    );
    return result.rowCount ?? 0;
  });

  const claimed = await tx(async (client) => {
    const { rows } = await client.query<ClaimedRow>(
      `with next as (
         select e.id from club_data_export e
          where e.club_id = $1 and ${PENDING} and e.attempts < $2
          order by e.created_at, e.id limit 1
          for update skip locked
       )
       update club_data_export e
          set status = 'running', started_at = now(), attempts = e.attempts + 1
         from next, club c
        where e.club_id = $1 and e.id = next.id and c.id = e.club_id
       returning e.id, e.requested_by, e.requester_role::text as requester_role, e.datasets,
                 e.from_date::text as from_date, e.to_date::text as to_date,
                 e.requested_on::text as requested_on, e.player_ids::text[] as player_ids,
                 e.excluded_players_n, e.availability, e.attempts, e.started_at,
                 extract(epoch from e.started_at)::text as started_epoch,
                 (select u.name from "user" u where u.id = e.requested_by) as requester_name,
                 c.name as club_name, c.slug as club_slug, c.time_zone`,
      [clubId, CLUB_DATA_EXPORT_MAX_ATTEMPTS],
    );
    return rows[0];
  });
  if (claimed === undefined) return { ready: 0, failed, more: false };

  const log = deps.logger.child({ clubId, exportId: claimed.id, jobId: options.jobId });
  const policy = FILE_KIND_POLICIES.data_export;
  const timeZone = parseTimeZone(claimed.time_zone);
  const day = (value: string | null): LocalDate | null =>
    value === null ? null : parseLocalDate(value);
  const dir = await mkdtemp(join(deps.tempDir ?? tmpdir(), 'sp-export-'));
  const path = join(dir, 'export.zip');
  let fileId: string | null = null;
  try {
    const generatedAt = now();
    const spec: ExportSpec = {
      id: claimed.id,
      datasets: claimed.datasets,
      fromDate: day(claimed.from_date),
      toDate: day(claimed.to_date),
      requestedOn: parseLocalDate(claimed.requested_on),
      playerIds: claimed.player_ids,
      excludedPlayersN: claimed.excluded_players_n,
      availability: claimed.availability,
      requesterRole: claimed.requester_role,
      requesterName: claimed.requester_name,
      club: { id: clubId, name: claimed.club_name, timeZone },
      generatedAt,
    };
    const written = await inClubTransaction(
      deps.pool,
      clubId,
      async ({ client }) => {
        // The data consent is checked again in the snapshot the ZIP is read from: one revoked
        // since the request takes the player out (counted with those left out without it).
        const { rows } = await client.query<{ id: string }>(
          `select p.id::text as id from unnest($2::uuid[]) as p(id)
            where exists (select 1 from consent c
                           where c.club_id = $1 and c.player_id = p.id and c.type = 'data'
                             and c.revoked_at is null and c.signed_at <= now())
            order by p.id`,
          [clubId, claimed.player_ids],
        );
        const consenting = rows.map((row) => row.id);
        const withoutConsent = claimed.player_ids.length - consenting.length;
        return writeExportZip(
          client,
          withoutConsent === 0
            ? spec
            : {
                ...spec,
                playerIds: consenting,
                excludedPlayersN: spec.excludedPlayersN + withoutConsent,
              },
          path,
          deps.maxSizeBytes ?? policy.maxSizeBytes,
        );
      },
      { requestId, isolation: 'repeatable read read only' },
    );

    const fileName = clubDataExportFileName(
      claimed.club_slug,
      localDateInTimeZone(generatedAt, timeZone),
    );
    const newFileId = await tx(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into file (club_id, kind, status, content_type, size_bytes, checksum_sha256,
                           file_name, expires_at, created_by, updated_by)
         -- The requester owns it while still a member of the club (their account may be gone).
         select $1::uuid, 'data_export'::file_kind, 'pending'::file_status, $2::text, $3::bigint,
                $4::text, $5::text, $6::timestamptz, u.id, u.id
           from (select $7::text as id) r left join "user" u on u.id = r.id
         returning id`,
        [
          clubId,
          policy.contentTypes[0],
          written.sizeBytes,
          written.checksumSha256,
          fileName,
          pendingUploadExpiresAt(now()),
          claimed.requested_by,
        ],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error('file insert returned nothing');
      return id;
    });
    fileId = newFileId;
    try {
      await deps.storage.putObject({
        key: fileObjectKey({ clubId, kind: 'data_export', id: newFileId }),
        contentType: policy.contentTypes[0],
        sizeBytes: written.sizeBytes,
        checksumSha256: written.checksumSha256,
        body: () => createReadStream(path),
      });
    } catch (error) {
      throw new StorageError('The bucket refused the export', { cause: error });
    }

    const outcome = await tx(async (client) => {
      const { rows } = await client.query<{
        status: string;
        started_at: Date;
        player_ids: string[];
      }>(
        `select status::text as status, started_at, player_ids::text[] as player_ids
           from club_data_export where club_id = $1 and id = $2 for update`,
        [clubId, claimed.id],
      );
      const current = rows[0];
      const stillOurs =
        current?.status === 'running' &&
        current.started_at.getTime() === claimed.started_at.getTime();
      const scope = new Set(current?.player_ids ?? []);
      const scopeKept = claimed.player_ids.every((id) => scope.has(id));
      if (!stillOurs || !scopeKept) {
        // Another run took it, or a player left the scope (erased): this ZIP is not the export.
        await discardFile(client, clubId, newFileId);
        if (stillOurs) {
          // Not a failure: the attempt is given back, so erasures never exhaust the attempts.
          await client.query(
            `update club_data_export set status = 'queued', attempts = greatest(attempts - 1, 0)
              where club_id = $1 and id = $2`,
            [clubId, claimed.id],
          );
        }
        return stillOurs ? 'requeued' : 'superseded';
      }
      const readyAt = now();
      await client.query(
        `update file set status = 'ready', uploaded_at = $3, expires_at = $4
          where club_id = $1 and id = $2 and status = 'pending'`,
        [clubId, newFileId, readyAt, fileExpiresAt('data_export', readyAt)],
      );
      await client.query(
        `update club_data_export
            set status = 'ready', completed_at = $3, file_id = $4, row_counts = $5,
                availability = null
          where club_id = $1 and id = $2`,
        [clubId, claimed.id, readyAt, newFileId, JSON.stringify(written.rowCounts)],
      );
      return 'ready';
    });
    log.info(
      { outcome, sizeBytes: written.sizeBytes, rows: written.rowCounts },
      'club data export written',
    );
    return { ready: outcome === 'ready' ? 1 : 0, failed, more: await hasPending(tx, clubId) };
  } catch (error) {
    const code: ClubDataExportErrorCode =
      error instanceof ExportTooLargeError
        ? 'too_large'
        : error instanceof StorageError
          ? 'storage_unavailable'
          : 'generation_failed';
    const final = code === 'too_large' || claimed.attempts >= CLUB_DATA_EXPORT_MAX_ATTEMPTS;
    await tx(async (client) => {
      if (fileId !== null) await discardFile(client, clubId, fileId);
      // Only while the export is still this run's (like `stillOurs` above): a run that took it
      // over after the stale window is never failed or queued again by this one.
      if (final) {
        await client.query(
          `update club_data_export
              set status = 'failed', completed_at = now(), error_code = $3, availability = null
            where club_id = $1 and id = $2 and status = 'running'
              and extract(epoch from started_at) = $4::numeric`,
          [clubId, claimed.id, code, claimed.started_epoch],
        );
      } else {
        await client.query(
          `update club_data_export set status = 'queued'
            where club_id = $1 and id = $2 and status = 'running'
              and extract(epoch from started_at) = $3::numeric`,
          [clubId, claimed.id, claimed.started_epoch],
        );
      }
    });
    // Never the data: the error and the export's ids only.
    log.error({ err: error, code, attempt: claimed.attempts, final }, 'club data export failed');
    if (final && code === 'too_large') {
      return { ready: 0, failed: failed + 1, more: await hasPending(tx, clubId) };
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A ZIP that is not (or no longer) an export: unavailable now, purged by the retention job. */
async function discardFile(client: pg.PoolClient, clubId: ClubId, fileId: string): Promise<void> {
  // Written by the server: no upload URL was ever handed out, so it may go at once.
  await client.query(
    `update file set status = 'deleted', deleted_at = now(), expires_at = now()
      where club_id = $1 and id = $2 and status <> 'deleted'`,
    [clubId, fileId],
  );
}

async function hasPending(
  tx: <T>(work: (client: pg.PoolClient) => Promise<T>) => Promise<T>,
  clubId: ClubId,
): Promise<boolean> {
  return tx(async (client) => {
    const { rows } = await client.query<{ pending: boolean }>(
      `select exists (select 1 from club_data_export e where e.club_id = $1 and ${PENDING}) as pending`,
      [clubId],
    );
    return rows[0]?.pending ?? false;
  });
}

/** Clubs with an export to take, through `app.worker_data_export_clubs()` (ids only). */
export async function listExportClubs(pool: pg.Pool): Promise<ClubId[]> {
  const { rows } = await pool.query<{ club_id: ClubId }>(
    'select c as club_id from app.worker_data_export_clubs() c',
  );
  return rows.map((row) => row.club_id);
}
