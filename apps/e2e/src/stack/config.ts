import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

/** Root of the `apps/e2e` package. */
export const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** Root of the monorepo. */
export const REPO_DIR = resolve(PACKAGE_DIR, '../..');

/**
 * The demo club of the end-to-end run (ADR 0055: E2E uses its own slug, so
 * it never touches the permanent `demo`). The seed is fixed: ids and people
 * depend on it, and the fixtures recompute the same dataset.
 */
export const E2E_DEMO_SLUG = 'demo-e2e';
export const E2E_DEMO_SEED = 'e2e';
/** More than the 28 days the chronic EWMA needs, less than the 84 of staging (CI time). */
export const E2E_HISTORY_DAYS = 35;
/** Emails of the demo are `<slug>.<role>@example.com` (RFC 2606, never delivered). */
export const E2E_EMAIL_DOMAIN = 'example.com';
/** Environment the stack runs as: an allowed one for the demo seed guard. */
export const E2E_ENVIRONMENT = 'test';

/** Where the stack listens and leaves its files: what the tests need too. */
export interface StackEndpoints {
  readonly apiPort: number;
  readonly webPort: number;
  readonly apiUrl: string;
  readonly webUrl: string;
  /** Where the run leaves its state, mailbox and logs (ignored by the repo). */
  readonly runDir: string;
}

export interface StackConfig extends StackEndpoints {
  /** Owner (or superuser) connection to any database of the server; never logged. */
  readonly adminDatabaseUrl: string;
  /** The database the run creates from scratch and drops when it stops (also before, if a killed run left it). */
  readonly databaseName: string;
}

export class StackConfigError extends Error {
  override readonly name = 'StackConfigError';
}

/** A plain identifier short enough for its logins (`<name>_worker`, 63 bytes at most). */
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,55}$/;

function port(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new StackConfigError(`${name} must be a port between 1024 and 65535.`);
  }
  return value;
}

/** Default directory of the run: `apps/e2e/.e2e-run`. */
export function defaultRunDir(): string {
  return resolve(PACKAGE_DIR, '.e2e-run');
}

/**
 * Ports, URLs and run directory of the stack: `E2E_API_PORT` (3100),
 * `E2E_WEB_PORT` (4174), `E2E_RUN_DIR` (`apps/e2e/.e2e-run`). The stack and
 * the tests read the same, so they agree.
 *
 * Loopback `127.0.0.1` everywhere: the web and the API are the same site, so
 * the session cookie travels like in production (one registrable domain).
 */
export function stackEndpoints(env: NodeJS.ProcessEnv = process.env): StackEndpoints {
  const apiPort = port(env.E2E_API_PORT, 3100, 'E2E_API_PORT');
  const webPort = port(env.E2E_WEB_PORT, 4174, 'E2E_WEB_PORT');
  if (apiPort === webPort) throw new StackConfigError('E2E_API_PORT and E2E_WEB_PORT must differ.');
  const runDirRaw = env.E2E_RUN_DIR?.trim();
  const runDir =
    runDirRaw === undefined || runDirRaw === ''
      ? defaultRunDir()
      : isAbsolute(runDirRaw)
        ? runDirRaw
        : resolve(REPO_DIR, runDirRaw);
  return {
    apiPort,
    webPort,
    apiUrl: `http://127.0.0.1:${String(apiPort)}`,
    webUrl: `http://127.0.0.1:${String(webPort)}`,
    runDir,
  };
}

/**
 * The whole configuration of the stack: {@link stackEndpoints} plus the
 * server, `E2E_DATABASE_URL` (or `DATABASE_URL`, like the integration tests:
 * an owner connection to the Postgres 16 server) and `E2E_DATABASE_NAME`
 * (`sport_performance_e2e`).
 */
export function stackConfig(env: NodeJS.ProcessEnv = process.env): StackConfig {
  const adminDatabaseUrl = (env.E2E_DATABASE_URL ?? env.DATABASE_URL ?? '').trim();
  if (adminDatabaseUrl === '') {
    throw new StackConfigError(
      'Set E2E_DATABASE_URL (or DATABASE_URL) to an owner connection of a Postgres 16 server.',
    );
  }
  const databaseName = (env.E2E_DATABASE_NAME ?? 'sport_performance_e2e').trim();
  if (!DATABASE_NAME.test(databaseName)) {
    throw new StackConfigError(
      'E2E_DATABASE_NAME must be a plain lowercase identifier of at most 56 characters.',
    );
  }
  return { ...stackEndpoints(env), adminDatabaseUrl, databaseName };
}

/** `url` pointing at another database of the same server. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** `url` with other credentials (a connection-role login). */
export function withLogin(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

/** Files of a run, under {@link StackEndpoints.runDir}. */
export function runFiles(runDir: string) {
  return {
    state: resolve(runDir, 'state.json'),
    mailbox: resolve(runDir, 'mailbox.jsonl'),
    apiLog: resolve(runDir, 'api.log'),
    workerLog: resolve(runDir, 'worker.log'),
    webLog: resolve(runDir, 'web.log'),
  };
}
