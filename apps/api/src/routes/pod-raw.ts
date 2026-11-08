import { createHash, randomUUID } from 'node:crypto';
import {
  confirmPodRawUpload,
  createPodRawUpload,
  getPodRawEraseCommand,
  getPodRawUpload,
  getPodSettings,
  listPodRawUploads,
  updatePodSettings,
  type FileUpload,
  type PodRawManifestBody,
  type PodRawUpload,
} from '@sport-performance/contracts';
import { club, file, pod, podCommandAudit, podRawUpload } from '@sport-performance/db/schema';
import {
  fileObjectKey,
  pendingUploadExpiresAt,
  podRawPendingFileExpiresAt,
  podRawPendingUntil,
  resolvePodSettings,
  type ClubId,
  type PodRawIssue,
  type PodRawRejectionReason,
  type PodRawUploadState,
} from '@sport-performance/domain';
import { and, eq, ne, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import type { FilesModule } from '../files/module.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError, databaseErrorOf } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { markReplay, rowVersion, updateAtVersion, versionMatches } from '../http/writes.js';
import type { PodCommandSigner } from '../pods/command-signer.js';

/**
 * Ingestion of the pod's NAND log (B-916, ADR 0106, ADR 0108): the dock,
 * with the session of S&C or the administration (`pod.manage`), uploads one
 * `pod_raw` per recording segment with its manifest (signed `PUT` and
 * confirmation, ADR 0044), and once the worker verified it with the pod's
 * keys fetches the erase command signed by the server. The upload rows are
 * the pod's metadata, never a position; nobody downloads a `pod_raw`.
 */

const CONTENT_TYPE = 'application/octet-stream';

const uploadColumns = {
  id: podRawUpload.id,
  clubId: podRawUpload.clubId,
  podId: podRawUpload.podId,
  podSerial: podRawUpload.podSerial,
  bootCounter: podRawUpload.bootCounter,
  segmentId: podRawUpload.segmentId,
  firstPageSeq: podRawUpload.firstPageSeq,
  lastPageSeq: podRawUpload.lastPageSeq,
  pagesN: podRawUpload.pagesN,
  validPagesN: podRawUpload.validPagesN,
  sizeBytes: podRawUpload.sizeBytes,
  sha256Hex: podRawUpload.sha256Hex,
  fileId: podRawUpload.fileId,
  state: podRawUpload.state,
  confirmedAt: podRawUpload.confirmedAt,
  pendingUntil: podRawUpload.pendingUntil,
  verifiedAt: podRawUpload.verifiedAt,
  eraseCommand: podRawUpload.eraseCommand,
  recordedFrom: podRawUpload.recordedFrom,
  recordedTo: podRawUpload.recordedTo,
  firmwareVersion: podRawUpload.firmwareVersion,
  gnssFirmwareVersion: podRawUpload.gnssFirmwareVersion,
  issues: podRawUpload.issues,
  rejectionReason: podRawUpload.rejectionReason,
  rejectedAt: podRawUpload.rejectedAt,
  trimmedAt: podRawUpload.trimmedAt,
  trimmedPlayersN: podRawUpload.trimmedPlayersN,
  trimmedSamplesN: podRawUpload.trimmedSamplesN,
  createdBy: podRawUpload.createdBy,
  createdAt: podRawUpload.createdAt,
  updatedAt: podRawUpload.updatedAt,
};

interface UploadRow {
  id: string;
  clubId: ClubId;
  podId: string;
  podSerial: string;
  bootCounter: number;
  segmentId: number;
  firstPageSeq: number;
  lastPageSeq: number;
  pagesN: number;
  validPagesN: number;
  sizeBytes: number;
  sha256Hex: string;
  fileId: string;
  state: PodRawUploadState;
  confirmedAt: Date | null;
  pendingUntil: Date | null;
  verifiedAt: Date | null;
  eraseCommand: string | null;
  recordedFrom: Date | null;
  recordedTo: Date | null;
  firmwareVersion: string | null;
  gnssFirmwareVersion: string | null;
  issues: readonly PodRawIssue[];
  rejectionReason: PodRawRejectionReason | null;
  rejectedAt: Date | null;
  trimmedAt: Date | null;
  trimmedPlayersN: number | null;
  trimmedSamplesN: number | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

function uploadDto(row: UploadRow): PodRawUpload {
  return {
    id: row.id as PodRawUpload['id'],
    podId: row.podId as PodRawUpload['podId'],
    podSerial: row.podSerial,
    bootCounter: row.bootCounter,
    segmentId: row.segmentId,
    firstPageSeq: row.firstPageSeq,
    lastPageSeq: row.lastPageSeq,
    pagesN: row.pagesN,
    validPagesN: row.validPagesN,
    sizeBytes: row.sizeBytes,
    sha256Hex: row.sha256Hex,
    fileId: row.fileId as PodRawUpload['fileId'],
    state: row.state,
    confirmedAt: iso(row.confirmedAt),
    pendingUntil: iso(row.pendingUntil),
    verifiedAt: iso(row.verifiedAt),
    eraseCommandAvailable: eraseCommandOf(row) !== null,
    recordedFrom: iso(row.recordedFrom),
    recordedTo: iso(row.recordedTo),
    firmwareVersion: row.firmwareVersion,
    gnssFirmwareVersion: row.gnssFirmwareVersion,
    issues: row.issues.map((i) => ({
      code: i.code,
      ...(i.count !== undefined && { count: i.count }),
    })),
    rejectionReason: row.rejectionReason,
    rejectedAt: iso(row.rejectedAt),
    trimmedAt: iso(row.trimmedAt),
    trimmedPlayersN: row.trimmedPlayersN,
    trimmedSamplesN: row.trimmedSamplesN,
    createdBy: (row.createdBy ?? null) as PodRawUpload['createdBy'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The erase command can be signed once verified (and after the trim), never if rejected. */
function eraseCommandOf(row: Pick<UploadRow, 'state' | 'eraseCommand'>): string | null {
  return row.state === 'verified' || row.state === 'trimmed' ? row.eraseCommand : null;
}

const UPLOAD_KEYS: KeysetSpec<UploadRow, 'createdAt'> = {
  fields: {
    createdAt: { column: podRawUpload.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: podRawUpload.id, value: (row) => row.id },
};

function requireStorage(files: FilesModule | undefined): FilesModule {
  if (files === undefined) {
    throw new HttpError('service_unavailable', 'File storage is not configured');
  }
  return files;
}

async function readUpload(
  db: TenantDatabase,
  clubId: ClubId,
  id: string,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<UploadRow> {
  const query = db
    .select(uploadColumns)
    .from(podRawUpload)
    .where(and(eq(podRawUpload.clubId, clubId), eq(podRawUpload.id, id)));
  const [row] = forUpdate ? await query.for('update') : await query;
  if (row === undefined) throw new HttpError('not_found', 'Upload not found');
  return row;
}

/** `podRawIngestKey` of the protocol (the API does not depend on it: the same string). */
export function ingestKeyOf(manifest: PodRawManifestBody): string {
  return `${manifest.deviceIdHex}/${String(manifest.bootCounter)}/${String(manifest.segmentId)}`;
}

/** The SHA-256 of the manifest (hex) as the bucket checks it (base64). */
export function checksumOf(sha256Hex: string): string {
  return Buffer.from(sha256Hex, 'hex').toString('base64');
}

/** The signed `PUT` of the pending file, while its upload window `until` lasts. */
async function signedUploadOf(
  files: FilesModule,
  clubId: ClubId,
  row: UploadRow,
  until: Date | null,
): Promise<FileUpload | null> {
  const now = files.now();
  if (row.state !== 'uploading' || until === null || until <= now) return null;
  const remainingS = Math.floor((until.getTime() - now.getTime()) / 1000);
  if (remainingS < 1) return null;
  const signed = await files.storage.presignUpload({
    key: fileObjectKey({ clubId, kind: 'pod_raw', id: row.fileId }),
    contentType: CONTENT_TYPE,
    sizeBytes: row.sizeBytes,
    checksumSha256: checksumOf(row.sha256Hex),
    expiresInS: Math.min(files.uploadUrlTtlS, remainingS),
  });
  return {
    method: signed.method,
    url: signed.url,
    headers: { ...signed.headers },
    expiresAt: signed.expiresAt.toISOString(),
  };
}

async function pendingFileExpiry(
  db: TenantDatabase,
  clubId: ClubId,
  fileId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ expiresAt: file.expiresAt, status: file.status })
    .from(file)
    .where(and(eq(file.clubId, clubId), eq(file.id, fileId)));
  return row?.status === 'pending' ? row.expiresAt : null;
}

/** Whether a replayed manifest is the same file as the live upload of its segment. */
function sameFile(row: UploadRow, manifest: PodRawManifestBody): boolean {
  return (
    row.sha256Hex === manifest.sha256Hex &&
    row.sizeBytes === manifest.sizeB &&
    row.firstPageSeq === manifest.firstPageSeq &&
    row.lastPageSeq === manifest.lastPageSeq &&
    row.pagesN === manifest.pagesN
  );
}

const settingsColumns = { settings: club.settings, version: rowVersion(club.updatedAt) };

async function readClubSettings(db: TenantDatabase, clubId: ClubId) {
  const [row] = await db.select(settingsColumns).from(club).where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('not_found', 'Club not found');
  return row;
}

export function registerPodRawRoutes(
  app: FastifyInstance,
  options: { files: FilesModule | undefined; signer: PodCommandSigner | undefined },
): void {
  registerEndpoint(app, createPodRawUpload, {
    transaction: true,
    // It hands out upload URLs (ADR 0031).
    rateLimit: 'upload',
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('pod', 'manage');
      const module = requireStorage(options.files);
      const { clubId } = caller.membership;
      const { manifest } = body;
      const [target] = await db
        .select({ id: pod.id, deviceId: pod.deviceId, status: pod.status })
        .from(pod)
        .where(and(eq(pod.clubId, clubId), eq(pod.id, params.podId)));
      if (target === undefined) throw new HttpError('not_found', 'Pod not found');
      const ingestKey = ingestKeyOf(manifest);
      // Idempotent by segment (ADR 0106): the live upload of the segment, if any.
      const [existing] = await db
        .select(uploadColumns)
        .from(podRawUpload)
        .where(
          and(
            eq(podRawUpload.clubId, clubId),
            eq(podRawUpload.ingestKey, ingestKey),
            ne(podRawUpload.state, 'rejected'),
          ),
        );
      if (existing !== undefined) {
        const row: UploadRow = existing;
        if (row.podId !== target.id || !sameFile(row, manifest)) {
          throw new HttpError('conflict', 'This segment was already uploaded with another file');
        }
        markReplay(reply);
        const until = await pendingFileExpiry(db, clubId, row.fileId);
        return {
          upload: uploadDto(row),
          fileUpload: await signedUploadOf(module, clubId, row, until),
        };
      }
      if (target.status === 'retired') {
        throw new HttpError('conflict', 'The pod is retired');
      }
      const fileId = randomUUID();
      const now = module.now();
      try {
        await db.insert(file).values({
          id: fileId,
          clubId,
          kind: 'pod_raw',
          contentType: CONTENT_TYPE,
          sizeBytes: manifest.sizeB,
          checksumSha256: checksumOf(manifest.sha256Hex),
          // Never the chip id (the keys are derived from it): only the boot and the segment.
          fileName: `segment-${String(manifest.bootCounter)}-${String(manifest.segmentId)}.sprw`,
          expiresAt: pendingUploadExpiresAt(now),
          createdBy: caller.userId,
          updatedBy: caller.userId,
        });
        const [inserted] = await db
          .insert(podRawUpload)
          .values({
            clubId,
            podId: target.id,
            deviceId: target.deviceId,
            ingestKey,
            chipId: manifest.deviceIdHex,
            podSerial: manifest.podSerial,
            bootCounter: manifest.bootCounter,
            segmentId: manifest.segmentId,
            firstPageSeq: manifest.firstPageSeq,
            lastPageSeq: manifest.lastPageSeq,
            pagesN: manifest.pagesN,
            validPagesN: manifest.validPagesN,
            blocks: manifest.blocks,
            keyEpochs: manifest.keyEpochs,
            segmentClosed: manifest.closed,
            declaredStartAt: manifest.startUnixMs === null ? null : new Date(manifest.startUnixMs),
            declaredEndAt: manifest.endUnixMs === null ? null : new Date(manifest.endUnixMs),
            sizeBytes: manifest.sizeB,
            sha256Hex: manifest.sha256Hex,
            fileId,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          })
          .returning(uploadColumns);
        const row = inserted as UploadRow;
        return {
          upload: uploadDto(row),
          fileUpload: await signedUploadOf(module, clubId, row, pendingUploadExpiresAt(now)),
        };
      } catch (error) {
        const found = databaseErrorOf(error);
        if (found?.constraint === 'pod_raw_upload_device') {
          throw new HttpError('validation_failed', 'The manifest is not of this pod', {
            details: [
              {
                path: ['body', 'manifest', 'deviceIdHex'],
                code: 'custom',
                message: 'Not the chip id and serial number of the pod',
              },
            ],
            cause: error,
          });
        }
        throw error;
      }
    },
  });

  registerEndpoint(app, confirmPodRawUpload, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller, log }) => {
      await permissions.authorize('pod', 'manage');
      const module = requireStorage(options.files);
      const { clubId } = caller.membership;
      const row = await readUpload(db, clubId, params.podRawUploadId, { forUpdate: true });
      if (row.state !== 'uploading') return uploadDto(row);
      const now = module.now();
      const expiresAt = await pendingFileExpiry(db, clubId, row.fileId);
      if (expiresAt === null || expiresAt <= now) {
        throw new HttpError('conflict', 'The upload window closed: ask for the upload again');
      }
      const key = fileObjectKey({ clubId, kind: 'pod_raw', id: row.fileId });
      const stored = await module.storage.stat(key);
      if (stored === null)
        throw new HttpError('conflict', 'Nothing was uploaded for this file yet');
      if (stored.checksumSha256 === null || stored.contentType === null) {
        log.warn(
          { podRawUploadId: row.id, checksum: stored.checksumSha256 !== null },
          'storage did not return the checksum or content type of a pod_raw: refused',
        );
      }
      if (
        stored.sizeBytes !== row.sizeBytes ||
        stored.contentType !== CONTENT_TYPE ||
        stored.checksumSha256 !== checksumOf(row.sha256Hex)
      ) {
        await module.storage.remove(key);
        throw new HttpError('conflict', 'The uploaded content does not match the manifest');
      }
      const settings = resolvePodSettings((await readClubSettings(db, clubId)).settings.pods);
      const pendingUntil = podRawPendingUntil(now, settings.rawPendingDays);
      await db
        .update(file)
        .set({
          status: 'ready',
          uploadedAt: now,
          // Never kept past its pending days: the trim deletes it before, the retention after.
          expiresAt: podRawPendingFileExpiresAt(pendingUntil),
          updatedBy: caller.userId,
        })
        .where(and(eq(file.clubId, clubId), eq(file.id, row.fileId), eq(file.status, 'pending')));
      const [updated] = await db
        .update(podRawUpload)
        .set({
          state: 'pending',
          confirmedAt: now,
          pendingUntil,
          updatedBy: caller.userId,
        })
        .where(
          and(
            eq(podRawUpload.clubId, clubId),
            eq(podRawUpload.id, row.id),
            eq(podRawUpload.state, 'uploading'),
          ),
        )
        .returning(uploadColumns);
      return uploadDto(
        (updated as UploadRow | undefined) ?? (await readUpload(db, clubId, row.id)),
      );
    },
  });

  registerEndpoint(app, getPodRawUpload, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      return uploadDto(await readUpload(db, caller.membership.clubId, params.podRawUploadId));
    },
  });

  registerEndpoint(app, listPodRawUploads, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const plan = keysetPage(UPLOAD_KEYS, query, { podId: query.podId, state: query.state });
      const filters: (SQL | undefined)[] = [
        eq(podRawUpload.clubId, clubId),
        query.podId === undefined ? undefined : eq(podRawUpload.podId, query.podId),
        query.state === undefined ? undefined : eq(podRawUpload.state, query.state),
        plan.where,
      ];
      const rows = (await db
        .select(uploadColumns)
        .from(podRawUpload)
        .where(and(...filters))
        .orderBy(...plan.orderBy)
        .limit(plan.limit)) as UploadRow[];
      return plan.page(rows, uploadDto);
    },
  });

  registerEndpoint(app, getPodRawEraseCommand, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller, request }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const row = await readUpload(db, clubId, params.podRawUploadId);
      const command = eraseCommandOf(row);
      if (command === null) {
        throw new HttpError(
          'conflict',
          row.state === 'rejected'
            ? 'The upload was rejected: the pod keeps the segment'
            : 'The upload is not verified yet',
        );
      }
      if (options.signer === undefined) {
        throw new HttpError('service_unavailable', 'Pod commands cannot be signed here');
      }
      const bytes = Buffer.from(command, 'hex');
      const signature = options.signer.sign(bytes);
      // Every signed command leaves its trace: who, which upload, which key, which bytes.
      await db.insert(podCommandAudit).values({
        clubId,
        podRawUploadId: row.id,
        command: 'erase',
        keyId: options.signer.keyId,
        commandSha256: createHash('sha256').update(bytes).digest('hex'),
        requestId: /^[A-Za-z0-9._:-]{1,128}$/.test(request.id) ? request.id : null,
        createdBy: caller.userId,
        updatedBy: caller.userId,
      });
      return {
        podRawUploadId: row.id,
        command: bytes.toString('base64'),
        signature: Buffer.from(signature).toString('base64'),
        algorithm: options.signer.algorithm,
        keyId: options.signer.keyId,
      };
    },
  });

  registerEndpoint(app, getPodSettings, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const row = await readClubSettings(db, caller.membership.clubId);
      return { ...resolvePodSettings(row.settings.pods), version: row.version };
    },
  });

  registerEndpoint(app, updatePodSettings, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'update');
      const { clubId } = caller.membership;
      const current = await readClubSettings(db, clubId);
      const pods = {
        ...resolvePodSettings(current.settings.pods),
        rawPendingDays: body.rawPendingDays,
      };
      const row = await updateAtVersion({
        resource: 'Club',
        update: async () =>
          (
            await db
              .update(club)
              .set({ settings: { ...current.settings, pods }, updatedBy: caller.userId })
              .where(and(eq(club.id, clubId), versionMatches(club.updatedAt, body.version)))
              .returning(settingsColumns)
          )[0],
        exists: () => Promise.resolve(true),
      });
      return { ...resolvePodSettings(row.settings.pods), version: row.version };
    },
  });
}
