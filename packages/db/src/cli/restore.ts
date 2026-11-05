#!/usr/bin/env node
/**
 * `pnpm --filter @sport-performance/db db:restore <mark|verify|record>` (or
 * the `sport-performance-db-restore` bin): the tooling of a restore drill and
 * of the restore of an incident (B-702, ADR 0094, runbook in
 * `docs/ops/backups-y-recuperacion.md`). See `../restore-cli.ts` for the
 * options. Prints JSON; exits non-zero on failure or on a failing check.
 * Never prints a connection string.
 */
import { parseRestoreCommand, runRestoreCommand } from '../restore-cli.js';

try {
  const command = parseRestoreCommand(process.argv.slice(2), process.env);
  const result = await runRestoreCommand(command);
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Restore tool failed: ${message}\n`);
  process.exitCode = 1;
}
