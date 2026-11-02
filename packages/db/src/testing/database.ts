import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from '../client.js';
import { TENANT_SETTING_NAMES, type DatabaseRoleKind } from '../roles.js';
import { createTemporaryDatabase, type TemporaryDatabase } from './temporary-database.js';

/**
 * Integration-test support: every test file gets its own throwaway database
 * on the Postgres 16 server of `DATABASE_URL` (Docker locally, the service
 * container in CI), so files run in parallel without sharing state. The
 * databases come from `./temporary-database.ts`, which closes every pool and
 * waits for its sockets before `DROP DATABASE ... WITH (FORCE)` (issue #147).
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
  /** The throwaway database: tracks its pools and logins. */
  readonly temporary: TemporaryDatabase;
  /**
   * Closes every pool over the database (waiting for their sockets), then
   * drops it `WITH (FORCE)` with its logins.
   */
  readonly drop: () => Promise<void>;
}

function serverUrl(): string {
  if (!hasDatabase || url === undefined) throw new Error('DATABASE_URL is not set.');
  return url;
}

function testDatabase(temporary: TemporaryDatabase): TestDatabase {
  return { connectionString: temporary.connectionString, temporary, drop: temporary.drop };
}

/** Creates an empty database (no migrations applied). */
export async function createEmptyDatabase(): Promise<TestDatabase> {
  return testDatabase(await createTemporaryDatabase({ serverUrl: serverUrl(), migrate: false }));
}

export interface MigratedTestDatabase extends TestDatabase {
  /** Owner pool (bypasses RLS). */
  readonly pool: pg.Pool;
  readonly db: Database;
  /** Same as `drop()`: closes the pools and drops the database. */
  readonly close: () => Promise<void>;
}

/** Creates a database with every migration applied and a typed client over it. */
export async function createMigratedDatabase(): Promise<MigratedTestDatabase> {
  const temporary = await createTemporaryDatabase({ serverUrl: serverUrl() });
  const pool = temporary.pool({ max: 4 });
  return { ...testDatabase(temporary), pool, db: createDatabase(pool), close: temporary.drop };
}

export interface RoleConnection {
  /** Login created for this connection, member of the role. */
  readonly login: string;
  readonly connectionString: string;
  readonly pool: pg.Pool;
  /** Closes the pool, waiting for its sockets. The login is dropped with the database. */
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
  const { login, connectionString } = await database.temporary.login(role);
  const pool = database.temporary.pool({ connectionString, max: options.max ?? 2 });
  return {
    login,
    connectionString,
    pool,
    close: () => database.temporary.closePool(pool),
  };
}

/** The settings of a transaction; `null` writes `''` like the API's helper. */
export interface TestContext {
  readonly clubId?: string | null;
  readonly userId?: string | null;
  readonly role?: string | null;
  /** `app.request_id`; defaults to a fresh id. `null` leaves it unset. */
  readonly requestId?: string | null;
  /**
   * Records the superadmin's support access (`app.begin_support_access`) with
   * this reason right after setting the context, as the API does.
   */
  readonly supportReason?: string;
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
              set_config('${TENANT_SETTING_NAMES.role}', $3, true),
              set_config('${TENANT_SETTING_NAMES.requestId}', $4, true)`,
      [
        context.clubId ?? '',
        context.userId ?? '',
        context.role ?? '',
        context.requestId === undefined
          ? `req-${randomBytes(6).toString('hex')}`
          : (context.requestId ?? ''),
      ],
    );
    if (context.supportReason !== undefined) {
      await client.query('select app.begin_support_access($1)', [context.supportReason]);
    }
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
