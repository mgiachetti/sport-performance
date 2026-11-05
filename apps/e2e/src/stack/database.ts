import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '@sport-performance/db/migrate';
import { provisionLoginRole, type DatabaseRoleKind } from '@sport-performance/db/roles';
import { runDemoSeed, type RunDemoSeedResult } from '@sport-performance/db/seeds';
import {
  E2E_DEMO_SEED,
  E2E_DEMO_SLUG,
  E2E_EMAIL_DOMAIN,
  E2E_ENVIRONMENT,
  E2E_HISTORY_DAYS,
  withDatabase,
  withLogin,
  type StackConfig,
} from './config.ts';

/**
 * Logins of the run, one per connection role (ADR 0026). Roles are
 * cluster-wide, so their names come from the run's database: two stacks on
 * the same server with different `E2E_DATABASE_NAME` never overwrite each
 * other's passwords (`sport_performance_e2e_api`, `_worker`, `_auth`).
 */
export function e2eLogins(databaseName: string): Readonly<Record<DatabaseRoleKind, string>> {
  return {
    app: `${databaseName}_api`,
    worker: `${databaseName}_worker`,
    auth: `${databaseName}_auth`,
  };
}

export interface PreparedDatabase {
  /** Owner connection of the run's database (migrations, seeds). */
  readonly ownerUrl: string;
  /** Connection of each connection-role login. */
  readonly logins: Readonly<Record<DatabaseRoleKind, string>>;
  readonly seed: RunDemoSeedResult;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function adminClient(config: StackConfig): pg.Client {
  return new pg.Client({
    connectionString: config.adminDatabaseUrl,
    application_name: 'sport-performance-e2e',
  });
}

/**
 * Drops the run's database and its logins (when the stack stops, and before
 * a new run in case the last one was killed). Idempotent.
 */
export async function dropDatabase(config: StackConfig): Promise<void> {
  const admin = adminClient(config);
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${quoteIdent(config.databaseName)} with (force)`);
    // The grants of the logins lived in the dropped database: nothing else holds them.
    for (const login of Object.values(e2eLogins(config.databaseName))) {
      await admin.query(`drop role if exists ${quoteIdent(login)}`);
    }
  } finally {
    await admin.end();
  }
}

/** A throwaway password per run: never written anywhere but the children's environment. */
function password(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Builds the database of a run the way an environment is set up (README of
 * `packages/db`): a fresh database that declares its environment, every
 * migration, one login per connection role, and the demo club seeded with
 * `runDemoSeed` (what `db:seed:demo` runs, with its guard).
 */
export async function prepareDatabase(
  config: StackConfig,
  log: (line: string) => void,
): Promise<PreparedDatabase> {
  // What a run that did not stop cleanly may have left behind.
  await dropDatabase(config);
  const admin = adminClient(config);
  await admin.connect();
  try {
    const name = quoteIdent(config.databaseName);
    await admin.query(`create database ${name}`);
    // The database says what it is: the demo seed refuses to write into one that is not a
    // demo environment (ADR 0055).
    await admin.query(
      `alter database ${name} set app.deployment_environment = '${E2E_ENVIRONMENT}'`,
    );
  } finally {
    await admin.end();
  }
  log(`database ${config.databaseName} created`);

  const ownerUrl = withDatabase(config.adminDatabaseUrl, config.databaseName);
  const migrations = await runMigrations({ connectionString: ownerUrl });
  log(`migrations applied (${String(migrations.applied)})`);

  const names = e2eLogins(config.databaseName);
  const logins = {} as Record<DatabaseRoleKind, string>;
  for (const role of Object.keys(names) as DatabaseRoleKind[]) {
    const login = names[role];
    const secret = password();
    await provisionLoginRole({ connectionString: ownerUrl, login, password: secret, role });
    logins[role] = withLogin(ownerUrl, login, secret);
  }
  log('connection-role logins provisioned');

  const seed = await runDemoSeed({
    connectionString: ownerUrl,
    env: {
      RAILWAY_ENVIRONMENT_NAME: undefined,
      NODE_ENV: E2E_ENVIRONMENT,
      DEMO_SEED_CONFIRM: E2E_ENVIRONMENT,
    },
    slug: E2E_DEMO_SLUG,
    seed: E2E_DEMO_SEED,
    historyDays: E2E_HISTORY_DAYS,
    emailDomain: E2E_EMAIL_DOMAIN,
  });
  log(seed.summary);
  return { ownerUrl, logins, seed };
}
