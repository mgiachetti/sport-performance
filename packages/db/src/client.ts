import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

/** Typed Drizzle database over the full schema. */
export type Database = NodePgDatabase<typeof schema>;

export interface CreatePoolOptions {
  /** Login of a connection role (ADR 0025), never the owner. Never logged. */
  readonly connectionString: string;
  /** Shown in `pg_stat_activity` (`sport-performance-api`, `sport-performance-worker`). */
  readonly applicationName?: string;
  readonly max?: number;
  /** How long to wait for a connection from the server. */
  readonly connectionTimeoutMs?: number;
  /** `statement_timeout` of every connection. */
  readonly statementTimeoutMs?: number;
  /**
   * `idle_in_transaction_session_timeout`: a caller that dies mid-transaction
   * must not hold locks forever.
   */
  readonly idleInTransactionTimeoutMs?: number;
  /**
   * Errors of idle pooled connections (for example the server restarted).
   * Without a listener they would crash the process.
   */
  readonly onIdleError?: (error: Error) => void;
}

/**
 * Connection pool for the API and the worker. They connect with a login of
 * their connection role (`sport_performance_app`, `sport_performance_worker`),
 * which is not the table owner and has no `BYPASSRLS` (ADR 0006, ADR 0025):
 * check it at startup with `assertConnectionRole()`. Every query runs inside a
 * transaction that first sets the tenant context with `set_config(..., true)`.
 */
export function createPool(options: CreatePoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName ?? 'sport-performance',
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.connectionTimeoutMs === undefined
      ? {}
      : { connectionTimeoutMillis: options.connectionTimeoutMs }),
    ...(options.statementTimeoutMs === undefined
      ? {}
      : { statement_timeout: options.statementTimeoutMs }),
    ...(options.idleInTransactionTimeoutMs === undefined
      ? {}
      : { idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs }),
  });
  pool.on('error', (error) => {
    options.onIdleError?.(error);
  });
  return pool;
}

/** Wraps a pool (or a single client, such as the connection of a transaction) with the typed schema. */
export function createDatabase(client: pg.Pool | pg.PoolClient | pg.Client): Database {
  return drizzle({ client, schema });
}
