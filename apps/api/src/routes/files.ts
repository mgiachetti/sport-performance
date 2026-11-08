import { randomUUID } from 'node:crypto';
import {
  confirmFileUpload,
  createFileUpload,
  deleteFile,
  getFile,
  getFileDownload,
  listFiles,
  type FileUpload,
  type UploadedFile,
} from '@sport-performance/contracts';
import {
  category,
  club,
  file,
  playerCategory,
  testResult,
  testResultValue,
} from '@sport-performance/db/schema';
import {
  FILE_KIND_POLICIES,
  can,
  deletedFileExpiresAt,
  fileExpiresAt,
  fileObjectKey,
  pendingUploadExpiresAt,
  sanitizeFileName,
  type CategoryFacts,
  type CategoryId,
  type ClubId,
  type FileKind,
  type FileStatus,
  type ListScope,
  type PermissionResource,
  type PlayerFacts,
  type PlayerId,
  type ResourceKind,
} from '@sport-performance/domain';
import { contentDisposition } from '@sport-performance/storage';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import type { FilesModule } from '../files/module.js';
import { loadCategoryFacts, loadPlayerFacts } from '../files/player-facts.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import { insertIdempotent } from '../http/writes.js';
import { protocolMediaInUse } from './test-definitions.js';

/**
 * Uploaded files (B-325, ADR 0044). The API signs, checks and records; the
 * bytes go from the client to the bucket and back with signed URLs. Every
 * handler authorizes with the permission matrix (ADR 0032) through the
 * resource kind that protects each file kind:
 *
 * | File kind     | upload           | read                 | delete                |
 * |---------------|------------------|----------------------|-----------------------|
 * | `club_logo`   | `club.update`    | `club.read`          | `club.update`         |
 * | `cmj_video`   | `media.upload`   | `media.read`         | `media.delete`        |
 * | `pdf_report`  | (the worker)     | `player_report.read` | `player_profile.archive` |
 * | `data_import` | `data_import.run`| `data_import.run`    | `data_import.run`     |
 * | `protocol_media` | `configuration.update` | `configuration.read` | `configuration.update` |
 * | `data_export` | (the worker)     | `club_data_export.read` | `club_data_export.read` |
 * | `category_report` | (the worker) | `category_report.read` | `category.manage`     |
 *
 * `media` needs a current image consent of the player to upload or show a
 * video: the matrix checks it with the player's facts.
 */

type FileAction = 'upload' | 'read' | 'delete';

interface FilePermission {
  readonly kind: ResourceKind;
  readonly action: string;
}

const FILE_PERMISSIONS: Record<FileKind, Record<FileAction, FilePermission | null>> = {
  club_logo: {
    upload: { kind: 'club', action: 'update' },
    read: { kind: 'club', action: 'read' },
    delete: { kind: 'club', action: 'update' },
  },
  cmj_video: {
    upload: { kind: 'media', action: 'upload' },
    read: { kind: 'media', action: 'read' },
    delete: { kind: 'media', action: 'delete' },
  },
  pdf_report: {
    // Written by the worker (B-602), never uploaded by a person.
    upload: null,
    read: { kind: 'player_report', action: 'read' },
    delete: { kind: 'player_profile', action: 'archive' },
  },
  data_import: {
    upload: { kind: 'data_import', action: 'run' },
    read: { kind: 'data_import', action: 'run' },
    delete: { kind: 'data_import', action: 'run' },
  },
  // How a test is done (B-415): club configuration, staff only (it may show a person).
  protocol_media: {
    upload: { kind: 'configuration', action: 'update' },
    read: { kind: 'configuration', action: 'read' },
    delete: { kind: 'configuration', action: 'update' },
  },
  data_export: {
    // Written by the worker for whoever asked (B-608, ADR 0072); RLS shows each ZIP to who
    // reads its export. Here only the administration reaches it (the club scope); the
    // requester downloads it through `GET /v1/data-exports/{id}/download`.
    upload: null,
    read: { kind: 'club_data_export', action: 'read' },
    // Intended: whoever may read the ZIP may also delete it early. It is a copy of data
    // that already lives in the platform, so deleting it only takes the copy out of the
    // bucket before its 7 days; nothing is lost, and asking again writes it anew.
    delete: { kind: 'club_data_export', action: 'read' },
  },
  category_report: {
    // Written by the worker for the staff of the category (B-603, ADR 0073); deleting it
    // early is the administration's, like a player's report.
    upload: null,
    read: { kind: 'category_report', action: 'read' },
    delete: { kind: 'category', action: 'manage' },
  },
  pod_raw: {
    // The pod's log (B-916, ADR 0106): the dock uploads it through `/v1/pods/{podId}/raw-uploads`
    // with its manifest, the worker reads, trims and deletes it. Nobody downloads, lists or
    // deletes one here: its life is the ingestion's.
    upload: null,
    read: null,
    delete: null,
  },
};

