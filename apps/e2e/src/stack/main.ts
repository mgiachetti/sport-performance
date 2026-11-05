#!/usr/bin/env node
/**
 * The end-to-end stack (B-108, ADR 0096): a fresh database with the demo
 * club, the compiled API and worker, and the built staff web served by
 * `vite preview`. Playwright starts it (`webServer`) or reuses one already
 * running (`pnpm --filter @sport-performance/e2e e2e:stack`, in CI a
 * background step shared with the mobile end-to-end tests).
 *
 * Ready when the web answers: the database is seeded and the API is ready by
 * then. On SIGINT / SIGTERM stops every child and drops the run's database
 * and logins. Prerequisite: the API, the
 * worker and the web are built, the web with `VITE_API_URL` = the API URL of
 * the stack (`README.md`).
 */
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  E2E_DEMO_SEED,
  E2E_DEMO_SLUG,
  E2E_EMAIL_DOMAIN,
  E2E_ENVIRONMENT,
  E2E_HISTORY_DAYS,
  REPO_DIR,
  runFiles,
  stackConfig,
  type StackConfig,
} from './config.ts';
import { demoDataset } from '../harness/demo.ts';
import { dropDatabase, prepareDatabase } from './database.ts';
import { addInjuryFixture } from './fixtures.ts';
import { parseMailLogLine } from './mail.ts';
import type { RunState } from './state.ts';

const API_DIR = resolve(REPO_DIR, 'apps/api');
const WORKER_DIR = resolve(REPO_DIR, 'apps/worker');
const WEB_DIR = resolve(REPO_DIR, 'apps/web');
const READY_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;

function log(line: string): void {
  process.stdout.write(`[e2e-stack] ${line}\n`);
}

class StackError extends Error {
  override readonly name = 'StackError';
}

/** The built web must exist and call this stack's API (Vite inlines `VITE_API_URL`). */
function assertBuilt(config: StackConfig): void {
  for (const file of [join(API_DIR, 'dist/main.js'), join(WORKER_DIR, 'dist/main.js')]) {
    if (!existsSync(file)) {
      throw new StackError(
        `${file} is missing: run \`pnpm turbo run build --filter=@sport-performance/e2e...\`.`,
      );
    }
  }
  const assets = join(WEB_DIR, 'dist/assets');
  const hint = `build the web with VITE_API_URL=${config.apiUrl} (README of apps/e2e)`;
  if (!existsSync(assets)) throw new StackError(`The web is not built: ${hint}.`);
  const pointsHere = readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .some((file) => readFileSync(join(assets, file), 'utf8').includes(config.apiUrl));
  if (!pointsHere) throw new StackError(`The built web calls another API: ${hint}.`);
}

interface Child {
  readonly name: string;
  readonly process: ChildProcess;
}

const children: Child[] = [];
let stopping = false;
/** Set once the run has a database: dropped when the stack stops. */
let databaseToDrop: StackConfig | undefined;

function start(
  name: string,
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    logFile: string;
    onLine?: (line: string) => void;
  },
): Child {
  const out = createWriteStream(options.logFile, { flags: 'a' });
  const child = spawn(command, args, {
    cwd: options.cwd,
    // Only what the child needs, plus PATH and HOME: no CI secrets leak into the stack.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', (line) => {
      out.write(`${line}\n`);
      options.onLine?.(line);
    });
  }
  child.on('exit', (code, signal) => {
    out.end();
    if (stopping) return;
    log(`${name} exited (${signal ?? String(code)}); see ${options.logFile}`);
    void stop(1);
  });
  const entry = { name, process: child };
  children.push(entry);
  return entry;
}

async function stop(exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  const running = children.filter(
    (c) => c.process.exitCode === null && c.process.signalCode === null,
  );
  await Promise.all(
    running.map(
      (c) =>
        new Promise<void>((done) => {
          const timer = setTimeout(() => {
            c.process.kill('SIGKILL');
          }, STOP_TIMEOUT_MS);
          c.process.once('exit', () => {
            clearTimeout(timer);
            done();
          });
          c.process.kill('SIGTERM');
        }),
    ),
  );
  let code = exitCode;
  if (databaseToDrop !== undefined) {
    try {
      await dropDatabase(databaseToDrop);
      log(`database ${databaseToDrop.databaseName} dropped`);
    } catch (error) {
      log(`could not drop the database: ${error instanceof Error ? error.message : String(error)}`);
      code = code === 0 ? 1 : code;
    }
  }
  process.exit(code);
}

