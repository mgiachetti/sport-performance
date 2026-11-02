import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from '../client.js';
import { runMigrations } from '../migrate.js';
import { TENANT_SETTING_NAMES, provisionLoginRole, type DatabaseRoleKind } from '../roles.js';

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

export interface RoleConnection {
  /** Login created for this connection, member of the role. */
  readonly login: string;
  readonly connectionString: string;
  readonly pool: pg.Pool;
  /** Closes the pool and drops the login (roles are cluster-wide). */
  readonly close: () => Promise<void>;
}

/**
 * A pool that connects as a fresh login of a connection role (ADR 0026),
 * provisioned the way production does it.
 */
export async function connectAs(
  database: TestDatabase,
  role: DatabaseRoleKind,
  options: { max?: number } = {},
): Promise<RoleConnection> {
  const login = `sp_test_${role}_${randomBytes(5).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  await provisionLoginRole({ connectionString: url ?? '', login, password, role });
  const parsed = new URL(database.connectionString);
  parsed.username = login;
  parsed.password = password;
  const connectionString = parsed.toString();
  const pool = new pg.Pool({ connectionString, max: options.max ?? 2 });
  pool.on('error', () => undefined);
  return {
    login,
    connectionString,
    pool,
    close: async () => {
      await pool.end();
      await admin((client) => client.query(`drop role if exists "${login}"`));
    },
  };
}

/** The settings of a transaction; `null` writes `''` like the API's helper. */
export interface TestContext {
  readonly clubId?: string | null;
  readonly userId?: string | null;
  readonly role?: string | null;
}

/**
 * Runs `work` in a transaction that first sets the tenant context with
 * `set_config(..., true)`, as `apps/api` does. Rolls back when `work` throws.
 */
export async function inContext<T>(
  pool: pg.Pool,
  context: TestContext,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('${TENANT_SETTING_NAMES.clubId}', $1, true),
              set_config('${TENANT_SETTING_NAMES.userId}', $2, true),
              set_config('${TENANT_SETTING_NAMES.role}', $3, true)`,
      [context.clubId ?? '', context.userId ?? '', context.role ?? ''],
    );
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
