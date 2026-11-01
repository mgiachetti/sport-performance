/**
 * Process entry point: `node --import ./dist/instrument.js ./dist/main.js`.
 * Validates the environment, wires logger, Sentry and Postgres, listens and
 * installs the shutdown handlers.
 */
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createPgDatabase } from './db/database.js';
import { disabledErrorReporter } from './observability/error-reporter.js';
import { createLogger } from './observability/logger.js';
import { initSentry, isSentryInitialized, sentryErrorReporter } from './observability/sentry.js';
import { createShutdown, installProcessHandlers } from './shutdown.js';

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

  const db = createPgDatabase({
    ...config.database,
    onIdleError: (error) => {
      logger.error({ err: error }, 'idle database connection failed');
    },
  });

  const app = await buildApp({ config, db, logger, errorReporter: reporter });
  const shutdown = createShutdown({
    app,
    db,
    reporter,
    logger,
    timeoutMs: config.shutdownTimeoutMs,
    exit: (code) => process.exit(code),
  });
  installProcessHandlers(process, shutdown, logger, reporter);

  await app.listen({ host: config.host, port: config.port });
  logger.info({ sentry: reporter.enabled }, 'api ready');
}

await main();
