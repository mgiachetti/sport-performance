import { parseArgs } from 'node:util';
import pg from 'pg';
import { migrationsConnectionString } from './migrate.js';
import {
  RESTORE_KINDS,
  RestoreToolError,
  isRestoreKind,
  recordRestoreEvent,
  verifyRestoredDatabase,
  writeRestoreDrillMarker,
  type RestoreKind,
} from './restore.js';

/**
 * The `sport-performance-db-restore` command (B-702, ADR 0094), parsed and
 * run here so it can be tested; `cli/restore.ts` only wires the process.
 *
 * ```text
 * sport-performance-db-restore mark   --environment=<env> [--label=<text>]
 * sport-performance-db-restore verify [--target=<iso>] [--present=<id,…>] [--absent=<id,…>]
 *                                     [--clock-skew-ms=<n>] [--no-row-counts]
 * sport-performance-db-restore record --kind=drill|incident --environment=<env>
 *                                     --target=<iso> --reason=<text>
 * ```
 *
 * - `mark` writes on the **source** database: `MIGRATIONS_DATABASE_URL` (or
 *   `DATABASE_URL`), the owner, like `db:migrate`.
 * - `verify` and `record` work on the **restored** database and only read
 *   `RESTORE_DATABASE_URL`: never a default that could point at the source.
 * - `--environment` defaults to `RAILWAY_ENVIRONMENT_NAME`.
 *
 * Prints JSON on stdout. `verify` exits 1 when a check fails. Connection
 * strings are never printed.
 */

export type RestoreCommand =
  | {
      readonly command: 'mark';
      readonly connectionString: string;
      readonly environment: string;
      readonly label?: string;
    }
  | {
      readonly command: 'verify';
      readonly connectionString: string;
      readonly recoveryTargetAt?: Date;
      readonly presentMarkerIds: readonly string[];
      readonly absentMarkerIds: readonly string[];
      readonly clockSkewMs?: number;
      readonly countRows: boolean;
    }
  | {
      readonly command: 'record';
      readonly connectionString: string;
      readonly kind: RestoreKind;
      readonly environment: string;
      readonly recoveryTargetAt: Date;
      readonly reason: string;
    };

export const RESTORE_USAGE = [
  'Usage:',
  '  sport-performance-db-restore mark   --environment=<env> [--label=<text>]',
  '  sport-performance-db-restore verify [--target=<iso>] [--present=<id,...>] [--absent=<id,...>]',
  '                                      [--clock-skew-ms=<n>] [--no-row-counts]',
  '  sport-performance-db-restore record --kind=drill|incident --environment=<env> --target=<iso> --reason=<text>',
  '',
  'mark writes on MIGRATIONS_DATABASE_URL (or DATABASE_URL); verify and record use RESTORE_DATABASE_URL.',
].join('\n');

function nonBlank(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v === undefined || v === '' ? undefined : v;
}

/**
 * An instant with an explicit offset (`2026-11-04T15:30:00Z`,
 * `2026-11-04T12:30:00-03:00`): a restore target read in the wrong zone is
 * a restore to the wrong point.
 */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseInstant(value: string, what: string): Date {
  const text = value.trim();
  const date = new Date(text);
  if (!INSTANT_PATTERN.test(text) || Number.isNaN(date.getTime())) {
    throw new RestoreToolError(
      `The ${what} must be an ISO 8601 instant with its offset (for example 2026-11-04T15:30:00Z).`,
    );
  }
  return date;
}

function idList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id !== '');
}

function required(value: string | undefined, what: string): string {
  const v = nonBlank(value);
  if (v === undefined) throw new RestoreToolError(`${what} is required.\n\n${RESTORE_USAGE}`);
  return v;
}

function restoredConnectionString(env: NodeJS.ProcessEnv): string {
  return required(env.RESTORE_DATABASE_URL, 'RESTORE_DATABASE_URL (the restored database)');
}

