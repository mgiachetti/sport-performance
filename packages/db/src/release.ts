import pg from 'pg';
import { runMigrations, type MigrationReport } from './migrate.js';
import { DATABASE_ROLES, provisionLoginRole, type DatabaseRoleKind } from './roles.js';
import { DATABASE_ENVIRONMENT_SETTING } from './seeds/demo/guard.js';

/**
 * The database step of a deploy (B-701, ADR 0090): the API's pre-deploy
 * command on Railway runs it before the new version takes traffic, so
 * staging and production are migrated in the deploy, in order (ADR 0004).
 *
 * 1. Runs the pending migrations as the owner (`MIGRATIONS_DATABASE_URL`).
 * 2. Creates or updates the login of every connection role a service uses
 *    (ADR 0026), from the very URLs those services connect with: the
 *    password is set once, in Railway, and nobody types it twice.
 * 3. Declares the database's environment (`app.deployment_environment`), so
 *    a production database refuses the demo seed by itself (ADR 0055).
 *
 * Idempotent and safe to run concurrently (the migrations take an advisory
 * lock; provisioning is `CREATE` or `ALTER` in a transaction). Errors never
 * contain a password or a connection string.
 */

/** Which variable of the release environment holds the URL of each role's login. */
export const RELEASE_LOGIN_VARIABLES = {
  app: 'DATABASE_URL',
  auth: 'AUTH_DATABASE_URL',
  worker: 'WORKER_DATABASE_URL',
} as const satisfies Record<DatabaseRoleKind, string>;

/** Environment names a database may declare: what Railway allows, lowercased. */
const ENVIRONMENT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** The release cannot run with this configuration. Never contains secrets. */
export class ReleaseConfigError extends Error {
  override readonly name = 'ReleaseConfigError';
}

export interface ReleaseLogin {
  readonly role: DatabaseRoleKind;
  /** Name of the variable it came from, for messages (never the value). */
  readonly variable: string;
  readonly login: string;
  readonly password: string;
}

export interface ReleasePlan {
  /** Owner connection: migrations, logins and the environment setting. Never logged. */
  readonly ownerConnectionString: string;
  readonly logins: readonly ReleaseLogin[];
  /** Variables of the roles left as they are because their URL is unset (a forgotten variable shows in the log). */
  readonly skippedVariables: readonly string[];
  /** Environment the database declares, or `null` to leave the setting as it is. */
  readonly deploymentEnvironment: string | null;
}

