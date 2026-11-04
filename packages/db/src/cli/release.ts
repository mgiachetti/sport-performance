#!/usr/bin/env node
/**
 * `pnpm --filter @sport-performance/db db:release` (or the
 * `sport-performance-db-release` bin): the database step of a deploy
 * (B-701, ADR 0087), run by Railway as the API's pre-deploy command.
 * Migrates as the owner (`MIGRATIONS_DATABASE_URL`), provisions the logins
 * of `DATABASE_URL` (app), `AUTH_DATABASE_URL` (auth) and
 * `WORKER_DATABASE_URL` (worker), and declares the database's environment
 * (`RAILWAY_ENVIRONMENT_NAME`). Exits non-zero on failure, which stops the
 * deploy. Never prints a password or a connection string.
 */
import { describeRelease, releaseDatabase, releasePlanFromEnv } from '../release.js';

try {
  const report = await releaseDatabase(releasePlanFromEnv(process.env));
  process.stdout.write(describeRelease(report));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Release failed: ${message}\n`);
  process.exitCode = 1;
}
