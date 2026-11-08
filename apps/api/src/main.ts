/**
 * Process entry point: `node --import ./dist/instrument.js ./dist/main.js`.
 * Validates the environment, wires logger, Sentry and Postgres, listens and
 * installs the shutdown handlers.
 */
import { createDatabase } from '@sport-performance/db';
import { buildApp } from './app.js';
import { createAuthModule } from './auth/module.js';
import { ConfigError, configSummary, loadConfig } from './config/env.js';
import {
  assertConnectionRole,
  DatabaseRoleError,
  type DatabaseRoleKind,
} from '@sport-performance/db';
import { createApiPool, databaseFromPool, type Database } from './db/database.js';
import { createFilesModule } from './files/module.js';
import { createPodCommandSigner } from './pods/command-signer.js';
import { createMailer } from './email/mailer.js';
import { ResendEmailTransport } from './email/resend.js';
import { LogEmailTransport, type EmailTransport } from './email/transport.js';
import { disabledErrorReporter } from './observability/error-reporter.js';
import { createLogger } from './observability/logger.js';
import { initSentry, isSentryInitialized, sentryErrorReporter } from './observability/sentry.js';
import { createShutdown, installProcessHandlers } from './shutdown.js';

const RATE_LIMIT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // No logger yet; the message names variables, never their values.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({
    level: config.log.level,
    version: config.version,
    environment: config.sentry?.environment ?? config.nodeEnv,
  });

  // Fallback when started without `--import ./dist/instrument.js`: errors are
  // still reported, only the automatic tracing of http and pg is missing.
  if (config.sentry !== null && !isSentryInitialized()) {
    initSentry(config.sentry);
    logger.warn('sentry started late: run with --import ./dist/instrument.js for tracing');
  }
  const reporter = config.sentry === null ? disabledErrorReporter : sentryErrorReporter();

  const pool = createApiPool({
    ...config.database,
    onIdleError: (error) => {
      logger.error({ err: error }, 'idle database connection failed');
    },
  });
  // Better Auth's own connection (ADR 0026, ADR 0028): a login of sport_performance_auth,
  // which only reaches the identity tables and the attempt counters.
  const authPool = createApiPool({
    ...config.database,
    url: config.auth.database.url,
    poolMax: config.auth.database.poolMax,
    applicationName: 'sport-performance-api-auth',
    onIdleError: (error) => {
      logger.error({ err: error }, 'idle auth database connection failed');
    },
  });
  // RLS only protects anything if neither login is the owner nor has BYPASSRLS
  // (ADR 0006, ADR 0026): refuse to serve with the wrong logins.
  const logins: [typeof pool, DatabaseRoleKind, string][] = [
    [pool, 'app', 'DATABASE_URL'],
    [authPool, 'auth', 'AUTH_DATABASE_URL'],
  ];
  for (const [checked, role, variable] of logins) {
    try {
      await assertConnectionRole(checked, role);
    } catch (error) {
      await Promise.all([pool.end(), authPool.end()]).catch(() => undefined);
      if (error instanceof DatabaseRoleError) {
        logger.fatal({ err: error, variable }, `database login is not the ${role} role`);
        process.exit(1);
      }
      throw error;
    }
  }
  const db = databaseFromPool(pool);
  const authDb = databaseFromPool(authPool);

  const transport: EmailTransport =
    config.email.resendApiKey === null
      ? new LogEmailTransport(logger)
      : new ResendEmailTransport({ apiKey: config.email.resendApiKey, from: config.email.from });
  const auth = createAuthModule({
    config: config.auth,
    db,
    authDb,
    authDrizzle: createDatabase(authPool),
    mailer: createMailer(transport),
    logger,
  });

  // Ended rate-limit windows are reset on the next attempt; pruning only keeps the table small.
  // Expired sessions and devices unused for 400 days are pruned on the same timer (ADR 0033).
  const pruneTimer = setInterval(() => {
    auth.rateLimiter.prune().catch((error: unknown) => {
      logger.warn({ err: error }, 'pruning auth rate limits failed');
    });
    auth.sessions.prune().catch((error: unknown) => {
      logger.warn({ err: error }, 'pruning sessions and known devices failed');
    });
  }, RATE_LIMIT_PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  const databases: Database = {
    transaction: (context, work, settings) => db.transaction(context, work, settings),
    ping: (timeoutMs) => db.ping(timeoutMs),
    close: async () => {
      clearInterval(pruneTimer);
      await Promise.all([db.close(), authDb.close()]);
    },
  };

  // The bucket of uploaded files (B-325); required in production (validated with the env).
  const files = createFilesModule(config.files);
  if (files === undefined) logger.warn('file storage is not configured: file endpoints answer 503');
  // The key that signs the pods' commands (B-916); without it the erase command answers 503.
  const podCommandSigner =
    config.podCommands === null
      ? undefined
      : createPodCommandSigner({
          privateKeyPkcs8Base64: config.podCommands.signingKey,
          keyId: config.podCommands.keyId,
        });
  if (podCommandSigner === undefined) {
    logger.warn('no pod command signing key (POD_COMMAND_SIGNING_KEY): pods keep their segments');
  }
  const app = await buildApp({
    config,
    db,
    logger,
    errorReporter: reporter,
    auth,
    ...(files !== undefined && { files }),
    ...(podCommandSigner !== undefined && { podCommandSigner }),
  });
  const shutdown = createShutdown({
    app,
    db: databases,
    reporter,
    logger,
    timeoutMs: config.shutdownTimeoutMs,
    exit: (code) => process.exit(code),
  });
  installProcessHandlers(process, shutdown, logger, reporter);

  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { sentry: reporter.enabled, email: transport.name, config: configSummary(config) },
    'api ready',
  );
}

await main();
