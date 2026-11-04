import {
  archiveProtocolMedia,
  attachProtocolMedia,
  getTestDefinition,
  listProtocolMedia,
  listTestDefinitions,
  restoreProtocolMedia,
  updateProtocolMedia,
  PROTOCOL_MEDIA_SORT_ORDER_MAX,
  type ProtocolMediaDto,
  type TestDefinitionDto,
  type TestProtocolDto,
  type UploadedFile,
} from '@sport-performance/contracts';
import {
  file,
  metricDefinition,
  testDefinition,
  testDefinitionMetric,
  testProtocolMedia,
  type TestProtocol,
} from '@sport-performance/db/schema';
import {
  fileExpiresAt,
  type AttemptAggregation,
  type CategoryId,
  type ClubId,
  type FileKind,
  type FileStatus,
  type LocalDate,
  type PlayerId,
  type Sport,
} from '@sport-performance/domain';
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';
import { clubToday, validationError } from './configuration-shared.js';

/**
 * Test protocols (B-415, ADR 0067). Every member reads the protocol text and
 * metrics of each test version (`metric_catalog.read`): it is no personal
 * data. Images and videos that show how a protocol is done are staff only
 * (`configuration.read`, a video may show a person) and are attached by `sc`
 * and the administration (`configuration.update`). A media file is kept
 * while an active attachment points at it (`expires_at` `NULL`, the crest's
 * rule) and expires 30 days after the last one is archived.
 */

const definitionColumns = {
  id: testDefinition.id,
  code: testDefinition.code,
  version: testDefinition.version,
  sports: testDefinition.sports,
  attemptCount: testDefinition.attemptCount,
  attemptAggregation: testDefinition.attemptAggregation,
  maximalLoad: testDefinition.maximalLoad,
  protocol: testDefinition.protocol,
  validFrom: testDefinition.validFrom,
  validTo: testDefinition.validTo,
  createdAt: testDefinition.createdAt,
  updatedAt: testDefinition.updatedAt,
};

interface DefinitionRow {
  id: string;
  code: string;
  version: number;
  sports: Sport[] | null;
  attemptCount: number;
  attemptAggregation: AttemptAggregation;
  maximalLoad: boolean;
  protocol: TestProtocol;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEFINITION_KEYS: KeysetSpec<DefinitionRow, 'code' | 'version'> = {
  fields: {
    code: { column: testDefinition.code, type: 'text', value: (row) => row.code },
    version: { column: testDefinition.version, type: 'integer', value: (row) => row.version },
  },
  id: { column: testDefinition.id, value: (row) => row.id },
};

/** The stored protocol with every field present (the JSON may omit any of them). */
function protocolDto(protocol: TestProtocol): TestProtocolDto {
  return {
    summary: protocol.summary ?? null,
    steps: [...(protocol.steps ?? [])],
    restBetweenAttemptsS: protocol.restBetweenAttemptsS ?? null,
    equipment: [...(protocol.equipment ?? [])],
    parameters: { ...(protocol.parameters ?? {}) },
  };
}

type MetricOfDefinition = TestDefinitionDto['metrics'][number];

async function metricsOf(
  db: TenantDatabase,
  clubId: ClubId,
  definitionIds: readonly string[],
): Promise<Map<string, MetricOfDefinition[]>> {
  const byDefinition = new Map<string, MetricOfDefinition[]>();
  if (definitionIds.length === 0) return byDefinition;
  const rows = await db
    .select({
      testDefinitionId: testDefinitionMetric.testDefinitionId,
      code: metricDefinition.code,
      unit: metricDefinition.unit,
      isDerived: testDefinitionMetric.isDerived,
    })
    .from(testDefinitionMetric)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.clubId, testDefinitionMetric.clubId),
        eq(metricDefinition.id, testDefinitionMetric.metricDefinitionId),
      ),
    )
    .where(
      and(
        eq(testDefinitionMetric.clubId, clubId),
        inArray(testDefinitionMetric.testDefinitionId, [...definitionIds]),
      ),
    )
    .orderBy(
      asc(testDefinitionMetric.testDefinitionId),
      asc(testDefinitionMetric.sortOrder),
      asc(metricDefinition.code),
    );
  for (const row of rows) {
    const list = byDefinition.get(row.testDefinitionId) ?? [];
    list.push({ code: row.code, unit: row.unit, isDerived: row.isDerived });
    byDefinition.set(row.testDefinitionId, list);
  }
  return byDefinition;
}

