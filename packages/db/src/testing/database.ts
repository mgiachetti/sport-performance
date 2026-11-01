import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from '../client.js';
import { runMigrations } from '../migrate.js';

/**
 * Integration-test support: every test file gets its own throwaway database
 * on the Postgres 16 server of `DATABASE_URL` (Docker locally, the service
 * container in CI), so files run in parallel without sharing state.
 *
 * Without `DATABASE_URL` the integration suites are skipped locally, but in
 * CI (`CI` set) they fail: a missing database must never pass as green.
 */

const url = process.env.DATABASE_URL;

export const hasDatabase = url !== undefined && url.trim() !== '';

if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: integration tests run against real Postgres.');
}

export interface TestDatabase {
  readonly connectionString: string;
  /** Drops the database, terminating open connections. */
  readonly drop: () => Promise<void>;
}

function withDatabase(connectionString: string, database: string): string {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function admin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  if (!hasDatabase || url === undefined) throw new Error('DATABASE_URL is not set.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Creates an empty database (no migrations applied). */
export async function createEmptyDatabase(): Promise<TestDatabase> {
  if (url === undefined) throw new Error('DATABASE_URL is not set.');
  const name = `sp_test_${randomBytes(6).toString('hex')}`;
  await admin((client) => client.query(`create database "${name}"`));
  return {
    connectionString: withDatabase(url, name),
    drop: async () => {
      await admin((client) => client.query(`drop database if exists "${name}" with (force)`));
    },
  };
}

export interface MigratedTestDatabase extends TestDatabase {
  readonly pool: pg.Pool;
  readonly db: Database;
  /** Closes the pool and drops the database. */
  readonly close: () => Promise<void>;
}

/** Creates a database with every migration applied and a typed client over it. */
export async function createMigratedDatabase(): Promise<MigratedTestDatabase> {
  const database = await createEmptyDatabase();
  await runMigrations({ connectionString: database.connectionString });
  const pool = new pg.Pool({ connectionString: database.connectionString, max: 4 });
  return {
    ...database,
    pool,
    db: createDatabase(pool),
    close: async () => {
      await pool.end();
      await database.drop();
    },
  };
}

/** Narrows a value the test knows is present (`returning()` rows, lookups). */
export function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label} to be present.`);
  return value;
}

/** The Postgres error code (`23503`, `23514`…) of a failed promise. */
export async function pgErrorOf(promise: Promise<unknown>): Promise<{
  code: string | undefined;
  constraint: string | undefined;
}> {
  try {
    await promise;
  } catch (error) {
    // Drizzle wraps driver errors; the pg error is the cause.
    const candidate: unknown =
      error instanceof Error && error.cause !== undefined ? error.cause : error;
    if (candidate instanceof pg.DatabaseError) {
      return { code: candidate.code, constraint: candidate.constraint };
    }
    throw error;
  }
  throw new Error('Expected the statement to fail, but it succeeded.');
}