async function waitFor(url: string, child: Child): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.process.exitCode !== null) throw new StackError(`${child.name} did not start.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new StackError(
    `${child.name} was not ready at ${url} within ${String(READY_TIMEOUT_MS / 1000)} s.`,
  );
}

async function main(): Promise<void> {
  const config = stackConfig();
  assertBuilt(config);
  mkdirSync(config.runDir, { recursive: true });
  const files = runFiles(config.runDir);
  for (const file of [files.mailbox, files.apiLog, files.workerLog, files.webLog]) {
    writeFileSync(file, '');
  }

  databaseToDrop = config;
  const database = await prepareDatabase(config, log);
  const options = {
    asOf: database.seed.asOf,
    slug: E2E_DEMO_SLUG,
    seed: E2E_DEMO_SEED,
    historyDays: E2E_HISTORY_DAYS,
    emailDomain: E2E_EMAIL_DOMAIN,
  };
  const injuryFixture = await addInjuryFixture(
    database.ownerUrl,
    database.seed.clubId,
    demoDataset(options),
  );
  log('injury fixture added');
  const state: RunState = {
    startedAt: new Date().toISOString(),
    ...options,
    apiUrl: config.apiUrl,
    webUrl: config.webUrl,
    injuryFixture,
  };
  writeFileSync(files.state, `${JSON.stringify(state, null, 2)}\n`);

  const mailbox = createWriteStream(files.mailbox, { flags: 'a' });
  const common = { NODE_ENV: E2E_ENVIRONMENT, LOG_LEVEL: 'info' };
  const api = start(
    'api',
    process.execPath,
    ['--enable-source-maps', '--import', './dist/instrument.js', './dist/main.js'],
    {
      cwd: API_DIR,
      logFile: files.apiLog,
      env: {
        ...common,
        HOST: '127.0.0.1',
        PORT: String(config.apiPort),
        DATABASE_URL: database.logins.app,
        AUTH_DATABASE_URL: database.logins.auth,
        // A new secret per run: sessions of an earlier run never carry over.
        AUTH_SECRET: randomBytes(48).toString('base64'),
        AUTH_BASE_URL: config.apiUrl,
        WEB_ORIGINS: config.webUrl,
        WEB_APP_URL: config.webUrl,
        // Without RESEND_API_KEY the API writes each email to its log: the mailbox of the run.
      },
      onLine: (line) => {
        const mail = parseMailLogLine(line);
        if (mail !== null) mailbox.write(`${JSON.stringify(mail)}\n`);
      },
    },
  );
  await waitFor(`${config.apiUrl}/health/ready`, api);
  log(`api ready at ${config.apiUrl}`);

  start('worker', process.execPath, ['--enable-source-maps', './dist/main.js'], {
    cwd: WORKER_DIR,
    logFile: files.workerLog,
    env: {
      ...common,
      DATABASE_URL: database.logins.worker,
      // Demo clubs deliver nothing anyway (ADR 0055); no email or push leaves the run.
      NOTIFICATIONS: 'off',
    },
  });

  const vite = join(
    dirname(createRequire(join(WEB_DIR, 'package.json')).resolve('vite/package.json')),
    'bin/vite.js',
  );
  const web = start(
    'web',
    process.execPath,
    [vite, 'preview', '--host', '127.0.0.1', '--port', String(config.webPort), '--strictPort'],
    { cwd: WEB_DIR, logFile: files.webLog, env: { ...common } },
  );
  await waitFor(config.webUrl, web);
  log(`web ready at ${config.webUrl} (demo club ${E2E_DEMO_SLUG}, as of ${state.asOf})`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stop(0);
  });
}

main().catch((error: unknown) => {
  log(`failed: ${error instanceof Error ? error.message : String(error)}`);
  void stop(1);
});