const fileColumns = {
  id: file.id,
  clubId: file.clubId,
  kind: file.kind,
  status: file.status,
  playerId: file.playerId,
  categoryId: file.categoryId,
  contentType: file.contentType,
  sizeBytes: file.sizeBytes,
  checksumSha256: file.checksumSha256,
  fileName: file.fileName,
  testResultId: file.testResultId,
  testEntryId: file.testEntryId,
  uploadedAt: file.uploadedAt,
  expiresAt: file.expiresAt,
  deletedAt: file.deletedAt,
  createdBy: file.createdBy,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
};

interface FileRow {
  id: string;
  clubId: ClubId;
  kind: FileKind;
  status: FileStatus;
  playerId: PlayerId | null;
  categoryId: CategoryId | null;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  fileName: string | null;
  testResultId: string | null;
  testEntryId: string | null;
  uploadedAt: Date | null;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function fileDto(row: FileRow): UploadedFile {
  return {
    id: row.id as UploadedFile['id'],
    kind: row.kind,
    status: row.status,
    playerId: row.playerId,
    categoryId: row.categoryId,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    fileName: row.fileName,
    testResultId: row.testResultId as UploadedFile['testResultId'],
    testEntryId: row.testEntryId as UploadedFile['testEntryId'],
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdBy: (row.createdBy ?? null) as UploadedFile['createdBy'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const FILE_KEYS: KeysetSpec<FileRow, 'createdAt' | 'sizeBytes'> = {
  fields: {
    createdAt: { column: file.createdAt, type: 'timestamp', value: (row) => row.createdAt },
    sizeBytes: { column: file.sizeBytes, type: 'integer', value: (row) => row.sizeBytes },
  },
  id: { column: file.id, value: (row) => row.id },
};

function objectKeyOf(row: Pick<FileRow, 'clubId' | 'kind' | 'id'>): string {
  return fileObjectKey({ clubId: row.clubId, kind: row.kind, id: row.id });
}

function requireStorage(files: FilesModule | undefined): FilesModule {
  if (files === undefined) {
    throw new HttpError('service_unavailable', 'File storage is not configured');
  }
  return files;
}

/**
 * A file row of the request's club, as RLS lets the caller see it; `404`
 * otherwise. `forUpdate` locks the row until the transaction ends: whoever
 * changes what a file is used for (delete, set as crest) takes the lock.
 */
async function readFile(
  db: TenantDatabase,
  clubId: ClubId,
  fileId: string,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<FileRow> {
  const query = db
    .select(fileColumns)
    .from(file)
    .where(and(eq(file.clubId, clubId), eq(file.id, fileId)));
  const [row] = forUpdate ? await query.for('update') : await query;
  if (row === undefined) throw new HttpError('not_found', 'File not found');
  return row;
}

/**
 * Whether the caller manages the files of a club-wide kind (the crest): who
 * reads it (every member) sees only `ready` ones; pending uploads and deleted
 * crests are for who uploads and deletes them.
 */
async function managesClubFiles(
  permissions: RequestPermissions,
  clubId: ClubId,
  kind: FileKind,
): Promise<boolean> {
  if (FILE_KIND_POLICIES[kind].subject !== 'club') return true;
  const permission = FILE_PERMISSIONS[kind].delete;
  if (permission === null) return false;
  return can(await permissions.subject(), permission.action as never, {
    kind: permission.kind,
    clubId,
  });
}

/** What the matrix is asked about a file: its player, or its category. */
async function resourceOf(
  db: TenantDatabase,
  clubId: ClubId,
  target: { playerId: PlayerId | null; categoryId: CategoryId | null },
): Promise<Omit<PermissionResource, 'kind'>> {
  if (target.playerId !== null) {
    const facts = (await loadPlayerFacts(db, clubId, [target.playerId])).get(target.playerId);
    if (facts === undefined) throw new HttpError('not_found', 'Player not found');
    return { player: facts };
  }
  if (target.categoryId !== null) {
    return { category: await loadCategoryFacts(db, clubId, target.categoryId) };
  }
  return {};
}

/** Authorizes one action on a file of a kind (see the table above); `403` when denied. */
async function authorizeFile(
  permissions: RequestPermissions,
  kind: FileKind,
  action: FileAction,
  resource: Omit<PermissionResource, 'kind'>,
): Promise<void> {
  const permission = FILE_PERMISSIONS[kind][action];
  if (permission === null) throw new HttpError('forbidden', 'Not allowed for this kind of file');
  // The table is typed by file kind; the matrix by resource kind: each pair is a cell of it.
  await permissions.authorize(permission.kind, permission.action as never, resource);
}

/** The upload request of a pending file, valid until its upload window closes. */
async function uploadOf(files: FilesModule, row: FileRow): Promise<FileUpload | null> {
  const now = files.now();
  if (row.status !== 'pending' || row.expiresAt === null || row.expiresAt <= now) return null;
  const remainingS = Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000);
  if (remainingS < 1) return null;
  const signed = await files.storage.presignUpload({
    key: objectKeyOf(row),
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    expiresInS: Math.min(files.uploadUrlTtlS, remainingS),
  });
  return {
    method: signed.method,
    url: signed.url,
    headers: { ...signed.headers },
    expiresAt: signed.expiresAt.toISOString(),
  };
}

/**
 * SQL filter of a list scope over the files of one kind: players of the
 * caller's assignments (by current category or sport), their own players,
 * or the categories of an import.
 */
function scopeFilter(kind: FileKind, scope: Exclude<ListScope, { kind: 'none' }>): SQL | undefined {
  switch (scope.kind) {
    case 'platform':
    case 'club':
      return undefined;
    case 'players':
      return scope.playerIds.length === 0
        ? sql`false`
        : inArray(file.playerId, [...scope.playerIds]);
    case 'assigned': {
      const categoryIds = [...scope.categoryIds];
      const sports = [...scope.sports];
      const byTarget = or(
        categoryIds.length > 0 ? inArray(category.id, categoryIds) : undefined,
        sports.length > 0 ? inArray(category.sport, sports) : undefined,
      );
      if (byTarget === undefined) return sql`false`;
      if (FILE_KIND_POLICIES[kind].subject === 'player') {
        return inArray(
          file.playerId,
          sql`(select ${playerCategory.playerId} from ${playerCategory}
                 join ${category} on ${category.clubId} = ${playerCategory.clubId}
                  and ${category.id} = ${playerCategory.categoryId}
                where ${playerCategory.clubId} = ${scope.clubId}
                  and ${playerCategory.validFrom} <= app.club_today()
                  and (${playerCategory.validTo} is null or ${playerCategory.validTo} > app.club_today())
                  and ${byTarget})`,
        );
      }
      // An import of the whole club (no category) has no target in an assignment.
      return and(
        isNotNull(file.categoryId),
        inArray(
          file.categoryId,
          sql`(select ${category.id} from ${category}
                where ${category.clubId} = ${scope.clubId} and ${byTarget})`,
        ),
      );
    }
  }
}

/** A validation error of one field of the body (`validation_failed`). */
function invalidField(field: string, message: string): HttpError {
  return new HttpError('validation_failed', message, {
    details: [{ path: ['body', field], code: 'custom', message }],
  });
}

/**
 * Checks the CMJ attempt a video is uploaded for (B-604, ADR 0085): a
 * result the caller sees (`404` otherwise), of the video's player, with a
 * valid `cmj_video_frames` entry of that id. The database checks the same
 * but the voided state (`file_test_entry_check`).
 */
async function checkVideoAttempt(
  db: TenantDatabase,
  clubId: ClubId,
  attempt: { playerId: PlayerId; testResultId: string; testEntryId: string },
): Promise<void> {
  const [result] = await db
    .select({ playerId: testResult.playerId })
    .from(testResult)
    .where(and(eq(testResult.clubId, clubId), eq(testResult.id, attempt.testResultId)));
  if (result === undefined) throw new HttpError('not_found', 'Test result not found');
  if (result.playerId !== attempt.playerId) {
    throw invalidField('testResultId', 'The result is of another player');
  }
  const values = await db
    .select({ inputs: testResultValue.inputs, voidedAt: testResultValue.voidedAt })
    .from(testResultValue)
    .where(
      and(
        eq(testResultValue.clubId, clubId),
        eq(testResultValue.testResultId, attempt.testResultId),
        eq(testResultValue.entryId, attempt.testEntryId),
      ),
    );
  if (values.length === 0) throw invalidField('testEntryId', 'The result has no such attempt');
  if (values.some((value) => value.inputs?.kind !== 'cmj_video_frames')) {
    throw invalidField('testEntryId', 'The attempt was not marked on a video (cmj_video_frames)');
  }
  if (values.some((value) => value.voidedAt !== null)) {
    throw invalidField('testEntryId', 'The attempt was voided');
  }
}

export function registerFileRoutes(app: FastifyInstance, files: FilesModule | undefined): void {
  registerEndpoint(app, createFileUpload, {
    transaction: true,
    // The tightest class: it hands out upload URLs (ADR 0031).
    rateLimit: 'upload',
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const module = requireStorage(files);
      const { clubId } = caller.membership;
      const playerId = body.kind === 'cmj_video' ? body.playerId : null;
      const categoryId = body.kind === 'data_import' ? (body.categoryId ?? null) : null;
      const resource = await resourceOf(db, clubId, { playerId, categoryId });
      await authorizeFile(permissions, body.kind, 'upload', resource);
      let fileName: string | null = null;
      if (body.fileName !== undefined) {
        try {
          fileName = sanitizeFileName(body.fileName);
        } catch {
          throw new HttpError('validation_failed', 'Invalid file name', {
            details: [
              {
                path: ['body', 'fileName'],
                code: 'invalid_string',
                message: 'Empty once sanitized',
              },
            ],
          });
        }
      }
      const attempt =
        body.kind === 'cmj_video' &&
        body.testResultId !== undefined &&
        body.testEntryId !== undefined
          ? { testResultId: body.testResultId, testEntryId: body.testEntryId }
          : null;
      if (attempt !== null && playerId !== null) {
        // A resend of an upload already recorded is checked against that row below (the
        // attempt may have been voided since): only a new upload checks the attempt.
        const [known] =
          body.clientUuid === undefined
            ? []
            : await db
                .select({ testResultId: file.testResultId, testEntryId: file.testEntryId })
                .from(file)
                .where(and(eq(file.clubId, clubId), eq(file.clientUuid, body.clientUuid)));
        // The same clientUuid for another attempt is another upload (never re-checked as new).
        if (
          known !== undefined &&
          (known.testResultId !== attempt.testResultId || known.testEntryId !== attempt.testEntryId)
        ) {
          throw new HttpError('conflict', 'This clientUuid was already used for another file');
        }
        if (known === undefined) await checkVideoAttempt(db, clubId, { playerId, ...attempt });
      }
      const { row, replayed } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(file)
              .values({
                id: randomUUID(),
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                kind: body.kind,
                playerId,
                categoryId,
                testResultId: attempt?.testResultId ?? null,
                testEntryId: attempt?.testEntryId ?? null,
                contentType: body.contentType,
                sizeBytes: body.sizeBytes,
                checksumSha256: body.checksumSha256,
                fileName,
                expiresAt: pendingUploadExpiresAt(module.now()),
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [file.clubId, file.clientUuid] })
              .returning(fileColumns)
          )[0] as FileRow | undefined,
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(fileColumns)
              .from(file)
              .where(and(eq(file.clubId, clubId), eq(file.clientUuid, clientUuid)))
          )[0] as FileRow | undefined,
      });
      // A replay answers only for the same caller and the same declared file: the
      // authorization above ran on this body, so a row that differs from it (another
      // kind, player, category, content or name, or someone else's) is not handed out.
      if (
        replayed &&
        (row.createdBy !== caller.userId ||
          row.kind !== body.kind ||
          row.playerId !== playerId ||
          row.categoryId !== categoryId ||
          row.testResultId !== (attempt?.testResultId ?? null) ||
          row.testEntryId !== (attempt?.testEntryId ?? null) ||
          row.contentType !== body.contentType ||
          row.sizeBytes !== body.sizeBytes ||
          row.checksumSha256 !== body.checksumSha256 ||
          row.fileName !== fileName)
      ) {
        throw new HttpError('conflict', 'This clientUuid was already used for another file');
      }
      return { file: fileDto(row), upload: await uploadOf(module, row) };
    },
  });

  registerEndpoint(app, confirmFileUpload, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller, log }) => {
      const module = requireStorage(files);
      const { clubId } = caller.membership;
      const row = await readFile(db, clubId, params.fileId);
      await authorizeFile(permissions, row.kind, 'upload', await resourceOf(db, clubId, row));
      if (row.status === 'ready') return fileDto(row);
      if (row.status === 'deleted') throw new HttpError('conflict', 'The file was deleted');
      const now = module.now();
      if (row.expiresAt === null || row.expiresAt <= now) {
        throw new HttpError('conflict', 'The upload window closed: ask for a new upload');
      }
      const key = objectKeyOf(row);
      const stored = await module.storage.stat(key);
      if (stored === null)
        throw new HttpError('conflict', 'Nothing was uploaded for this file yet');
      // Fail closed: a provider that does not return the content type or the
      // SHA-256 (ChecksumMode ENABLED) cannot prove the object is the declared file.
      const matches =
        stored.sizeBytes === row.sizeBytes &&
        stored.contentType === row.contentType &&
        stored.checksumSha256 === row.checksumSha256;
      if (stored.checksumSha256 === null || stored.contentType === null) {
        // A provider or configuration problem, not the client's: make it visible.
        log.warn(
          {
            fileId: row.id,
            checksum: stored.checksumSha256 !== null,
            contentType: stored.contentType !== null,
          },
          'storage did not return the checksum or content type of an upload: refused',
        );
      }
      if (!matches) {
        // The signature makes this unlikely; whatever is there is not the declared file.
        await module.storage.remove(key);
        throw new HttpError('conflict', 'The uploaded content does not match the declared file');
      }
      const [updated] = await db
        .update(file)
        .set({
          status: 'ready',
          uploadedAt: now,
          expiresAt: fileExpiresAt(row.kind, now),
          updatedBy: caller.userId,
        })
        .where(and(eq(file.clubId, clubId), eq(file.id, row.id), eq(file.status, 'pending')))
        .returning(fileColumns);
      // A concurrent confirm won the race: answer with what it left.
      return fileDto((updated as FileRow | undefined) ?? (await readFile(db, clubId, row.id)));
    },
  });

  registerEndpoint(app, listFiles, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const permission = FILE_PERMISSIONS[query.kind].read;
      if (permission === null) throw new HttpError('forbidden', 'Not readable');
      const scope = await permissions.listScope(permission.kind, permission.action as never);
      const plan = keysetPage(FILE_KEYS, query, {
        kind: query.kind,
        playerId: query.playerId,
        categoryId: query.categoryId,
        status: query.status,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      // Every member reads the crest, but only who manages it sees pending and deleted ones.
      const onlyReady = !(await managesClubFiles(permissions, clubId, query.kind));
      const rows = (await db
        .select(fileColumns)
        .from(file)
        .where(
          and(
            eq(file.clubId, clubId),
            eq(file.kind, query.kind),
            query.playerId === undefined ? undefined : eq(file.playerId, query.playerId),
            query.categoryId === undefined ? undefined : eq(file.categoryId, query.categoryId),
            query.status === 'all' ? undefined : eq(file.status, query.status),
            onlyReady ? eq(file.status, 'ready') : undefined,
            scopeFilter(query.kind, scope),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit)) as FileRow[];
      const page = plan.page(rows, (row) => row);
      if (!scope.rowCheck) return { items: page.items.map(fileDto), nextCursor: page.nextCursor };
      // Consents and guardian confirmations are checked row by row (the cursor still moves on).
      const subject = await permissions.subject();
      const facts = await loadPlayerFacts(
        db,
        clubId,
        page.items.flatMap((row) => (row.playerId === null ? [] : [row.playerId])),
      );
      const categories = new Map<string, CategoryFacts>();
      for (const row of page.items) {
        if (row.categoryId !== null && !categories.has(row.categoryId)) {
          categories.set(row.categoryId, await loadCategoryFacts(db, clubId, row.categoryId));
        }
      }
      const allowed = page.items.filter((row) => {
        const player = row.playerId === null ? undefined : facts.get(row.playerId);
        if (row.playerId !== null && player === undefined) return false;
        const target = row.categoryId === null ? undefined : categories.get(row.categoryId);
        return can(subject, permission.action as never, {
          kind: permission.kind,
          clubId,
          ...(player !== undefined && { player: player satisfies PlayerFacts }),
          ...(target !== undefined && { category: target }),
        });
      });
      return { items: allowed.map(fileDto), nextCursor: page.nextCursor };
    },
  });

  registerEndpoint(app, getFile, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readFile(db, clubId, params.fileId);
      await authorizeFile(permissions, row.kind, 'read', await resourceOf(db, clubId, row));
      if (row.status !== 'ready' && !(await managesClubFiles(permissions, clubId, row.kind))) {
        throw new HttpError('not_found', 'File not found');
      }
      return fileDto(row);
    },
  });

  registerEndpoint(app, getFileDownload, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const module = requireStorage(files);
      const { clubId } = caller.membership;
      const row = await readFile(db, clubId, params.fileId);
      await authorizeFile(permissions, row.kind, 'read', await resourceOf(db, clubId, row));
      const now = module.now();
      if (row.status !== 'ready' || (row.expiresAt !== null && row.expiresAt <= now)) {
        throw new HttpError('conflict', 'The file is not available');
      }
      const signed = await module.storage.presignDownload({
        key: objectKeyOf(row),
        expiresInS: module.downloadUrlTtlS,
        contentType: row.contentType,
        contentDisposition: contentDisposition(
          FILE_KIND_POLICIES[row.kind].disposition,
          row.fileName,
        ),
      });
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    },
  });

  registerEndpoint(app, deleteFile, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const seen = await readFile(db, clubId, params.fileId);
      await authorizeFile(permissions, seen.kind, 'delete', await resourceOf(db, clubId, seen));
      // Locked once authorized (RLS hides from `FOR UPDATE` what the caller cannot write).
      // `PATCH /v1/club` takes the same lock before setting a crest, so a crest is never set
      // and deleted at once: one of the two waits and sees what the other left. The
      // retention job skips a locked row and re-reads it next run.
      const row = await readFile(db, clubId, seen.id, { forUpdate: true });
      // Already deleted (or purged by the job): nothing to change, never a purged row.
      if (row.status === 'deleted') return fileDto(row);
      if (row.kind === 'club_logo') {
        const [inUse] = await db
          .select({ id: club.id })
          .from(club)
          .where(and(eq(club.id, clubId), eq(club.logoFileId, row.id)));
        if (inUse !== undefined) {
          throw new HttpError('conflict', 'The file is the crest of the club: change it first');
        }
      }
      // The attach, archive and restore of protocol media take the same row lock.
      if (row.kind === 'protocol_media' && (await protocolMediaInUse(db, clubId, row.id))) {
        throw new HttpError('conflict', 'The file is shown in a protocol: remove it there first');
      }
      const now = files?.now() ?? new Date();
      // Unavailable from now on. The retention job removes the object once no upload URL
      // handed out for it can land a late PUT (it would come back untracked).
      const [updated] = await db
        .update(file)
        .set({
          status: 'deleted',
          deletedAt: now,
          expiresAt: deletedFileExpiresAt(row, now),
          updatedBy: caller.userId,
        })
        .where(
          and(
            eq(file.clubId, clubId),
            eq(file.id, row.id),
            ne(file.status, 'deleted'),
            isNull(file.purgedAt),
          ),
        )
        .returning(fileColumns);
      return fileDto((updated as FileRow | undefined) ?? (await readFile(db, clubId, row.id)));
    },
  });
}
