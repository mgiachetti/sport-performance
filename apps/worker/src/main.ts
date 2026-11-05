/**
 * Process entry point (`node dist/main.js`): validates the environment,
 * checks the database login, starts pg-boss and the handlers, and stops in
 * order on SIGTERM / SIGINT (Railway sends SIGTERM on every deploy).
 */
import { assertConnectionRole, createPool, DatabaseRoleError } from '@sport-performance/db';
import { LogEmailTransport, ResendEmailTransport } from '@sport-performance/email';
import { createS3Storage } from '@sport-performance/storage';
import { ConfigError, configSummary, loadConfig } from './config.js';
import { createLogger, disabledErrorReporter, sentryErrorReporter } from './observability.js';
import { ExpoPushService } from './notifications/index.js';
import { startWorker } from './worker.js';

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
  const reporter =
    config.sentry === null ? disabledErrorReporter : sentryErrorReporter(config.sentry);

  const pool = createPool({
    connectionString: config.database.url,
    applicationName: 'sport-performance-worker',
    max: config.database.poolMax,
    connectionTimeoutMs: config.database.connectTimeoutMs,
    statementTimeoutMs: config.database.statementTimeoutMs,
    idleInTransactionTimeoutMs: config.database.statementTimeoutMs,
    onIdleError: (error) => {
      logger.error({ err: error }, 'idle database connection failed');
    },
  });

  // With the owner's URL RLS would silently not apply (ADR 0006, ADR 0026): refuse to start.
  try {
    await assertConnectionRole(pool, 'worker');
  } catch (error) {
    await pool.end().catch(() => undefined);
    if (error instanceof DatabaseRoleError) {
      logger.fatal(
        { err: error, variable: 'DATABASE_URL' },
        'database login is not the worker role',
      );
      process.exit(1);
    }
    throw error;
  }

  const worker = await startWorker({
    pool,
    connectionString: config.database.url,
    logger,
    reporter,
    clubConcurrency: config.clubConcurrency,
    jobQueuePoolMax: config.jobQueue.poolMax,
    storage: config.storage === null ? null : createS3Storage(config.storage),
    opsMonitor: config.opsMonitor,
    notifications:
      config.notifications === null
        ? null
        : {
            push: new ExpoPushService({ accessToken: config.notifications.expoAccessToken }),
            email:
              config.notifications.resend === null
                ? new LogEmailTransport(logger)
                : new ResendEmailTransport(config.notifications.resend),
            webAppUrl: config.notifications.webAppUrl,
            demoEmailDomains: config.notifications.demoEmailDomains,
          },
  });
  if (config.notifications === null) logger.warn('NOTIFICATIONS=off: nothing is notified');
  else if (config.notifications.resend === null) {
    logger.warn('no RESEND_API_KEY: notification emails are written to the log');
  }
  logger.info({ config: configSummary(config) }, 'worker ready');

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'stopping worker');
    const deadline = setTimeout(() => {
      logger.error('shutdown timed out');
      process.exit(1);
    }, config.shutdownTimeoutMs + 5000);
    deadline.unref();
    worker
      .stop(config.shutdownTimeoutMs)
      .then(() => pool.end())
      .then(() => reporter.flush(2000))
      .then(() => {
        logger.info('worker stopped');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
    reporter.capture(reason, { source: 'unhandledRejection' });
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    reporter.capture(error, { source: 'uncaughtException' });
    shutdown('uncaughtException');
  });
}

await main();
