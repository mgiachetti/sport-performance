import type pg from 'pg';
import { DATABASE_ROLES } from './roles.js';

/**
 * The job queue (ADR 0011, ADR 0045): pg-boss in its own schema of the same
 * Postgres. It is installed and upgraded here, by the migration runner and as
 * the owner, never by the worker: the worker's login has no DDL privileges
 * (ADR 0026), so it starts pg-boss with `migrate: false` and refuses to run
 * against a schema of another version.
 */

/** Schema of pg-boss's tables. Not `public`: the RLS catalog tests enumerate that one. */
export const JOB_QUEUE_SCHEMA = 'pgboss';

/** Statements that leave the worker as the only connection role that reaches the queue. */
const GRANTS = [
  `REVOKE ALL ON SCHEMA "${JOB_QUEUE_SCHEMA}" FROM PUBLIC`,
  `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "${JOB_QUEUE_SCHEMA}" FROM PUBLIC`,
  `GRANT USAGE ON SCHEMA "${JOB_QUEUE_SCHEMA}" TO "${DATABASE_ROLES.worker}"`,
  // pg-boss inserts, fetches, completes, schedules and prunes jobs: plain DML. No TRUNCATE,
  // REFERENCES or TRIGGER, and no CREATE on the schema (partitioned queues are not used).
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${JOB_QUEUE_SCHEMA}" TO "${DATABASE_ROLES.worker}"`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${JOB_QUEUE_SCHEMA}" TO "${DATABASE_ROLES.worker}"`,
  `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "${JOB_QUEUE_SCHEMA}" TO "${DATABASE_ROLES.worker}"`,
] as const;

export interface InstallJobQueueOptions {
  /** Connection string of the owner role (`MIGRATIONS_DATABASE_URL`). Never logged. */
  readonly connectionString: string;
  /**
   * Connection of the migration run, used for the grants. Its session holds
   * the migration lock, so two runners never install at the same time.
   */
  readonly client: pg.Client;
}

/**
 * Installs pg-boss, or upgrades it to the version this package pins, and
 * re-applies the grants (an upgrade may add tables or functions). Idempotent.
 * Returns the schema version pg-boss reports.
 */
export async function installJobQueue(options: InstallJobQueueOptions): Promise<number> {
  // Loaded on demand: the API imports this package and never needs pg-boss.
  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: JOB_QUEUE_SCHEMA,
    application_name: 'sport-performance-migrate-queue',
    max: 2,
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
    persistWarnings: false,
  });
  // Without a listener an error event would crash the process; start() rejects anyway.
  boss.on('error', () => undefined);
  await boss.start();
  await boss.stop({ graceful: true, timeout: 30_000 });

  for (const statement of GRANTS) await options.client.query(statement);
  const { rows } = await options.client.query<{ version: number }>(
    `select max(version)::int as version from "${JOB_QUEUE_SCHEMA}".version`,
  );
  const version = rows[0]?.version;
  if (version === undefined) throw new Error('pg-boss did not record its schema version.');
  return version;
}
