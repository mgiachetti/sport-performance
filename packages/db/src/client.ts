import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

/** Typed Drizzle database over the full schema. */
export type Database = NodePgDatabase<typeof schema>;

export interface CreatePoolOptions {
  readonly connectionString: string;
  /** Shown in `pg_stat_activity` (`api`, `worker`). */
  readonly applicationName?: string;
  readonly max?: number;
}

/**
 * Connection pool for the API and the worker. They connect with the
 * application role, which is not the table owner and has no `BYPASSRLS`
 * (ADR 0006); the per-request transaction that sets `app.club_id`,
 * `app.user_id` and `app.role` is added by #33 on top of this pool.
 */
export function createPool(options: CreatePoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName ?? 'sport-performance',
    ...(options.max === undefined ? {} : { max: options.max }),
  });
}

/** Wraps a pool (or a single client) with the typed schema. */
export function createDatabase(client: pg.Pool | pg.PoolClient | pg.Client): Database {
  return drizzle({ client, schema });
}
