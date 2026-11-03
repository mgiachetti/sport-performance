import { randomUUID } from 'node:crypto';
import {
  createClubDataExport,
  getClubDataExport,
  getClubDataExportDownload,
  listClubDataExports,
  type ClubDataExport,
} from '@sport-performance/contracts';
import { clubDataExport, file, player } from '@sport-performance/db/schema';
import type { ClubDataExportAvailability } from '@sport-performance/db/schema';
import {
  CLUB_DATA_EXPORT_FORMAT,
  CLUB_DATA_EXPORT_FORMAT_VERSION,
  FILE_KIND_POLICIES,
  decide,
  fileObjectKey,
  isAvailabilityStatus,
  normalizeClubDataExportDatasets,
  type ClubDataExportDataset,
  type ClubDataExportErrorCode,
  type ClubDataExportStatus,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type Role,
} from '@sport-performance/domain';
import { contentDisposition } from '@sport-performance/storage';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import type { FilesModule } from '../files/module.js';
import { loadPlayerFacts } from '../files/player-facts.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { clubToday } from '../http/permissions.js';
import { insertIdempotent, markReplay } from '../http/writes.js';

/**
 * CSV export of the club's data (B-608, ADR 0072). The API records the
 * request with its scope fixed by the permission matrix: the players the
 * requester may export (their scope, and a current `data` consent each, row
 * by row) and, when the roster is asked for, their availability on the day,
 * read with the requester's context through `medical.availability` (status
 * only, audited). The worker writes the ZIP; these handlers list it and sign
 * its download. RLS shows each requester their own exports and the
 * administration every one of the club.
 */

const columns = {
  id: clubDataExport.id,
  clientUuid: clubDataExport.clientUuid,
  status: clubDataExport.status,
  requestedBy: clubDataExport.requestedBy,
  requesterRole: clubDataExport.requesterRole,
  datasets: clubDataExport.datasets,
  fromDate: clubDataExport.fromDate,
  toDate: clubDataExport.toDate,
  requestedOn: clubDataExport.requestedOn,
  playerCount: sql<number>`cardinality(${clubDataExport.playerIds})`,
  excludedPlayersN: clubDataExport.excludedPlayersN,
  attempts: clubDataExport.attempts,
  rowCounts: clubDataExport.rowCounts,
  errorCode: clubDataExport.errorCode,
  createdAt: clubDataExport.createdAt,
  startedAt: clubDataExport.startedAt,
  completedAt: clubDataExport.completedAt,
  clubId: clubDataExport.clubId,
  fileId: file.id,
  fileStatus: file.status,
  fileName: file.fileName,
  fileSizeBytes: file.sizeBytes,
  fileExpiresAt: file.expiresAt,
};

interface ExportRow {
  id: string;
  clientUuid: string;
  status: ClubDataExportStatus;
  requestedBy: string | null;
  requesterRole: Role;
  datasets: ClubDataExportDataset[];
  fromDate: LocalDate | null;
  toDate: LocalDate | null;
  requestedOn: LocalDate;
  playerCount: number;
  excludedPlayersN: number;
  attempts: number;
  rowCounts: Readonly<Partial<Record<ClubDataExportDataset, number>>> | null;
  errorCode: ClubDataExportErrorCode | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  clubId: ClubId;
  fileId: string | null;
  fileStatus: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  fileExpiresAt: Date | null;
}

/** Whether the ZIP of a ready export can still be downloaded at `now`. */
function downloadable(row: ExportRow, now: Date): boolean {
  return (
    row.status === 'ready' &&
    row.fileStatus === 'ready' &&
    (row.fileExpiresAt === null || row.fileExpiresAt > now)
  );
}

