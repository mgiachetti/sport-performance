/**
 * `installClubLogo` against real Postgres (`DATABASE_URL`) and MinIO
 * (`STORAGE_TEST_URL`): the crest ends where an admin's upload ends.
 */
import { readFileSync } from 'node:fs';
import { createDatabase, type Database } from '@sport-performance/db';
import { club, file } from '@sport-performance/db/schema';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import { fileObjectKey, type ClubId } from '@sport-performance/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvalidClubLogoError, createS3Storage, installClubLogo } from './index.js';
import { createTestBucket, storageTestUrl, type TestBucket } from './test-bucket.js';

const serverUrl = process.env.DATABASE_URL;
const ready =
  serverUrl !== undefined &&
  serverUrl !== '' &&
  storageTestUrl !== undefined &&
  storageTestUrl !== '';
if (!ready && process.env.CI !== undefined) {
  throw new Error('DATABASE_URL and STORAGE_TEST_URL are required in CI.');
}

const CREST = readFileSync(new URL('../../../assets/clubs/orc/escudo.png', import.meta.url));

describe.skipIf(!ready)('installClubLogo (Postgres + MinIO)', () => {
  let database: TemporaryDatabase;
  let bucket: TestBucket;
  let db: Database;
  let clubId: ClubId;

  beforeAll(async () => {
    database = await createTemporaryDatabase({ serverUrl: serverUrl ?? '', prefix: 'sp_logo_' });
    bucket = await createTestBucket(storageTestUrl ?? '');
    db = createDatabase(database.pool());
    const [row] = await db
      .insert(club)
      .values({ slug: 'logo-test', name: 'Club de prueba', shortName: 'CDP' })
      .returning({ id: club.id });
    if (row === undefined) throw new Error('no club');
    clubId = row.id;
  });

  afterAll(async () => {
    await bucket.drop();
    await database.drop();
  });

  it('stores the crest like an upload and points the club at it, once', async () => {
    const storage = createS3Storage(bucket.config);
    const first = await installClubLogo({
      db,
      storage,
      clubId,
      bytes: CREST,
      contentType: 'image/png',
      fileName: 'escudo.png',
    });
    expect(first.changed).toBe(true);
    const [row] = await db.select().from(file).where(eq(file.id, first.fileId));
    expect(row).toMatchObject({ kind: 'club_logo', status: 'ready', expiresAt: null });
    const [current] = await db
      .select({ logo: club.logoFileId })
      .from(club)
      .where(eq(club.id, clubId));
    expect(current?.logo).toBe(first.fileId);
    expect(await bucket.keys()).toEqual([
      fileObjectKey({ clubId, kind: 'club_logo', id: first.fileId }),
    ]);

    const again = await installClubLogo({
      db,
      storage,
      clubId,
      bytes: CREST,
      contentType: 'image/png',
      fileName: 'escudo.png',
    });
    expect(again).toEqual({ fileId: first.fileId, changed: false });

    // Another crest replaces it; the old one is left to the retention job.
    const other = Buffer.concat([CREST, Buffer.from([0])]);
    const second = await installClubLogo({
      db,
      storage,
      clubId,
      bytes: other,
      contentType: 'image/png',
      fileName: 'escudo-2.png',
    });
    expect(second.changed).toBe(true);
    const [previous] = await db.select().from(file).where(eq(file.id, first.fileId));
    expect(previous?.expiresAt).not.toBeNull();
  });

  it('refuses what an upload refuses', async () => {
    await expect(
      installClubLogo({
        db,
        storage: createS3Storage(bucket.config),
        clubId,
        bytes: Buffer.from('<svg/>'),
        contentType: 'image/svg+xml',
        fileName: 'escudo.svg',
      }),
    ).rejects.toThrow(InvalidClubLogoError);
  });
});
