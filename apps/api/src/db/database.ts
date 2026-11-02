import {
  createDatabase,
  createPool,
  type Database as DrizzleDatabase,
} from '@sport-performance/db';
import type pg from 'pg';
import {
  SET_TENANT_CONTEXT_SQL,
  tenantContextParameters,
  type TenantContext,
} from './tenant-context.js';

/**
 * Connection handed to the work of a transaction. It is a node-postgres
 * `PoolClient`, so the Drizzle client of `packages/db` wraps it as is
 * (`drizzle(client, { schema })`). Do not release it, commit or roll back
 * from inside the work: the transaction helper owns its lifecycle.
 */
export type TransactionClient = pg.PoolClient;

/**
 * The only way the API reaches Postgres (ADR 0006). Every query runs inside
 * {@link Database.transaction}, which fixes the tenant context first.
 */
export interface Database {
  /**
   * Runs `work` in a transaction whose first statement sets `app.club_id`,
   * `app.user_id` and `app.role` with `SET LOCAL` semantics. Commits when
   * `work` resolves, rolls back when it throws. The settings die with the
   * transaction, so the pooled connection never carries them to another request.
   */
  transaction<T>(
    context: TenantContext,
    work: (client: TransactionClient) => Promise<T>,
  ): Promise<T>;
  /** Resolves when the database answers a trivial query within `timeoutMs`. */
  ping(timeoutMs: number): Promise<void>;
  /** Waits for checked-out connections to return and closes the pool. */
  close(): Promise<void>;
}

/** Thrown when `work` swallowed an SQL error and the transaction could not commit. */
export class TransactionAbortedError extends Error {
  override readonly name = 'TransactionAbortedError';
  constructor() {
    super(
      'The transaction was aborted by an earlier error and was rolled back instead of committed',
    );
  }
}

export class DatabaseTimeoutError extends Error {
  override readonly name = 'DatabaseTimeoutError';
}

export interface PgDatabaseOptions {
  url: string;
  poolMax: number;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  /** Shown in `pg_stat_activity`. */
  applicationName?: string;
  /** Called for errors of idle pooled connections (e.g. the server restarted). */
  onIdleError?: (error: Error) => void;
}

/** Wraps a `pg.Pool` you own (tests, or `packages/db` sharing its pool). */
export function databaseFromPool(pool: pg.Pool): Database {
  return {
    async transaction<T>(context: TenantContext, work: (client: TransactionClient) => Promise<T>) {
      // Validate before checking out a connection: a bad context never reaches the database.
      const parameters = tenantContextParameters(context);
      const client = await pool.connect();
      let broken: Error | undefined;
      // The pool only listens for errors of idle clients. A connection lost while
      // checked out emits `error` too: without a listener it would crash the process.
      // The pending query rejects with it, so it surfaces through `work` anyway.
      const onError = (error: Error) => {
        broken = error;
      };
      client.on('error', onError);
      try {
        await client.query('begin');
        await client.query(SET_TENANT_CONTEXT_SQL, parameters);
        const result = await work(client);
        const commit = await client.query('commit');
        // Postgres answers COMMIT of an aborted transaction with ROLLBACK, not an error.
        if (commit.command === 'ROLLBACK') throw new TransactionAbortedError();
        return result;
      } catch (error) {
        try {
          await client.query('rollback');
        } catch (rollbackError) {
          // The connection is in an unknown state: destroy it instead of returning it to the pool.
          broken =
            rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        throw error;
      } finally {
        client.off('error', onError);
        client.release(broken);
      }
    },

    async ping(timeoutMs: number) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new DatabaseTimeoutError(`Database did not answer within ${String(timeoutMs)} ms`),
          );
        }, timeoutMs);
      });
      try {
        await Promise.race([pool.query('select 1'), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },

    async close() {
      await pool.end();
    },
  };
}

/**
 * The pool of the API, from `@sport-performance/db`. `options.url` must be a
 * login of `sport_performance_app` (ADR 0025): `main.ts` checks it with
 * `assertConnectionRole` before serving.
 */
export function createApiPool(options: PgDatabaseOptions): pg.Pool {
  return createPool({
    connectionString: options.url,
    max: options.poolMax,
    connectionTimeoutMs: options.connectTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
    // A request that dies mid-transaction must not hold locks forever.
    idleInTransactionTimeoutMs: options.statementTimeoutMs,
    applicationName: options.applicationName ?? 'sport-performance-api',
    ...(options.onIdleError === undefined ? {} : { onIdleError: options.onIdleError }),
  });
}

/** Creates the pool of the API and its {@link Database}. */
export function createPgDatabase(options: PgDatabaseOptions): Database {
  return databaseFromPool(createApiPool(options));
}

/** Typed Drizzle client of `@sport-performance/db`, bound to one transaction. */
export type TenantDatabase = DrizzleDatabase;

const drizzleByClient = new WeakMap<TransactionClient, TenantDatabase>();

/**
 * The Drizzle client over the connection of a transaction: its queries run
 * in that transaction, with its tenant context. Cached per pooled connection,
 * so building the schema's relational config happens once per connection, not
 * once per request.
 */
export function tenantDatabase(client: TransactionClient): TenantDatabase {
  let db = drizzleByClient.get(client);
  if (db === undefined) {
    db = createDatabase(client);
    drizzleByClient.set(client, db);
  }
  return db;
}
