#!/usr/bin/env node
/**
 * `pnpm --filter @sport-performance/db db:seed` (or the
 * `sport-performance-db-seed` bin): creates the ORC tenant if it does not
 * exist and seeds its default configuration (B-306). Idempotent: a second
 * run inserts nothing. Connects with `MIGRATIONS_DATABASE_URL` or
 * `DATABASE_URL` (the owner role: there is no request tenant context here)
 * and expects the migrations to be applied. Exits non-zero on failure and
 * never prints the connection string.
 */
import { migrationsConnectionString } from '../migrate.js';
import { runSeed } from '../seeds/run.js';

try {
  const { summary } = await runSeed({ connectionString: migrationsConnectionString() });
  process.stdout.write(`${summary}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Seed failed: ${message}\n`);
  process.exitCode = 1;
}
