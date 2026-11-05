#!/usr/bin/env node
/**
 * `pnpm --filter @sport-performance/storage club:logo --slug=<club> --file=<path>`
 * (or the `sport-performance-club-logo` bin): sets a club's crest from a PNG
 * or WebP file with `installClubLogo` (ADR 0097). For operations: a new
 * club's bootstrap (`assets/clubs/<club>/escudo.png`) or the demo club of an
 * environment; a club's administration changes its crest from the web.
 *
 * Connects with `MIGRATIONS_DATABASE_URL` or `DATABASE_URL` (the owner role)
 * and the bucket of the `STORAGE_*` variables. Never prints a credential.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { createDatabase, createPool, migrationsConnectionString } from '@sport-performance/db';
import { club } from '@sport-performance/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { installClubLogo, sniffImageType } from '../club-logo.js';
import { storageConfigOf, storageEnvShape } from '../config.js';
import { createS3Storage } from '../s3.js';

try {
  const { values } = parseArgs({
    options: { slug: { type: 'string' }, file: { type: 'string' } },
    strict: true,
  });
  if (values.slug === undefined || values.file === undefined) {
    throw new Error('Usage: club-logo --slug=<club slug> --file=<crest.png|crest.webp>');
  }
  const storageConfig = storageConfigOf(z.object(storageEnvShape).parse(process.env));
  if (storageConfig === null) throw new Error('Set the STORAGE_* variables of the bucket.');
  const bytes = readFileSync(values.file);
  const contentType = sniffImageType(bytes);
  if (contentType === null) throw new Error('The crest must be a PNG or WebP image.');

  const pool = createPool({
    connectionString: migrationsConnectionString(),
    applicationName: 'club-logo',
    max: 1,
  });
  try {
    const db = createDatabase(pool);
    const [row] = await db.select({ id: club.id }).from(club).where(eq(club.slug, values.slug));
    if (row === undefined) throw new Error(`No club with slug "${values.slug}".`);
    const result = await installClubLogo({
      db,
      storage: createS3Storage(storageConfig),
      clubId: row.id,
      bytes,
      contentType,
      fileName: basename(values.file),
    });
    process.stdout.write(
      result.changed
        ? `Crest of ${values.slug} set (file ${result.fileId}).\n`
        : `${values.slug} already uses this crest.\n`,
    );
  } finally {
    await pool.end();
  }
} catch (error) {
  process.stderr.write(
    `Club crest failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
