import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.js';
import { provisionLoginRole, type DatabaseRoleKind } from '../roles.js';

/**
 * Throwaway databases for integration tests (`@sport-performance/db/testing`).
 *
 * Every test file creates its own database on the Postgres 16 server of
 * `DATABASE_URL` and drops it at the end with `DROP DATABASE ... WITH (FORCE)`.
 * Dropping is where the suites used to flake (issue #147):
 *
 * - `pool.end()` resolves as soon as the pool has *forgotten* its clients,
 *   before their sockets are closed. A `DROP ... WITH (FORCE)` right after it
 *   terminates those backends, the server answers with `57P01`
 *   (`admin_shutdown`) and, with no `error` listener on the pool, Node reports
 *   an unhandled error that fails the run even when every test passed.
 * - A pool or a client that the test never closed gets the same error.
 *
 * So every pool over a temporary database is *tracked*: it gets an `error`
 * listener on the pool and on each of its clients, and {@link
 * TemporaryDatabase.drop} ends the pool and waits until every socket is closed
 * before dropping. `57P01`, and any error once the teardown started, are
 * expected and absorbed; any other error of an idle connection is reported by
 * `drop()` instead of crashing the worker. A client still checked out when the
 * database is dropped (a leak in the test) is reported too.
 *
 * Setup under load was the other source of flakes: every migrated database
 * ran every migration, a dozen at a time when all packages test at once. A
 * migrated database is now a copy (`CREATE DATABASE ... TEMPLATE`) of a
 * template migrated once per server and set of migrations, see {@link
 * ensureMigratedTemplate}. The migration runner itself is still tested on
 * empty databases (`migrate: false`).
 */

/** Postgres `admin_shutdown`: the server terminated the backend (`WITH (FORCE)`, `pg_terminate_backend`). */
export const ADMIN_SHUTDOWN_CODE = '57P01';

/** How long `drop()` waits for a pool to end and its sockets to close before reporting a leak. */
export const POOL_CLOSE_TIMEOUT_MS = 15_000;

/**
 * Bump when the template must be rebuilt for a reason the migration files do
 * not show (for example a change in how the runner records migrations).
 */
const TEMPLATE_VERSION = 1;

/** Prefix of the migrated templates (`sp_tpl_<hash>`), one per set of migrations. */
export const TEMPLATE_PREFIX = 'sp_tpl_';

/** Advisory lock (in the server's database) that serializes building a template. */
const TEMPLATE_LOCK_KEY = 7_301_032_147n;

/** Whether `error` is the `57P01` of a backend the server terminated. */
export function isAdminShutdown(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === ADMIN_SHUTDOWN_CODE
  );
}

/** A pool under watch: its idle errors are captured and its sockets awaited on close. */
export interface TrackedPool {
  readonly pool: pg.Pool;
  /**
   * Errors of its connections that are not an expected termination, since
   * the last call (each error is reported once).
   */
  readonly takeUnexpectedErrors: () => Error[];
  /**
   * Ends the pool (unless it is already ending) and waits until every
   * connection it opened is closed. Rejects when that takes longer than
   * `timeoutMs`, which means a client was never released.
   */
  readonly close: (timeoutMs?: number) => Promise<void>;
  /** From now on every error of its connections is expected (the database is being dropped). */
  readonly expectTermination: () => void;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message()));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Starts tracking `pool`. Call it right after creating the pool, before it
 * opens connections: connections opened earlier are not awaited on close.
 */
export function trackPool(pool: pg.Pool, label = 'pool'): TrackedPool {
  // A set: an idle client reports through its own listener and the pool's.
  const unexpectedErrors = new Set<Error>();
  /** Sockets still open, each with a promise that settles when it closes. */
  const open = new Map<pg.PoolClient, Promise<void>>();
  let terminating = false;

  const onError = (error: Error) => {
    if (terminating || isAdminShutdown(error)) return;
    unexpectedErrors.add(error);
  };

  // Idle clients forward their errors to the pool.
  pool.on('error', onError);
  pool.on('connect', (client) => {
    // A checked-out client that is not running a query emits on itself.
    client.on('error', onError);
    open.set(
      client,
      new Promise<void>((resolve) => {
        client.once('end', () => {
          open.delete(client);
          resolve();
        });
      }),
    );
  });

  return {
    pool,
    takeUnexpectedErrors: () => {
      const errors = [...unexpectedErrors];
      unexpectedErrors.clear();
      return errors;
    },
    expectTermination: () => {
      terminating = true;
    },
    close: async (timeoutMs = POOL_CLOSE_TIMEOUT_MS) => {
      const ended = pool.ending ? Promise.resolve() : pool.end();
      await withTimeout(
        // `pool.end()` resolves before the sockets close: wait for each of them.
        ended.then(() => Promise.all(open.values())),
        timeoutMs,
        () =>
          `${label}: ${String(open.size)} connection(s) still open after ${String(timeoutMs)} ms ` +
          `(${String(pool.totalCount - pool.idleCount)} checked out and never released)`,
      );
    },
  };
}