export function parseRestoreCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): RestoreCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      environment: { type: 'string' },
      label: { type: 'string' },
      target: { type: 'string' },
      present: { type: 'string' },
      absent: { type: 'string' },
      'clock-skew-ms': { type: 'string' },
      'no-row-counts': { type: 'boolean' },
      kind: { type: 'string' },
      reason: { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new RestoreToolError(RESTORE_USAGE);
  const environment = nonBlank(values.environment) ?? nonBlank(env.RAILWAY_ENVIRONMENT_NAME);
  switch (positionals[0]) {
    case 'mark': {
      const label = nonBlank(values.label);
      return {
        command: 'mark',
        connectionString: migrationsConnectionString(env),
        environment: required(environment, '--environment (or RAILWAY_ENVIRONMENT_NAME)'),
        ...(label !== undefined && { label }),
      };
    }
    case 'verify': {
      const target = nonBlank(values.target);
      const skew = nonBlank(values['clock-skew-ms']);
      let clockSkewMs: number | undefined;
      if (skew !== undefined) {
        clockSkewMs = Number(skew);
        if (!Number.isSafeInteger(clockSkewMs) || clockSkewMs < 0 || clockSkewMs > 600_000) {
          throw new RestoreToolError('--clock-skew-ms must be an integer between 0 and 600000.');
        }
      }
      const presentMarkerIds = idList(values.present);
      const absentMarkerIds = idList(values.absent);
      if ((presentMarkerIds.length > 0 || absentMarkerIds.length > 0) && target === undefined) {
        throw new RestoreToolError(
          '--present and --absent need the --target they were written around.',
        );
      }
      return {
        command: 'verify',
        connectionString: restoredConnectionString(env),
        ...(target !== undefined && { recoveryTargetAt: parseInstant(target, '--target') }),
        presentMarkerIds,
        absentMarkerIds,
        ...(clockSkewMs !== undefined && { clockSkewMs }),
        countRows: values['no-row-counts'] !== true,
      };
    }
    case 'record': {
      const kind = required(values.kind, '--kind');
      if (!isRestoreKind(kind)) {
        throw new RestoreToolError(`--kind must be one of ${RESTORE_KINDS.join(', ')}.`);
      }
      return {
        command: 'record',
        connectionString: restoredConnectionString(env),
        kind,
        environment: required(environment, '--environment (or RAILWAY_ENVIRONMENT_NAME)'),
        recoveryTargetAt: parseInstant(required(values.target, '--target'), '--target'),
        reason: required(values.reason, '--reason'),
      };
    }
    default:
      throw new RestoreToolError(RESTORE_USAGE);
  }
}

export interface RestoreCommandResult {
  /** JSON to print. */
  readonly output: unknown;
  /** `false` when a verification found a failing check. */
  readonly ok: boolean;
}

export async function runRestoreCommand(command: RestoreCommand): Promise<RestoreCommandResult> {
  const client = new pg.Client({
    connectionString: command.connectionString,
    application_name: `sport-performance-restore-${command.command}`,
  });
  // A dropped connection rejects the pending query; without a listener it would crash.
  client.on('error', () => undefined);
  await client.connect();
  try {
    switch (command.command) {
      case 'mark': {
        const marker = await writeRestoreDrillMarker(client, {
          environment: command.environment,
          ...(command.label !== undefined && { label: command.label }),
        });
        return {
          ok: true,
          output: { ...marker, createdAt: marker.createdAt.toISOString() },
        };
      }
      case 'verify': {
        const report = await verifyRestoredDatabase(client, {
          ...(command.recoveryTargetAt !== undefined && {
            recoveryTargetAt: command.recoveryTargetAt,
          }),
          presentMarkerIds: command.presentMarkerIds,
          absentMarkerIds: command.absentMarkerIds,
          ...(command.clockSkewMs !== undefined && { clockSkewMs: command.clockSkewMs }),
          countRows: command.countRows,
        });
        return { ok: report.ok, output: report };
      }
      case 'record': {
        const event = await recordRestoreEvent(client, {
          kind: command.kind,
          environment: command.environment,
          recoveryTargetAt: command.recoveryTargetAt,
          reason: command.reason,
        });
        return {
          ok: true,
          output: {
            ...event,
            recoveryTargetAt: event.recoveryTargetAt.toISOString(),
            recordedAt: event.recordedAt.toISOString(),
          },
        };
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
