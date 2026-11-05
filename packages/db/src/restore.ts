import { readMigrationFiles } from 'drizzle-orm/migrator';
import type pg from 'pg';
import { JOB_QUEUE_SCHEMA } from './job-queue.js';
import { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from './migrate.js';
import { DATABASE_ROLES } from './roles.js';
import { DATABASE_ENVIRONMENT_SETTING } from './seeds/demo/guard.js';

/**
 * Backups and recovery (B-702, ADR 0094): the tooling of a restore drill and
 * of the restore of an incident, over the `ops` schema of migration
 * `0051_restore_drills`. Everything here runs as the owner of the database
 * (a superuser or a role with BYPASSRLS, like the migration runner): it reads
 * every club and the `medical` schema to count rows, and it never returns a
 * row's content, only table names, counts and timestamps.
 *
 * - {@link writeRestoreDrillMarker}: on the source database, before and after
 *   the point a drill restores to.
 * - {@link verifyRestoredDatabase}: on the restored copy. Reads the facts
 *   ({@link readRestoreFacts}) and judges them ({@link evaluateRestore}).
 * - {@link recordRestoreEvent}: on the restored copy, once, before it serves
 *   traffic: it changes the sync epoch (`app.sync_epoch()`).
 */

/** Anything that runs a query: a pool, a client or a pool client. */
export type Queryable = Pick<pg.ClientBase, 'query'>;

/** Why a restore was made: a scheduled drill or the recovery from an incident. */
export const RESTORE_KINDS = ['drill', 'incident'] as const;
export type RestoreKind = (typeof RESTORE_KINDS)[number];

export function isRestoreKind(value: unknown): value is RestoreKind {
  return typeof value === 'string' && (RESTORE_KINDS as readonly string[]).includes(value);
}

/** Same rule as the `ops` tables' checks: a Railway environment name. */
const ENVIRONMENT_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
export const RESTORE_LABEL_MAX_LENGTH = 200;
export const RESTORE_REASON_MAX_LENGTH = 500;
/**
 * Default tolerance between the restore target and the latest write found:
 * the clocks of the members of an HA cluster may drift a little.
 */
export const RESTORE_CLOCK_SKEW_MS_DEFAULT = 5_000;
/** Schemas whose tables are counted and whose timestamps give the recovery point. */
export const RESTORE_DATA_SCHEMAS = ['public', 'medical', 'support', 'ops'] as const;

/** A restore tool used wrongly (bad input, wrong database or wrong connection). */
export class RestoreToolError extends Error {
  override readonly name = 'RestoreToolError';
}

function normalizedEnvironment(environment: string): string {
  const value = environment.trim().toLowerCase();
  if (!ENVIRONMENT_PATTERN.test(value)) {
    throw new RestoreToolError(`Invalid environment name "${environment}".`);
  }
  return value;
}

/**
 * The environment the database declares (`app.deployment_environment`, ADR
 * 0055) or `null`. A physical restore keeps it: a copy of production says
 * `production`.
 */
async function databaseEnvironment(client: Queryable): Promise<string | null> {
  const { rows } = await client.query<{ value: string | null }>(
    'select nullif(current_setting($1, true), $2) as value',
    [DATABASE_ENVIRONMENT_SETTING, ''],
  );
  return rows[0]?.value?.trim().toLowerCase() ?? null;
}

/**
 * The environment to record: the one given, which must match the one the
 * database declares, if it declares one. Refusing a mismatch keeps a marker
 * meant for staging out of production and the other way around.
 */
async function resolveEnvironment(client: Queryable, given: string): Promise<string> {
  const environment = normalizedEnvironment(given);
  const declared = await databaseEnvironment(client);
  if (declared !== null && declared !== environment) {
    throw new RestoreToolError(
      `The database declares environment "${declared}", not "${environment}": refusing to write.`,
    );
  }
  return environment;
}

async function assertOwnerConnection(client: Queryable): Promise<void> {
  const { rows } = await client.query<{ can: boolean }>(
    'select (rolsuper or rolbypassrls) as can from pg_roles where rolname = current_user',
  );
  if (rows[0]?.can !== true) {
    throw new RestoreToolError(
      'Connect as the owner of the database (a superuser or a role with BYPASSRLS): ' +
        'under RLS the counts and checks would be wrong.',
    );
  }
}

function optionalText(value: string | undefined, max: number, what: string): string | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (text === '') return null;
  if (text.length > max) throw new RestoreToolError(`The ${what} is longer than ${String(max)}.`);
  return text;
}