export interface CreateTemporaryDatabaseOptions {
  /** Owner connection to the server (`DATABASE_URL`); creates and drops the database. */
  readonly serverUrl: string;
  /** Prefix of the database name; the suffix is random. */
  readonly prefix?: string;
  /**
   * With every migration of `packages/db` applied (a copy of the migrated
   * template) or empty. Default `true`.
   */
  readonly migrate?: boolean;
  /** How long closing a pool may take before it counts as a leak. Default {@link POOL_CLOSE_TIMEOUT_MS}. */
  readonly poolCloseTimeoutMs?: number;
}

export interface TemporaryLogin {
  /** Login created for this database, member of the connection role. Dropped with the database. */
  readonly login: string;
  readonly connectionString: string;
}

export interface TemporaryDatabase {
  readonly name: string;
  /** Owner connection to the new database (bypasses RLS). */
  readonly connectionString: string;
  /** A tracked pool over the database: as the owner, or over `connectionString`. */
  readonly pool: (options?: { connectionString?: string; max?: number }) => pg.Pool;
  /** Tracks a pool created elsewhere (the API's pools) so `drop()` closes it first. */
  readonly track: <T extends pg.Pool>(pool: T, label?: string) => T;
  /**
   * Closes a tracked pool now: ends it and waits until its sockets are closed.
   * Rejects when one of its connections failed unexpectedly or never closed.
   */
  readonly closePool: (pool: pg.Pool) => Promise<void>;
  /**
   * A fresh login of a connection role (ADR 0026), provisioned the way
   * production does it. Roles are cluster-wide: `drop()` drops it.
   */
  readonly login: (role: DatabaseRoleKind) => Promise<TemporaryLogin>;
  /**
   * Closes every tracked pool and waits for its sockets, drops the database
   * `WITH (FORCE)` and the logins. Idempotent. Rejects, after dropping, when a
   * connection leaked or an idle connection failed unexpectedly.
   */
  readonly drop: () => Promise<void>;
}

/** Runs `work` on a short-lived owner connection to the server. */
async function onServer<T>(serverUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: serverUrl, application_name: 'test-admin' });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function databaseUrl(serverUrl: string, database: string): string {
  const parsed = new URL(serverUrl);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Name of the template for the migrations of `folder`: changes with any migration file. */
export async function migratedTemplateName(folder = MIGRATIONS_FOLDER): Promise<string> {
  const hash = createHash('sha256').update(`template v${String(TEMPLATE_VERSION)}\n`);
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path, `${prefix}${entry.name}/`);
      } else {
        hash
          .update(`${prefix}${entry.name}\n`)
          .update(await readFile(path))
          .update('\n');
      }
    }
  };
  await walk(folder, '');
  return `${TEMPLATE_PREFIX}${hash.digest('hex').slice(0, 16)}`;
}

const templates = new Map<string, Promise<string>>();

/**
 * The template with every migration applied, built on first use. Concurrent
 * callers (test files of every package) wait on an advisory lock; one builds
 * it, the rest find it. A half-built template (a builder that died) is not
 * marked as template, so the next caller drops and rebuilds it. Once built it
 * accepts no connections, so copying it never fails because someone is
 * connected (autovacuum skips it too). Templates are kept between runs; an
 * outdated one is just never used again (each is a few MB of a throwaway
 * server).
 */
export function ensureMigratedTemplate(serverUrl: string): Promise<string> {
  let template = templates.get(serverUrl);
  if (template === undefined) {
    template = buildTemplate(serverUrl);
    templates.set(serverUrl, template);
    // A failure is not cached: the next caller tries again.
    template.catch(() => templates.delete(serverUrl));
  }
  return template;
}

