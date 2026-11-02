#!/usr/bin/env node
/**
 * `pnpm --filter @sport-performance/db db:migrate` (or the
 * `sport-performance-db-migrate` bin): applies pending migrations using
 * `MIGRATIONS_DATABASE_URL` or `DATABASE_URL`. Exits non-zero on failure.
 * Never prints the connection string.
 */
import { migrationsConnectionString, runMigrations } from '../migrate.js';

try {
  const report = await runMigrations({ connectionString: migrationsConnectionString() });
  process.stdout.write(
    `Migrations: ${String(report.applied)} applied, ${String(report.total)} in the database; ` +
      `job queue at version ${String(report.jobQueueVersion)}.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
}