function exportDto(row: ExportRow, now: Date): ClubDataExport {
  if (row.requesterRole !== 'sc' && row.requesterRole !== 'admin') {
    throw new Error(`club_data_export: unexpected requester role ${row.requesterRole}`);
  }
  const available = downloadable(row, now);
  return {
    id: row.id as ClubDataExport['id'],
    status: row.status === 'ready' && !available ? 'expired' : row.status,
    requestedBy: row.requestedBy as ClubDataExport['requestedBy'],
    requesterRole: row.requesterRole,
    datasets: row.datasets,
    from: row.fromDate,
    to: row.toDate,
    requestedOn: row.requestedOn,
    playerCount: row.playerCount,
    excludedPlayerCount: row.excludedPlayersN,
    attempts: row.attempts,
    rowCounts: row.rowCounts,
    errorCode: row.errorCode,
    file:
      available && row.fileId !== null && row.fileName !== null && row.fileSizeBytes !== null
        ? {
            id: row.fileId as NonNullable<ClubDataExport['file']>['id'],
            fileName: row.fileName,
            sizeBytes: row.fileSizeBytes,
            expiresAt: row.fileExpiresAt?.toISOString() ?? null,
          }
        : null,
    format: CLUB_DATA_EXPORT_FORMAT,
    formatVersion: CLUB_DATA_EXPORT_FORMAT_VERSION,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

const EXPORT_KEYS: KeysetSpec<ExportRow, 'createdAt'> = {
  fields: {
    createdAt: {
      column: clubDataExport.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: clubDataExport.id, value: (row) => row.id },
};

/** Exports of the club with their ZIP, as RLS lets the caller see them. */
function selectExports(db: TenantDatabase, clubId: ClubId, where: SQL | undefined) {
  return db
    .select(columns)
    .from(clubDataExport)
    .leftJoin(file, and(eq(file.clubId, clubDataExport.clubId), eq(file.id, clubDataExport.fileId)))
    .where(and(eq(clubDataExport.clubId, clubId), where));
}

async function requireExport(
  db: TenantDatabase,
  clubId: ClubId,
  exportId: string,
): Promise<ExportRow> {
  const [row] = (await selectExports(db, clubId, eq(clubDataExport.id, exportId))) as ExportRow[];
  if (row === undefined) throw new HttpError('not_found', 'Export not found');
  return row;
}

function requireStorage(files: FilesModule | undefined): FilesModule {
  if (files === undefined) {
    throw new HttpError('service_unavailable', 'File storage is not configured');
  }
  return files;
}

/** Availability of the players on the club day, read as the requester (audited, status only). */
async function availabilityOf(
  db: TenantDatabase,
  playerIds: readonly PlayerId[],
  today: LocalDate,
): Promise<ClubDataExportAvailability> {
  const snapshot: Record<string, { training: string; match: string }> = {};
  if (playerIds.length === 0) return snapshot;
  const { rows } = await db.execute<{ player_id: string; training: string; match: string }>(
    sql`select a.player_id, a.training::text as training, a."match"::text as "match"
          from medical.availability(${sql.param([...playerIds])}::uuid[], ${today}::date) a`,
  );
  for (const row of rows) {
    if (!isAvailabilityStatus(row.training) || !isAvailabilityStatus(row.match)) {
      throw new Error('medical.availability returned an unknown status');
    }
    snapshot[row.player_id] = { training: row.training, match: row.match };
  }
  return snapshot;
}

function sameDatasets(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function registerClubDataExportRoutes(
  app: FastifyInstance,
  files: FilesModule | undefined,
): void {
  registerEndpoint(app, createClubDataExport, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const module = requireStorage(files);
      const { clubId } = caller.membership;
      // Denied roles answer 403; a scoped role without assignments has nothing to export.
      const scope = await permissions.listScope('club_data_export', 'run');
      if (scope.kind === 'none') throw new HttpError('forbidden', 'Nothing in scope to export');
      const subject = await permissions.subject();
      const requesterRole = subject.role;
      if (requesterRole !== 'sc' && requesterRole !== 'admin') {
        // The matrix lets only these roles run an export.
        throw new Error(`club data export: the matrix let ${requesterRole} run it`);
      }
      const datasets = normalizeClubDataExportDatasets(body.datasets);
      const fromDate = body.from ?? null;
      const toDate = body.to ?? null;

      const replayOf = async (clientUuid: string) =>
        (
          (await selectExports(
            db,
            clubId,
            eq(clubDataExport.clientUuid, clientUuid),
          )) as ExportRow[]
        )[0];
      if (body.clientUuid !== undefined) {
        // A retry answers with the export it created, without fixing the scope again.
        const previous = await replayOf(body.clientUuid);
        if (previous !== undefined) {
          const answer = replay(previous);
          markReplay(reply);
          return answer;
        }
      }

      // The players the requester may export: what RLS shows them, then the matrix row by
      // row (scope and a current data consent). Who is left out without consent is counted.
      const visible = await db
        .select({ id: player.id })
        .from(player)
        .where(eq(player.clubId, clubId));
      const facts = await loadPlayerFacts(
        db,
        clubId,
        visible.map((row) => row.id),
      );
      const included: PlayerId[] = [];
      let excluded = 0;
      for (const row of visible) {
        const playerFacts = facts.get(row.id);
        if (playerFacts === undefined) continue;
        const decision = decide(subject, 'run', {
          kind: 'club_data_export',
          clubId,
          player: playerFacts,
        });
        if (decision.allowed) included.push(row.id);
        else if (decision.reason === 'missing_consent') excluded += 1;
      }
      included.sort();
      const today = await clubToday(db);
      const availability = datasets.includes('players')
        ? await availabilityOf(db, included, today)
        : null;

      const { row, replayed } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () => {
          const [inserted] = await db
            .insert(clubDataExport)
            .values({
              id: randomUUID(),
              clubId,
              ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
              requestedBy: caller.userId,
              requesterRole,
              status: 'queued',
              datasets,
              fromDate,
              toDate,
              requestedOn: today,
              playerIds: included,
              excludedPlayersN: excluded,
              availability,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            })
            .onConflictDoNothing({ target: [clubDataExport.clubId, clubDataExport.clientUuid] })
            .returning({ id: clubDataExport.id });
          return inserted === undefined ? undefined : requireExport(db, clubId, inserted.id);
        },
        findByClientUuid: replayOf,
      });
      return replayed ? replay(row) : exportDto(row, module.now());

      function replay(previous: ExportRow): ClubDataExport {
        // The same request again: same requester, datasets and range. Anything else is
        // another export with a reused clientUuid.
        if (
          previous.requestedBy !== caller.userId ||
          !sameDatasets(previous.datasets, datasets) ||
          previous.fromDate !== fromDate ||
          previous.toDate !== toDate
        ) {
          throw new HttpError('conflict', 'This clientUuid was already used for another export');
        }
        return exportDto(previous, module.now());
      }
    },
  });

  registerEndpoint(app, listClubDataExports, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await permissions.listScope('club_data_export', 'read');
      const plan = keysetPage(EXPORT_KEYS, query, {});
      const rows = (await selectExports(db, clubId, plan.where)
        .orderBy(...plan.orderBy)
        .limit(plan.limit)) as ExportRow[];
      const now = files?.now() ?? new Date();
      return plan.page(rows, (row) => exportDto(row, now));
    },
  });

  registerEndpoint(app, getClubDataExport, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await permissions.listScope('club_data_export', 'read');
      const row = await requireExport(db, clubId, params.exportId);
      return exportDto(row, files?.now() ?? new Date());
    },
  });

  registerEndpoint(app, getClubDataExportDownload, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const module = requireStorage(files);
      const { clubId } = caller.membership;
      await permissions.listScope('club_data_export', 'read');
      const row = await requireExport(db, clubId, params.exportId);
      if (!downloadable(row, module.now()) || row.fileId === null) {
        throw new HttpError('conflict', 'The export is not available');
      }
      const signed = await module.storage.presignDownload({
        key: fileObjectKey({ clubId, kind: 'data_export', id: row.fileId }),
        expiresInS: module.downloadUrlTtlS,
        contentType: FILE_KIND_POLICIES.data_export.contentTypes[0],
        contentDisposition: contentDisposition(
          FILE_KIND_POLICIES.data_export.disposition,
          row.fileName,
        ),
      });
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    },
  });
}