export interface ReleaseEnvironment {
  readonly MIGRATIONS_DATABASE_URL?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly AUTH_DATABASE_URL?: string | undefined;
  readonly WORKER_DATABASE_URL?: string | undefined;
  readonly RAILWAY_ENVIRONMENT_NAME?: string | undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

interface ParsedUrl {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

function parsePostgresUrl(value: string, variable: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReleaseConfigError(`${variable} is not a URL.`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new ReleaseConfigError(`${variable} must be a postgres:// or postgresql:// URL.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (url.hostname === '' || database === '') {
    throw new ReleaseConfigError(`${variable} must name a host and a database.`);
  }
  return {
    host: url.hostname.toLowerCase(),
    port: url.port === '' ? '5432' : url.port,
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/**
 * Reads and checks the release configuration. The owner URL is required (no
 * fallback to `DATABASE_URL`: here that is the API's login). Every login URL
 * present must point at the owner's server and database, carry a login and a
 * password, and use a login of its own: a login shared by two roles would
 * belong to both and defeat the per-role policies.
 */
export function releasePlanFromEnv(env: ReleaseEnvironment): ReleasePlan {
  const owner = nonBlank(env.MIGRATIONS_DATABASE_URL);
  if (owner === undefined) {
    throw new ReleaseConfigError('Set MIGRATIONS_DATABASE_URL (the owner role) to release.');
  }
  const ownerUrl = parsePostgresUrl(owner, 'MIGRATIONS_DATABASE_URL');

  const logins: ReleaseLogin[] = [];
  const skippedVariables: string[] = [];
  for (const [role, variable] of Object.entries(RELEASE_LOGIN_VARIABLES) as [
    DatabaseRoleKind,
    string,
  ][]) {
    const value = nonBlank(env[variable as keyof ReleaseEnvironment]);
    if (value === undefined) {
      skippedVariables.push(variable);
      continue;
    }
    const url = parsePostgresUrl(value, variable);
    if (url.host !== ownerUrl.host || url.port !== ownerUrl.port) {
      throw new ReleaseConfigError(`${variable} must use the server of MIGRATIONS_DATABASE_URL.`);
    }
    if (url.database !== ownerUrl.database) {
      throw new ReleaseConfigError(`${variable} must use the database of MIGRATIONS_DATABASE_URL.`);
    }
    if (url.user === '' || url.password === '') {
      throw new ReleaseConfigError(`${variable} must carry a login and its password.`);
    }
    if (url.user === ownerUrl.user) {
      throw new ReleaseConfigError(`${variable} must not use the owner's login.`);
    }
    const shared = logins.find((other) => other.login === url.user);
    if (shared !== undefined) {
      throw new ReleaseConfigError(
        `${variable} and ${shared.variable} use the same login: each role needs its own.`,
      );
    }
    logins.push({ role, variable, login: url.user, password: url.password });
  }

  const environment = nonBlank(env.RAILWAY_ENVIRONMENT_NAME)?.toLowerCase() ?? null;
  if (environment !== null && !ENVIRONMENT_NAME.test(environment)) {
    throw new ReleaseConfigError(
      'RAILWAY_ENVIRONMENT_NAME must be letters, digits, "-" or "_" to be declared.',
    );
  }
  return {
    ownerConnectionString: owner,
    logins,
    skippedVariables,
    deploymentEnvironment: environment,
  };
}

export interface ReleaseReport {
  readonly migrations: MigrationReport;
  /** `login → role group`, in the order provisioned. */
  readonly logins: readonly { readonly login: string; readonly group: string }[];
  /** Login variables that were unset, so their role was not provisioned. */
  readonly skippedVariables: readonly string[];
  readonly deploymentEnvironment: string | null;
}

/**
 * Declares the environment of the database the owner is connected to. Stored
 * per database (`ALTER DATABASE ... SET`): it reaches every new session,
 * whoever connects.
 */
async function declareEnvironment(connectionString: string, environment: string): Promise<void> {
  const client = new pg.Client({ connectionString, application_name: 'sport-performance-release' });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>('select current_database() as name');
    const name = rows[0]?.name;
    if (name === undefined) throw new Error('Could not read the name of the database.');
    await client.query(
      `alter database ${client.escapeIdentifier(name)} set ${DATABASE_ENVIRONMENT_SETTING} = ${client.escapeLiteral(environment)}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Runs the release plan: migrations, then logins, then the environment. */
export async function releaseDatabase(plan: ReleasePlan): Promise<ReleaseReport> {
  const migrations = await runMigrations({ connectionString: plan.ownerConnectionString });
  const provisioned: { login: string; group: string }[] = [];
  for (const login of plan.logins) {
    await provisionLoginRole({
      connectionString: plan.ownerConnectionString,
      login: login.login,
      password: login.password,
      role: login.role,
    });
    provisioned.push({ login: login.login, group: DATABASE_ROLES[login.role] });
  }
  if (plan.deploymentEnvironment !== null) {
    await declareEnvironment(plan.ownerConnectionString, plan.deploymentEnvironment);
  }
  return {
    migrations,
    logins: provisioned,
    skippedVariables: plan.skippedVariables,
    deploymentEnvironment: plan.deploymentEnvironment,
  };
}

/** One line per step, without secrets: what the deploy log shows. */
export function describeRelease(report: ReleaseReport): string {
  const lines = [
    `Migrations: ${String(report.migrations.applied)} applied, ${String(report.migrations.total)} in the database; ` +
      `job queue at version ${String(report.migrations.jobQueueVersion)}.`,
    ...report.logins.map(({ login, group }) => `Login ${login} provisioned as ${group}.`),
    ...report.skippedVariables.map(
      (variable) => `Warning: ${variable} is not set; its login was not provisioned.`,
    ),
    report.deploymentEnvironment === null
      ? 'Deployment environment of the database left as it was.'
      : `Database declared as "${report.deploymentEnvironment}".`,
  ];
  return `${lines.join('\n')}\n`;
}
