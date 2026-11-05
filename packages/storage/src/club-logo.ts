import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Database } from '@sport-performance/db';
import { club, file } from '@sport-performance/db/schema';
import {
  FILE_KIND_POLICIES,
  fileExpiresAt,
  fileObjectKey,
  type ClubId,
} from '@sport-performance/domain';
import { and, eq } from 'drizzle-orm';
import type { ObjectStorage } from './storage.js';

export type ClubLogoContentType = (typeof FILE_KIND_POLICIES.club_logo.contentTypes)[number];

export interface InstallClubLogoOptions {
  /** A connection that may write `file` and `club` of the club (the owner, in operations). */
  readonly db: Database;
  readonly storage: ObjectStorage;
  readonly clubId: ClubId;
  readonly bytes: Uint8Array;
  /** Raster only, like the admin's upload (ADR 0044): PNG or WebP. */
  readonly contentType: string;
  readonly fileName: string;
  readonly now?: Date;
}

export interface InstallClubLogoResult {
  readonly fileId: string;
  /** `false` when the club already used this exact crest (same SHA-256): nothing written. */
  readonly changed: boolean;
}

export class InvalidClubLogoError extends Error {
  override readonly name = 'InvalidClubLogoError';
}

/** The image type from the file's own signature (PNG or WebP), not its name; `null` otherwise. */
export function sniffImageType(bytes: Uint8Array): ClubLogoContentType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => bytes[i] === byte)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.byteLength >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function sha256Base64(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64');
}

/**
 * Sets a club's crest from a file, through the same path an upload from the
 * admin page takes (ADR 0044, ADR 0097): a `club_logo` file row, its object
 * in the bucket under `clubs/<club>/club_logo/<id>`, `club.logo_file_id`
 * pointing at it and the previous crest left to the retention job. For
 * operations (a club's bootstrap, the demo club of a stack); a club's own
 * administration changes it from the web.
 *
 * Idempotent: the crest the club already uses (same SHA-256 and type) is not
 * uploaded again. The row is `pending` until the bucket holds the object,
 * then `ready`, so a failure in between leaves nothing pointing at a missing
 * object.
 */
export async function installClubLogo(
  options: InstallClubLogoOptions,
): Promise<InstallClubLogoResult> {
  const policy = FILE_KIND_POLICIES.club_logo;
  if (!(policy.contentTypes as readonly string[]).includes(options.contentType)) {
    throw new InvalidClubLogoError(
      `A crest is ${policy.contentTypes.join(' or ')}, got ${options.contentType}.`,
    );
  }
  if (options.bytes.byteLength === 0 || options.bytes.byteLength > policy.maxSizeBytes) {
    throw new InvalidClubLogoError(
      `A crest is 1 byte to ${String(policy.maxSizeBytes)} bytes, got ${String(options.bytes.byteLength)}.`,
    );
  }
  const now = options.now ?? new Date();
  const checksumSha256 = sha256Base64(options.bytes);
  const { db, clubId } = options;

  const [current] = await db
    .select({ id: file.id, checksumSha256: file.checksumSha256, contentType: file.contentType })
    .from(club)
    .innerJoin(file, and(eq(file.clubId, club.id), eq(file.id, club.logoFileId)))
    .where(eq(club.id, clubId));
  if (current?.checksumSha256 === checksumSha256 && current.contentType === options.contentType) {
    return { fileId: current.id, changed: false };
  }

  const [inserted] = await db
    .insert(file)
    .values({
      clubId,
      kind: 'club_logo',
      status: 'pending',
      contentType: options.contentType,
      sizeBytes: options.bytes.byteLength,
      checksumSha256,
      fileName: options.fileName,
      // The upload window of a pending row; the crest in use has no expiry once ready.
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    })
    .returning({ id: file.id });
  if (inserted === undefined) throw new Error('file insert returned nothing');

  await options.storage.putObject({
    key: fileObjectKey({ clubId, kind: 'club_logo', id: inserted.id }),
    contentType: options.contentType,
    sizeBytes: options.bytes.byteLength,
    checksumSha256,
    body: () => Readable.from([Buffer.from(options.bytes)]),
  });

  await db.transaction(async (tx) => {
    await tx
      .update(file)
      .set({ status: 'ready', uploadedAt: now, expiresAt: fileExpiresAt('club_logo', now, true) })
      .where(and(eq(file.clubId, clubId), eq(file.id, inserted.id)));
    const [previous] = await tx
      .select({ logoFileId: club.logoFileId })
      .from(club)
      .where(eq(club.id, clubId))
      .for('update');
    await tx.update(club).set({ logoFileId: inserted.id }).where(eq(club.id, clubId));
    const previousId = previous?.logoFileId ?? null;
    if (previousId !== null && previousId !== inserted.id) {
      // Unused from now on: the retention job removes it after its grace period.
      await tx
        .update(file)
        .set({ expiresAt: fileExpiresAt('club_logo', now, false) })
        .where(and(eq(file.clubId, clubId), eq(file.id, previousId)));
    }
  });
  return { fileId: inserted.id, changed: true };
}