function definitionDto(row: DefinitionRow, metrics: MetricOfDefinition[]): TestDefinitionDto {
  return {
    id: row.id as TestDefinitionDto['id'],
    code: row.code,
    version: row.version,
    sports: row.sports === null ? null : [...row.sports],
    attemptCount: row.attemptCount,
    attemptAggregation: row.attemptAggregation,
    maximalLoad: row.maximalLoad,
    protocol: protocolDto(row.protocol),
    metrics,
    validFrom: row.validFrom,
    validTo: row.validTo,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readDefinition(
  db: TenantDatabase,
  clubId: ClubId,
  testDefinitionId: string,
): Promise<DefinitionRow> {
  const [row] = (await db
    .select(definitionColumns)
    .from(testDefinition)
    .where(and(eq(testDefinition.clubId, clubId), eq(testDefinition.id, testDefinitionId)))) as
    DefinitionRow[] | [];
  if (row === undefined) throw new HttpError('not_found', 'Test definition not found');
  return row;
}

const mediaColumns = {
  id: testProtocolMedia.id,
  testDefinitionId: testProtocolMedia.testDefinitionId,
  fileId: testProtocolMedia.fileId,
  caption: testProtocolMedia.caption,
  sortOrder: testProtocolMedia.sortOrder,
  archivedAt: testProtocolMedia.archivedAt,
  createdAt: testProtocolMedia.createdAt,
  updatedAt: testProtocolMedia.updatedAt,
  createdBy: testProtocolMedia.createdBy,
  version: rowVersion(testProtocolMedia.updatedAt),
};

interface MediaRow {
  id: string;
  testDefinitionId: string;
  fileId: string;
  caption: string;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  version: string;
}

const fileColumns = {
  id: file.id,
  kind: file.kind,
  status: file.status,
  playerId: file.playerId,
  categoryId: file.categoryId,
  contentType: file.contentType,
  sizeBytes: file.sizeBytes,
  checksumSha256: file.checksumSha256,
  fileName: file.fileName,
  uploadedAt: file.uploadedAt,
  expiresAt: file.expiresAt,
  deletedAt: file.deletedAt,
  createdBy: file.createdBy,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
};

interface FileRow {
  id: string;
  kind: FileKind;
  status: FileStatus;
  playerId: PlayerId | null;
  categoryId: CategoryId | null;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  fileName: string | null;
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
    // Material of a protocol is never the video of an attempt.
    testResultId: null,
    testEntryId: null,
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdBy: (row.createdBy ?? null) as UploadedFile['createdBy'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mediaDto(row: MediaRow, fileRow: FileRow): ProtocolMediaDto {
  return {
    id: row.id as ProtocolMediaDto['id'],
    testDefinitionId: row.testDefinitionId as ProtocolMediaDto['testDefinitionId'],
    file: fileDto(fileRow),
    caption: row.caption,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const MEDIA_KEYS: KeysetSpec<MediaRow, 'sortOrder' | 'createdAt'> = {
  fields: {
    sortOrder: {
      column: testProtocolMedia.sortOrder,
      type: 'integer',
      value: (row) => row.sortOrder,
    },
    createdAt: {
      column: testProtocolMedia.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: testProtocolMedia.id, value: (row) => row.id },
};

async function readMedia(
  db: TenantDatabase,
  clubId: ClubId,
  params: { testDefinitionId: string; mediaId: string },
): Promise<MediaRow> {
  const [row] = (await db
    .select(mediaColumns)
    .from(testProtocolMedia)
    .where(
      and(
        eq(testProtocolMedia.clubId, clubId),
        eq(testProtocolMedia.testDefinitionId, params.testDefinitionId),
        eq(testProtocolMedia.id, params.mediaId),
      ),
    )) as MediaRow[] | [];
  if (row === undefined) throw new HttpError('not_found', 'Protocol media not found');
  return row;
}

/**
 * The file of a media row, locked until the transaction ends: attaching,
 * archiving and restoring change its retention, `DELETE /v1/files/{id}`
 * takes the same lock, and the retention job skips a locked row.
 */
async function lockFile(db: TenantDatabase, clubId: ClubId, fileId: string): Promise<FileRow> {
  const [row] = (await db
    .select(fileColumns)
    .from(file)
    .where(and(eq(file.clubId, clubId), eq(file.id, fileId)))
    .for('update')) as FileRow[] | [];
  if (row === undefined) throw new HttpError('not_found', 'File not found');
  return row;
}

async function readFiles(
  db: TenantDatabase,
  clubId: ClubId,
  fileIds: readonly string[],
): Promise<Map<string, FileRow>> {
  if (fileIds.length === 0) return new Map();
  const rows = (await db
    .select(fileColumns)
    .from(file)
    .where(and(eq(file.clubId, clubId), inArray(file.id, [...new Set(fileIds)])))) as FileRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

function isAvailable(row: FileRow, now: Date): boolean {
  return row.status === 'ready' && (row.expiresAt === null || row.expiresAt > now);
}

/** Whether another active attachment (of any protocol version) keeps the file in use. */
async function usedElsewhere(
  db: TenantDatabase,
  clubId: ClubId,
  fileId: string,
  mediaId: string,
): Promise<boolean> {
  const [other] = await db
    .select({ id: testProtocolMedia.id })
    .from(testProtocolMedia)
    .where(
      and(
        eq(testProtocolMedia.clubId, clubId),
        eq(testProtocolMedia.fileId, fileId),
        ne(testProtocolMedia.id, mediaId),
        isNull(testProtocolMedia.archivedAt),
      ),
    )
    .limit(1);
  return other !== undefined;
}

async function setFileRetention(
  db: TenantDatabase,
  clubId: ClubId,
  fileId: string,
  expiresAt: Date | null,
  userId: string,
): Promise<FileRow> {
  const [updated] = (await db
    .update(file)
    .set({ expiresAt, updatedBy: userId })
    .where(and(eq(file.clubId, clubId), eq(file.id, fileId)))
    .returning(fileColumns)) as FileRow[] | [];
  if (updated === undefined) throw new HttpError('not_found', 'File not found');
  return updated;
}

/** The media file of an attachment and whether it is in use, for `DELETE /v1/files/{id}`. */
export async function protocolMediaInUse(
  db: TenantDatabase,
  clubId: ClubId,
  fileId: string,
): Promise<boolean> {
  const [active] = await db
    .select({ id: testProtocolMedia.id })
    .from(testProtocolMedia)
    .where(
      and(
        eq(testProtocolMedia.clubId, clubId),
        eq(testProtocolMedia.fileId, fileId),
        isNull(testProtocolMedia.archivedAt),
      ),
    )
    .limit(1);
  return active !== undefined;
}

export function registerTestDefinitionRoutes(
  app: FastifyInstance,
  options: { now?: () => Date } = {},
): void {
  const now = options.now ?? (() => new Date());

  registerEndpoint(app, listTestDefinitions, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('metric_catalog', 'read');
      const { clubId } = caller.membership;
      const validOn = query.validOn ?? (await clubToday(db));
      const plan = keysetPage(DEFINITION_KEYS, query, {
        code: query.code,
        sport: query.sport,
        validOn,
      });
      const rows = (await db
        .select(definitionColumns)
        .from(testDefinition)
        .where(
          and(
            eq(testDefinition.clubId, clubId),
            query.code === undefined ? undefined : eq(testDefinition.code, query.code),
            query.sport === undefined
              ? undefined
              : sql`(${testDefinition.sports} is null or ${query.sport} = any(${testDefinition.sports}::text[]))`,
            lte(testDefinition.validFrom, validOn),
            or(isNull(testDefinition.validTo), gt(testDefinition.validTo, validOn)),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit)) as DefinitionRow[];
      const page = plan.page(rows, (row) => row);
      const metrics = await metricsOf(
        db,
        clubId,
        page.items.map((row) => row.id),
      );
      return {
        items: page.items.map((row) => definitionDto(row, metrics.get(row.id) ?? [])),
        nextCursor: page.nextCursor,
      };
    },
  });

  registerEndpoint(app, getTestDefinition, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('metric_catalog', 'read');
      const { clubId } = caller.membership;
      const row = await readDefinition(db, clubId, params.testDefinitionId);
      const metrics = await metricsOf(db, clubId, [row.id]);
      return definitionDto(row, metrics.get(row.id) ?? []);
    },
  });

  registerEndpoint(app, listProtocolMedia, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const { clubId } = caller.membership;
      await readDefinition(db, clubId, params.testDefinitionId);
      const plan = keysetPage(MEDIA_KEYS, query, {
        testDefinitionId: params.testDefinitionId,
        status: query.status,
      });
      const rows = (await db
        .select(mediaColumns)
        .from(testProtocolMedia)
        .where(
          and(
            eq(testProtocolMedia.clubId, clubId),
            eq(testProtocolMedia.testDefinitionId, params.testDefinitionId),
            archiveStatusFilter(testProtocolMedia.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit)) as MediaRow[];
      const page = plan.page(rows, (row) => row);
      const files = await readFiles(
        db,
        clubId,
        page.items.map((row) => row.fileId),
      );
      return {
        items: page.items.flatMap((row) => {
          const fileRow = files.get(row.fileId);
          return fileRow === undefined ? [] : [mediaDto(row, fileRow)];
        }),
        nextCursor: page.nextCursor,
      };
    },
  });

  registerEndpoint(app, attachProtocolMedia, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const definition = await readDefinition(db, clubId, params.testDefinitionId);
      const at = now();
      const [visible] = await db
        .select({ id: file.id })
        .from(file)
        .where(and(eq(file.clubId, clubId), eq(file.id, body.fileId)));
      const fileRow = visible === undefined ? undefined : await lockFile(db, clubId, body.fileId);
      if (fileRow?.kind !== 'protocol_media' || !isAvailable(fileRow, at)) {
        throw validationError(
          'The media must be an uploaded protocol_media file',
          ['body', 'fileId'],
          'Not a ready protocol_media file of this club',
        );
      }
      let sortOrder = body.sortOrder;
      if (sortOrder === undefined) {
        const [last] = await db
          .select({ max: sql<number | null>`max(${testProtocolMedia.sortOrder})` })
          .from(testProtocolMedia)
          .where(
            and(
              eq(testProtocolMedia.clubId, clubId),
              eq(testProtocolMedia.testDefinitionId, definition.id),
              isNull(testProtocolMedia.archivedAt),
            ),
          );
        const max = last?.max ?? null;
        sortOrder = max === null ? 0 : Math.min(max + 1, PROTOCOL_MEDIA_SORT_ORDER_MAX);
      }
      const { row, replayed } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            (await db
              .insert(testProtocolMedia)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                testDefinitionId: definition.id,
                fileId: fileRow.id,
                caption: body.caption,
                sortOrder,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({
                target: [testProtocolMedia.clubId, testProtocolMedia.clientUuid],
              })
              .returning(mediaColumns)) as MediaRow[]
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            (await db
              .select(mediaColumns)
              .from(testProtocolMedia)
              .where(
                and(
                  eq(testProtocolMedia.clubId, clubId),
                  eq(testProtocolMedia.clientUuid, clientUuid),
                ),
              )) as MediaRow[]
          )[0],
      });
      if (
        replayed &&
        (row.testDefinitionId !== definition.id ||
          row.fileId !== fileRow.id ||
          row.createdBy !== caller.userId)
      ) {
        throw new HttpError('conflict', 'This clientUuid was already used for another media');
      }
      // In use from now on: never expires while an active attachment points at it.
      const kept =
        row.archivedAt === null
          ? await setFileRetention(db, clubId, fileRow.id, null, caller.userId)
          : fileRow;
      return mediaDto(row, kept);
    },
  });

  registerEndpoint(app, updateProtocolMedia, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const current = await readMedia(db, clubId, params);
      if (current.archivedAt !== null) {
        throw new HttpError('conflict', 'The media is archived: restore it first');
      }
      const updated = await updateAtVersion({
        resource: 'Protocol media',
        update: async () =>
          (
            (await db
              .update(testProtocolMedia)
              .set({
                ...(body.caption !== undefined && { caption: body.caption }),
                ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
                updatedBy: caller.userId,
              })
              .where(
                and(
                  eq(testProtocolMedia.clubId, clubId),
                  eq(testProtocolMedia.id, current.id),
                  isNull(testProtocolMedia.archivedAt),
                  versionMatches(testProtocolMedia.updatedAt, body.version),
                ),
              )
              .returning(mediaColumns)) as MediaRow[]
          )[0],
        // Read above: an empty update means it changed (or was archived) since.
        exists: () => Promise.resolve(true),
      });
      const files = await readFiles(db, clubId, [updated.fileId]);
      const fileRow = files.get(updated.fileId);
      if (fileRow === undefined) throw new HttpError('not_found', 'File not found');
      return mediaDto(updated, fileRow);
    },
  });

  registerEndpoint(app, archiveProtocolMedia, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const current = await readMedia(db, clubId, params);
      const fileRow = await lockFile(db, clubId, current.fileId);
      if (current.archivedAt !== null) return mediaDto(current, fileRow);
      const at = now();
      const [archived] = (await db
        .update(testProtocolMedia)
        .set({ archivedAt: at, updatedBy: caller.userId })
        .where(
          and(
            eq(testProtocolMedia.clubId, clubId),
            eq(testProtocolMedia.id, current.id),
            isNull(testProtocolMedia.archivedAt),
          ),
        )
        .returning(mediaColumns)) as MediaRow[] | [];
      const row = archived ?? (await readMedia(db, clubId, params));
      // The last protocol that showed it let go: it expires like an unused crest.
      const kept =
        fileRow.status === 'ready' && !(await usedElsewhere(db, clubId, fileRow.id, row.id))
          ? await setFileRetention(
              db,
              clubId,
              fileRow.id,
              fileExpiresAt('protocol_media', at, false),
              caller.userId,
            )
          : fileRow;
      return mediaDto(row, kept);
    },
  });

  registerEndpoint(app, restoreProtocolMedia, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const current = await readMedia(db, clubId, params);
      const fileRow = await lockFile(db, clubId, current.fileId);
      if (current.archivedAt === null) return mediaDto(current, fileRow);
      if (!isAvailable(fileRow, now())) {
        throw new HttpError('conflict', 'The file expired or was deleted: upload it again');
      }
      const [restored] = (await db
        .update(testProtocolMedia)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(testProtocolMedia.clubId, clubId), eq(testProtocolMedia.id, current.id)))
        .returning(mediaColumns)) as MediaRow[] | [];
      if (restored === undefined) throw new HttpError('not_found', 'Protocol media not found');
      return mediaDto(
        restored,
        await setFileRetention(db, clubId, fileRow.id, null, caller.userId),
      );
    },
  });
}
