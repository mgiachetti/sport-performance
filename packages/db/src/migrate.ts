import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * Migration runner (ADR 0004, ADR 0023). Used by the deploy of the API and
 * the worker, by CI and by the integration tests.
 *
 * - Applies the pending SQL migrations of `packages/db/drizzle` in order, all
 *   in one transaction (if one fails, none is applied), and records them in
 *   `drizzle.__drizzle_migrations`. Running it again is a no-op.
 * - Holds a session-level advisory lock while it runs, so two instances that
 *   start at the same time (API and worker, or two replicas) never apply the
 *   same migration twice: the second one waits and then finds nothing to do.
 * - Refuses to run when a local migration that is not applied is older than
 *   the latest applied one. Drizzle would skip it silently; that happens when
 *   two branches add migrations in parallel and merge out of order, or when
 *   an applied migration file was edited (its hash changes). Applied
 *   migrations are immutable: fix forward with a new one.
 * - Must connect as the role that owns the tables (`MIGRATIONS_DATABASE_URL`),
 *   never as a connection role, which has no DDL privileges (ADR 0026). It
 *   must be a superuser or have BYPASSRLS: migration 0004 checks it.
 */

/** Folder with the SQL migrations and drizzle-kit's journal, shipped with the package. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Where applied migrations are recorded (drizzle-kit's defaults, made explicit). */
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Key of the advisory lock that serializes migration runs. Arbitrary but
 * fixed: every runner of every version must use the same value.
 */
export const MIGRATION_LOCK_KEY = 7_301_032_001n;

export interface RunMigrationsOptions {
  /** Connection string of the table-owner role. Never logged. */
  readonly connectionString: string;
  /** Defaults to {@link MIGRATIONS_FOLDER}. */
  readonly migrationsFolder?: string;
}

export interface MigrationReport {
  /** Migrations applied by this run. */
  readonly applied: number;
  /** Migrations recorded in the database after the run. */
  readonly total: number;
  /**
   * Applied migrations this code does not know: the database is ahead (for
   * example during a rolling deploy or a rollback). Not an error.
   */
  readonly unknown: number;
}

/** A pending migration is older than the latest applied one, or an applied file changed. */
export class MigrationOrderError extends Error {
  override readonly name = 'MigrationOrderError';
  /** Journal timestamps (`when`) of the offending local migrations. */
  readonly migrations: readonly number[];

  constructor(migrations: readonly number[]) {
    super(
      `Refusing to migrate: ${String(migrations.length)} local migration(s) are not applied but are ` +
        `older than the latest applied one (journal "when": ${migrations.join(', ')}). ` +
        'Either migrations were merged out of order (regenerate the newer one) or an applied ' +
        'migration file was edited (restore it and add a new migration).',
    );
    this.migrations = migrations;
  }
}

interface AppliedMigration {
  readonly hash: string;
  readonly createdAt: number;
}

const QUALIFIED_TABLE = `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`;

async function readApplied(client: pg.Client): Promise<AppliedMigration[]> {
  const exists = await client.query<{ exists: boolean }>(
    'select to_regclass($1) is not null as exists',
    [QUALIFIED_TABLE],
  );
  if (exists.rows[0]?.exists !== true) return [];
  const result = await client.query<{ hash: string; created_at: string | null }>(
    `select hash, created_at from ${QUALIFIED_TABLE}`,
  );
  return result.rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at ?? 0) }));
}

function assertInOrder(local: readonly MigrationMeta[], applied: readonly AppliedMigration[]) {
  if (applied.length === 0) return;
  const appliedHashes = new Set(applied.map((m) => m.hash));
  const latestApplied = Math.max(...applied.map((m) => m.createdAt));
  const skipped = local.filter(
    (m) => !appliedHashes.has(m.hash) && m.folderMillis <= latestApplied,
  );
  if (skipped.length > 0) throw new MigrationOrderError(skipped.map((m) => m.folderMillis));
}

/** Applies every pending migration. Safe to call concurrently and repeatedly. */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationReport> {
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
  const local = readMigrationFiles({ migrationsFolder });
  const localHashes = new Set(local.map((m) => m.hash));

  const client = new pg.Client({
    connectionString: options.connectionString,
    application_name: 'sport-performance-migrate',
  });
  // Without a listener, a dropped connection would crash the process; the
  // pending query rejects anyway and that error is the one reported.
  client.on('error', () => undefined);
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY.toString()]);
    const unlock = () =>
      client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY.toString()]);
    let report: MigrationReport;
    try {
      const before = await readApplied(client);
      assertInOrder(local, before);
      await migrate(drizzle(client), {
        migrationsFolder,
        migrationsSchema: MIGRATIONS_SCHEMA,
        migrationsTable: MIGRATIONS_TABLE,
      });
      const after = await readApplied(client);
      report = {
        applied: after.length - before.length,
        total: after.length,
        unknown: after.filter((m) => !localHashes.has(m.hash)).length,
      };
    } catch (error) {
      // If the connection dropped, unlocking fails too (and the session lock
      // is released anyway): keep the run's error, the one worth reporting.
      await unlock().catch(() => undefined);
      throw error;
    }
    await unlock();
    return report;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * The connection string for migrations: `MIGRATIONS_DATABASE_URL` (owner
 * role) or, when it is not set or blank (as in `.env.example`),
 * `DATABASE_URL` (local development and CI, where a single role owns
 * everything).
 */
export function migrationsConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const url = nonBlank(env.MIGRATIONS_DATABASE_URL) ?? nonBlank(env.DATABASE_URL);
  if (url === undefined) {
    throw new Error('Set MIGRATIONS_DATABASE_URL (or DATABASE_URL) to run the migrations.');
  }
  return url;
}
