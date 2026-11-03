/**
 * "Never in production by accident" (B-307, ADR 0055). The demo seed only
 * runs where all of these hold:
 *
 * 1. The environment, `RAILWAY_ENVIRONMENT_NAME` (set by Railway on every
 *    service) or else `NODE_ENV` (or `development` when neither is set), is
 *    one of {@link DEMO_SEED_ENVIRONMENTS}. `production` never is, and
 *    `NODE_ENV=production` outside Railway is refused too: a production build
 *    without its environment name is not a place to guess.
 * 2. `DEMO_SEED_CONFIRM` (or `--confirm`) names that same environment: a
 *    typed confirmation, never a default.
 * 3. The database does not say otherwise: when it declares its environment
 *    (`ALTER DATABASE … SET app.deployment_environment = 'production'`, ADR
 *    0055), it must be an allowed one and the same as the process's.
 *
 * On top, `seedDemoClub` refuses to touch a club that is not `is_demo`.
 */

/** Environments where demo data may be written. */
export const DEMO_SEED_ENVIRONMENTS = ['local', 'development', 'test', 'ci', 'staging'] as const;

/** Database setting that declares the deployment environment of a database. */
export const DATABASE_ENVIRONMENT_SETTING = 'app.deployment_environment';

export class DemoSeedRefusedError extends Error {
  override readonly name = 'DemoSeedRefusedError';
}

export interface DemoSeedEnvironment {
  readonly RAILWAY_ENVIRONMENT_NAME?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly DEMO_SEED_CONFIRM?: string | undefined;
}

function normalized(value: string | undefined): string | undefined {
  const v = value?.trim().toLowerCase();
  return v === undefined || v === '' ? undefined : v;
}

function allowed(environment: string): boolean {
  return (DEMO_SEED_ENVIRONMENTS as readonly string[]).includes(environment);
}

/** The environment the process runs in, as the guard sees it. */
export function demoSeedEnvironment(env: DemoSeedEnvironment): string {
  return normalized(env.RAILWAY_ENVIRONMENT_NAME) ?? normalized(env.NODE_ENV) ?? 'development';
}

/**
 * Why the demo seed must not run, or an empty list. `databaseEnvironment` is
 * the database's `app.deployment_environment` (`null` when unset).
 */
export function demoSeedRefusals(
  env: DemoSeedEnvironment,
  databaseEnvironment: string | null,
): string[] {
  const problems: string[] = [];
  const environment = demoSeedEnvironment(env);
  if (!allowed(environment)) {
    problems.push(
      `The demo seed does not run in "${environment}" (allowed: ${DEMO_SEED_ENVIRONMENTS.join(', ')}).`,
    );
  }
  const confirmation = normalized(env.DEMO_SEED_CONFIRM);
  if (confirmation === undefined) {
    problems.push(
      `Set DEMO_SEED_CONFIRM=${environment} (or --confirm=${environment}) to write demo data.`,
    );
  } else if (confirmation !== environment) {
    problems.push(
      `DEMO_SEED_CONFIRM is "${confirmation}" but the environment is "${environment}".`,
    );
  }
  const database = normalized(databaseEnvironment ?? undefined);
  if (database !== undefined) {
    if (!allowed(database)) {
      problems.push(`The database declares itself "${database}": no demo data there.`);
    } else if (database !== environment) {
      problems.push(
        `The database declares itself "${database}" but the environment is "${environment}".`,
      );
    }
  }
  return problems;
}

/** Throws {@link DemoSeedRefusedError} with every refusal, or returns the environment. */
export function assertDemoSeedAllowed(
  env: DemoSeedEnvironment,
  databaseEnvironment: string | null,
): string {
  const problems = demoSeedRefusals(env, databaseEnvironment);
  if (problems.length > 0) throw new DemoSeedRefusedError(problems.join(' '));
  return demoSeedEnvironment(env);
}

/** Whether a database environment forbids demo data whatever the process says. */
export function databaseForbidsDemo(databaseEnvironment: string | null): boolean {
  const database = normalized(databaseEnvironment ?? undefined);
  return database !== undefined && !allowed(database);
}