async function buildTemplate(serverUrl: string): Promise<string> {
  const name = await migratedTemplateName();
  await onServer(serverUrl, async (client) => {
    const ready = async () =>
      (
        await client.query(
          'select 1 from pg_database where datname = $1 and datistemplate and not datallowconn',
          [name],
        )
      ).rowCount === 1;
    if (await ready()) return;
    await client.query('select pg_advisory_lock($1)', [TEMPLATE_LOCK_KEY]);
    try {
      if (await ready()) return;
      // Leftover of a builder that died midway.
      await client.query(`drop database if exists "${name}" with (force)`);
      await client.query(`create database "${name}"`);
      await runMigrations({ connectionString: databaseUrl(serverUrl, name) });
      await client.query(`alter database "${name}" with is_template true allow_connections false`);
    } finally {
      await client.query('select pg_advisory_unlock($1)', [TEMPLATE_LOCK_KEY]);
    }
  });
  return name;
}

/** Creates a database on `serverUrl` (migrated unless `migrate: false`). */
export async function createTemporaryDatabase(
  options: CreateTemporaryDatabaseOptions,
): Promise<TemporaryDatabase> {
  const { serverUrl, poolCloseTimeoutMs = POOL_CLOSE_TIMEOUT_MS } = options;
  const suffix = randomBytes(6).toString('hex');
  const name = `${options.prefix ?? 'sp_test'}_${suffix}`;
  if (!/^[a-z_][a-z0-9_]*$/.test(name) || name.length > 63) {
    throw new Error(`Invalid temporary database name: ${name}`);
  }
  const migrated = options.migrate ?? true;
  const template = migrated ? await ensureMigratedTemplate(serverUrl) : undefined;
  await onServer(serverUrl, (client) =>
    client.query(
      template === undefined
        ? `create database "${name}"`
        : `create database "${name}" template "${template}"`,
    ),
  );
  const connectionString = databaseUrl(serverUrl, name);

  const tracked: TrackedPool[] = [];
  const logins: string[] = [];
  let dropping: Promise<void> | undefined;

  const track = <T extends pg.Pool>(pool: T, label = 'pool'): T => {
    if (dropping !== undefined) throw new Error(`${name} is being dropped: no new pools.`);
    tracked.push(trackPool(pool, `${name} ${label}`));
    return pool;
  };

  const closePool = async (pool: pg.Pool): Promise<void> => {
    const entry = tracked.find((t) => t.pool === pool);
    if (entry === undefined) throw new Error(`The pool is not tracked by ${name}.`);
    await entry.close(poolCloseTimeoutMs);
    const errors = entry.takeUnexpectedErrors();
    if (errors.length > 0) {
      throw new AggregateError(errors, `Unexpected connection errors on ${name}`);
    }
  };

  const drop = async (): Promise<void> => {
    const problems: Error[] = [];
    // Close every pool first, so `WITH (FORCE)` terminates nothing of ours.
    const closed = await Promise.allSettled(tracked.map((t) => t.close(poolCloseTimeoutMs)));
    for (const result of closed) {
      if (result.status === 'rejected') problems.push(result.reason as Error);
    }
    for (const t of tracked) {
      problems.push(...t.takeUnexpectedErrors());
      // A leaked connection is about to be terminated: that error is expected.
      t.expectTermination();
    }
    await onServer(serverUrl, async (client) => {
      await client.query(`drop database if exists "${name}" with (force)`);
      for (const login of logins) await client.query(`drop role if exists "${login}"`);
    });
    if (problems.length > 0) {
      throw new AggregateError(
        problems,
        `Teardown of ${name}: ${String(problems.length)} problem(s)`,
      );
    }
  };

  const database: TemporaryDatabase = {
    name,
    connectionString,
    track,
    closePool,
    pool: (poolOptions = {}) =>
      track(
        new pg.Pool({
          connectionString: poolOptions.connectionString ?? connectionString,
          max: poolOptions.max ?? 4,
        }),
      ),
    login: async (role) => {
      const login = `${name}_${role}_${randomBytes(3).toString('hex')}`.slice(0, 63);
      const password = randomBytes(24).toString('hex');
      logins.push(login);
      await provisionLoginRole({ connectionString: serverUrl, login, password, role });
      const parsed = new URL(connectionString);
      parsed.username = login;
      parsed.password = password;
      return { login, connectionString: parsed.toString() };
    },
    drop: () => {
      dropping ??= drop();
      return dropping;
    },
  };

  return database;
}