export interface RestoreDrillMarker {
  readonly id: string;
  readonly environment: string;
  readonly label: string | null;
  readonly createdAt: Date;
}

export interface WriteRestoreDrillMarkerOptions {
  /** The environment of the source database (`staging`, `production`…). */
  readonly environment: string;
  /** What the marker is for (`before`, `after`, the drill's date). No personal data. */
  readonly label?: string;
}

/**
 * Writes a drill marker on the source database and returns it. Run it in
 * its own transaction (autocommit): the marker counts from its commit.
 */
export async function writeRestoreDrillMarker(
  client: Queryable,
  options: WriteRestoreDrillMarkerOptions,
): Promise<RestoreDrillMarker> {
  await assertOwnerConnection(client);
  const environment = await resolveEnvironment(client, options.environment);
  const label = optionalText(options.label, RESTORE_LABEL_MAX_LENGTH, 'label');
  const { rows } = await client.query<{ id: string; created_at: Date }>(
    `insert into "ops"."restore_drill_marker" (environment, label) values ($1, $2)
     returning id, created_at`,
    [environment, label],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('The drill marker was not written.');
  return { id: row.id, environment, label, createdAt: row.created_at };
}

export interface RecordRestoreEventOptions {
  readonly kind: RestoreKind;
  /** The environment of the restored database. */
  readonly environment: string;
  /** The point the database was restored to. */
  readonly recoveryTargetAt: Date;
  /** Why (the drill, the incident). No personal data. */
  readonly reason: string;
}

export interface RestoreEvent {
  readonly id: string;
  readonly kind: RestoreKind;
  readonly environment: string;
  readonly recoveryTargetAt: Date;
  readonly recordedAt: Date;
}

/**
 * Records, on a restored database, that it was restored. Changes the sync
 * epoch, so every device restarts its sync from scratch (ADR 0050, 0094):
 * their cursors point into a history this database no longer has.
 */
export async function recordRestoreEvent(
  client: Queryable,
  options: RecordRestoreEventOptions,
): Promise<RestoreEvent> {
  if (!isRestoreKind(options.kind)) {
    throw new RestoreToolError(`Invalid restore kind "${String(options.kind)}".`);
  }
  if (Number.isNaN(options.recoveryTargetAt.getTime())) {
    throw new RestoreToolError('Invalid recovery target.');
  }
  const reason = optionalText(options.reason, RESTORE_REASON_MAX_LENGTH, 'reason');
  if (reason === null) throw new RestoreToolError('A reason is required.');
  await assertOwnerConnection(client);
  const environment = await resolveEnvironment(client, options.environment);
  const { rows } = await client.query<{ id: string; recorded_at: Date }>(
    `insert into "ops"."restore_event" (kind, environment, recovery_target_at, reason)
     values ($1, $2, $3, $4) returning id, recorded_at`,
    [options.kind, environment, options.recoveryTargetAt, reason],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('The restore event was not recorded.');
  return {
    id: row.id,
    kind: options.kind,
    environment,
    recoveryTargetAt: options.recoveryTargetAt,
    recordedAt: row.recorded_at,
  };
}

// ─── Verification ────────────────────────────────────────────────────────────────────

export interface VerifyRestoreOptions {
  /** The point the database was restored to: no write found may be later. */
  readonly recoveryTargetAt?: Date;
  /** Markers written before the target: they must be in the restored copy. */
  readonly presentMarkerIds?: readonly string[];
  /** Markers written after the target: they must not be. */
  readonly absentMarkerIds?: readonly string[];
  /** Tolerance for the recovery point, default {@link RESTORE_CLOCK_SKEW_MS_DEFAULT}. */
  readonly clockSkewMs?: number;
  /** Count the rows of every table (default `true`; exact `count(*)`). */
  readonly countRows?: boolean;
  /** Defaults to the package's migrations. */
  readonly migrationsFolder?: string;
}

/** What a verification reads from the restored database. No row content. */
export interface RestoreFacts {
  readonly checkedAt: Date;
  readonly environment: string | null;
  readonly serverVersion: string;
  readonly sizeBytes: number;
  /** `pg_is_in_recovery()`: still replaying, or a standby. */
  readonly inRecovery: boolean;
  /** Hashes of the migrations this code ships, in order. */
  readonly localMigrations: readonly string[];
  /** Hashes recorded in the database's migrations journal. */
  readonly appliedMigrations: readonly string[];
  /** pg-boss schema version, `null` when the queue is not installed. */
  readonly jobQueueVersion: number | null;
  /** Each connection role: whether it exists and how many logins are members. */
  readonly roles: readonly {
    readonly role: string;
    readonly exists: boolean;
    readonly logins: number;
  }[];
  /** Club tables (`public` with `club_id`, and `medical`) without RLS enabled and forced. */
  readonly tablesWithoutRls: readonly string[];
  /** User triggers that are disabled. */
  readonly disabledTriggers: readonly string[];
  /** How many user triggers there are (a database restored without them has none). */
  readonly triggerCount: number;
  /** The requested markers found, with their time. */
  readonly markersFound: readonly { readonly id: string; readonly createdAt: Date }[];
  /** Latest `created_at` / `updated_at` of any data table: the effective recovery point. */
  readonly latestWriteAt: Date | null;
  /** Restores already recorded on this database. */
  readonly restoreEvents: number;
  /** Rows per table (`schema.table`), when counted. */
  readonly tables: readonly { readonly table: string; readonly rows: number }[];
}

export type RestoreCheckStatus = 'pass' | 'warn' | 'fail';

export const RESTORE_CHECK_NAMES = [
  'recovery_finished',
  'migrations',
  'job_queue',
  'connection_roles',
  'row_level_security',
  'triggers',
  'drill_markers',
  'recovery_point',
] as const;
export type RestoreCheckName = (typeof RESTORE_CHECK_NAMES)[number];

export interface RestoreCheck {
  readonly name: RestoreCheckName;
  readonly status: RestoreCheckStatus;
  readonly detail: string;
}

/** The report of a verification: JSON-ready, without personal data. */
export interface RestoreVerificationReport {
  /** No check failed (warnings are allowed). */
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly database: {
    readonly environment: string | null;
    readonly serverVersion: string;
    readonly sizeBytes: number;
    readonly restoreEventsRecorded: number;
  };
  readonly recoveryTargetAt: string | null;
  readonly latestWriteAt: string | null;
  /** Target minus latest write, in seconds: how much before the target the last write was. */
  readonly secondsBetweenLatestWriteAndTarget: number | null;
  readonly checks: readonly RestoreCheck[];
  readonly tables: readonly { readonly table: string; readonly rows: number }[];
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertMarkerIds(ids: readonly string[]): void {
  const bad = ids.filter((id) => !UUID_PATTERN.test(id));
  if (bad.length > 0) throw new RestoreToolError(`Invalid marker id(s): ${bad.join(', ')}.`);
}

/** Reads what {@link evaluateRestore} judges. Read-only; run it as the owner. */
export async function readRestoreFacts(
  client: Queryable,
  options: VerifyRestoreOptions = {},
): Promise<RestoreFacts> {
  const markerIds = [...(options.presentMarkerIds ?? []), ...(options.absentMarkerIds ?? [])];
  assertMarkerIds(markerIds);
  await assertOwnerConnection(client);

  const server = await client.query<{
    now: Date;
    version: string;
    size: string;
    in_recovery: boolean;
  }>(
    `select now() as now, current_setting('server_version') as version,
            pg_database_size(current_database())::text as size, pg_is_in_recovery() as in_recovery`,
  );
  const serverRow = server.rows[0];
  if (serverRow === undefined) throw new Error('Could not read the server.');

  const localMigrations = readMigrationFiles({
    migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
  }).map((m) => m.hash);
  const journal = `${quoteIdent(MIGRATIONS_SCHEMA)}.${quoteIdent(MIGRATIONS_TABLE)}`;
  const journalExists = await client.query<{ exists: boolean }>(
    'select to_regclass($1) is not null as exists',
    [journal],
  );
  const appliedMigrations =
    journalExists.rows[0]?.exists === true
      ? (await client.query<{ hash: string }>(`select hash from ${journal} order by id`)).rows.map(
          (r) => r.hash,
        )
      : [];

  const queueTable = `${quoteIdent(JOB_QUEUE_SCHEMA)}.version`;
  const queueExists = await client.query<{ exists: boolean }>(
    'select to_regclass($1) is not null as exists',
    [queueTable],
  );
  const jobQueueVersion =
    queueExists.rows[0]?.exists === true
      ? ((
          await client.query<{ version: number | null }>(
            `select max(version)::int as version from ${queueTable}`,
          )
        ).rows[0]?.version ?? null)
      : null;

  const roles = await client.query<{ role: string; exists: boolean; logins: number }>(
    `select g.name as role, r.oid is not null as exists,
            (select count(*)::int from pg_auth_members m join pg_roles l on l.oid = m.member
              where m.roleid = r.oid and l.rolcanlogin) as logins
       from unnest($1::text[]) as g(name) left join pg_roles r on r.rolname = g.name
      order by 1`,
    [Object.values(DATABASE_ROLES)],
  );

  const rls = await client.query<{ table: string }>(
    `select n.nspname || '.' || c.relname as table
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and (n.nspname = 'medical'
             or (n.nspname = 'public' and exists (
                   select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped)))
        and not (c.relrowsecurity and c.relforcerowsecurity)
      order by 1`,
  );

  const triggers = await client.query<{ name: string; enabled: string }>(
    `select n.nspname || '.' || c.relname || '.' || t.tgname as name, t.tgenabled as enabled
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname = any($1::text[])
      order by 1`,
    [RESTORE_DATA_SCHEMAS],
  );

  const opsExists = await client.query<{ markers: boolean; events: boolean }>(
    `select to_regclass('"ops"."restore_drill_marker"') is not null as markers,
            to_regclass('"ops"."restore_event"') is not null as events`,
  );
  const markersFound =
    opsExists.rows[0]?.markers === true && markerIds.length > 0
      ? (
          await client.query<{ id: string; created_at: Date }>(
            `select id, created_at from "ops"."restore_drill_marker"
              where id = any($1::uuid[]) order by created_at, id`,
            [markerIds],
          )
        ).rows.map((r) => ({ id: r.id, createdAt: r.created_at }))
      : [];
  const restoreEvents =
    opsExists.rows[0]?.events === true
      ? ((await client.query<{ n: number }>('select count(*)::int as n from "ops"."restore_event"'))
          .rows[0]?.n ?? 0)
      : 0;

  // Every data table and its timestamp columns, from the catalog: a table added later is
  // counted without changing this code.
  const columns = await client.query<{ schema: string; table: string; columns: string[] | null }>(
    `select n.nspname as schema, c.relname as table,
            array_agg(a.attname::text order by a.attname)
              filter (where a.attname in ('created_at', 'updated_at')
                        and a.atttypid = 'timestamptz'::regtype) as columns
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relkind in ('r', 'p') and not c.relispartition and n.nspname = any($1::text[])
      group by 1, 2 order by 1, 2`,
    [RESTORE_DATA_SCHEMAS],
  );
  const stamped = columns.rows.filter((r) => (r.columns ?? []).length > 0);
  let latestWriteAt: Date | null = null;
  if (stamped.length > 0) {
    const parts = stamped.map(
      (r) =>
        `select max(greatest(${(r.columns ?? []).map(quoteIdent).join(', ')})) as at ` +
        `from ${quoteIdent(r.schema)}.${quoteIdent(r.table)}`,
    );
    const latest = await client.query<{ at: Date | null }>(
      `select max(at) as at from (${parts.join(' union all ')}) s`,
    );
    latestWriteAt = latest.rows[0]?.at ?? null;
  }

  let tables: { table: string; rows: number }[] = [];
  if (options.countRows !== false && columns.rows.length > 0) {
    const parts = columns.rows.map(
      (r) =>
        `select '${`${r.schema}.${r.table}`.replaceAll("'", "''")}' as table, ` +
        `count(*)::bigint::text as rows from ${quoteIdent(r.schema)}.${quoteIdent(r.table)}`,
    );
    const counts = await client.query<{ table: string; rows: string }>(
      `${parts.join(' union all ')} order by 1`,
    );
    tables = counts.rows.map((r) => ({ table: r.table, rows: Number(r.rows) }));
  }

  return {
    checkedAt: serverRow.now,
    environment: await databaseEnvironment(client),
    serverVersion: serverRow.version,
    sizeBytes: Number(serverRow.size),
    inRecovery: serverRow.in_recovery,
    localMigrations,
    appliedMigrations,
    jobQueueVersion,
    roles: roles.rows,
    tablesWithoutRls: rls.rows.map((r) => r.table),
    disabledTriggers: triggers.rows.filter((t) => t.enabled === 'D').map((t) => t.name),
    triggerCount: triggers.rows.length,
    markersFound,
    latestWriteAt,
    restoreEvents,
    tables,
  };
}

const list = (items: readonly string[], max = 10) =>
  items.length <= max
    ? items.join(', ')
    : `${items.slice(0, max).join(', ')} and ${String(items.length - max)} more`;

/** Judges the facts of a restored database. Pure. */
export function evaluateRestore(
  facts: RestoreFacts,
  options: VerifyRestoreOptions = {},
): RestoreVerificationReport {
  const checks: RestoreCheck[] = [];
  const add = (name: RestoreCheckName, status: RestoreCheckStatus, detail: string) =>
    checks.push({ name, status, detail });

  add(
    'recovery_finished',
    facts.inRecovery ? 'fail' : 'pass',
    facts.inRecovery
      ? 'The server is still in recovery (replaying or a standby): wait for it to be promoted.'
      : 'The server is promoted and accepts writes.',
  );

  const applied = new Set(facts.appliedMigrations);
  const local = new Set(facts.localMigrations);
  const pending = facts.localMigrations.filter((h) => !applied.has(h)).length;
  const unknown = facts.appliedMigrations.filter((h) => !local.has(h)).length;
  if (facts.appliedMigrations.length === 0) {
    add(
      'migrations',
      'fail',
      'No migration is recorded: this is not a restored application database.',
    );
  } else if (pending > 0 || unknown > 0) {
    add(
      'migrations',
      'warn',
      `${String(facts.appliedMigrations.length)} applied; ${String(pending)} of this code pending ` +
        `(db:migrate applies them before the database serves traffic); ${String(unknown)} unknown to this code.`,
    );
  } else {
    add('migrations', 'pass', `All ${String(facts.appliedMigrations.length)} migrations applied.`);
  }

  add(
    'job_queue',
    facts.jobQueueVersion === null ? 'fail' : 'pass',
    facts.jobQueueVersion === null
      ? `The job queue (schema ${JOB_QUEUE_SCHEMA}) is missing.`
      : `Job queue at schema version ${String(facts.jobQueueVersion)}.`,
  );

  const missingRoles = facts.roles.filter((r) => !r.exists).map((r) => r.role);
  const withoutLogins = facts.roles.filter((r) => r.exists && r.logins === 0).map((r) => r.role);
  if (missingRoles.length > 0) {
    add('connection_roles', 'fail', `Missing connection roles: ${list(missingRoles)}.`);
  } else if (withoutLogins.length > 0) {
    add(
      'connection_roles',
      'warn',
      `Roles without logins: ${list(withoutLogins)} (provision them with db:provision-login before serving traffic).`,
    );
  } else {
    add('connection_roles', 'pass', 'Every connection role exists and has a login.');
  }

  add(
    'row_level_security',
    facts.tablesWithoutRls.length > 0 ? 'fail' : 'pass',
    facts.tablesWithoutRls.length > 0
      ? `Club tables without RLS enabled and forced: ${list(facts.tablesWithoutRls)}.`
      : 'Every club and medical table has RLS enabled and forced.',
  );

  if (facts.triggerCount === 0) {
    add(
      'triggers',
      'fail',
      'There are no triggers: audit, history and append-only rules are missing.',
    );
  } else if (facts.disabledTriggers.length > 0) {
    add('triggers', 'fail', `Disabled triggers: ${list(facts.disabledTriggers)}.`);
  } else {
    add('triggers', 'pass', `${String(facts.triggerCount)} triggers, all enabled.`);
  }

  const present = options.presentMarkerIds ?? [];
  const absent = options.absentMarkerIds ?? [];
  if (present.length > 0 || absent.length > 0) {
    const found = new Set(facts.markersFound.map((m) => m.id.toLowerCase()));
    const missing = present.filter((id) => !found.has(id.toLowerCase()));
    const unexpected = absent.filter((id) => found.has(id.toLowerCase()));
    const problems = [
      ...(missing.length > 0
        ? [`missing markers written before the target: ${list(missing)}`]
        : []),
      ...(unexpected.length > 0
        ? [`markers written after the target are present: ${list(unexpected)}`]
        : []),
    ];
    add(
      'drill_markers',
      problems.length > 0 ? 'fail' : 'pass',
      problems.length > 0
        ? `The restore did not land on the target: ${problems.join('; ')}.`
        : `${String(present.length)} marker(s) before the target present, ${String(absent.length)} after it absent.`,
    );
  }

  const target = options.recoveryTargetAt ?? null;
  const skewMs = options.clockSkewMs ?? RESTORE_CLOCK_SKEW_MS_DEFAULT;
  let gapSeconds: number | null = null;
  if (facts.latestWriteAt === null) {
    add('recovery_point', 'warn', 'No timestamped row was found: the database holds no data.');
  } else if (target === null) {
    add(
      'recovery_point',
      'pass',
      `Latest write at ${facts.latestWriteAt.toISOString()} (no target given to compare with).`,
    );
  } else {
    gapSeconds = Math.round((target.getTime() - facts.latestWriteAt.getTime()) / 1000);
    if (facts.latestWriteAt.getTime() > target.getTime() + skewMs) {
      add(
        'recovery_point',
        'fail',
        `A row was written at ${facts.latestWriteAt.toISOString()}, after the target ` +
          `${target.toISOString()}: this is not a copy as of the target.`,
      );
    } else {
      add(
        'recovery_point',
        'pass',
        `Latest write at ${facts.latestWriteAt.toISOString()}, ${String(gapSeconds)} s before the target.`,
      );
    }
  }

  return {
    ok: checks.every((c) => c.status !== 'fail'),
    checkedAt: facts.checkedAt.toISOString(),
    database: {
      environment: facts.environment,
      serverVersion: facts.serverVersion,
      sizeBytes: facts.sizeBytes,
      restoreEventsRecorded: facts.restoreEvents,
    },
    recoveryTargetAt: target?.toISOString() ?? null,
    latestWriteAt: facts.latestWriteAt?.toISOString() ?? null,
    secondsBetweenLatestWriteAndTarget: gapSeconds,
    checks,
    tables: facts.tables,
  };
}

/** Verifies a restored database: {@link readRestoreFacts}, then {@link evaluateRestore}. */
export async function verifyRestoredDatabase(
  client: Queryable,
  options: VerifyRestoreOptions = {},
): Promise<RestoreVerificationReport> {
  return evaluateRestore(await readRestoreFacts(client, options), options);
}
