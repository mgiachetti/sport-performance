import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Database } from './db/database.js';
import type { ErrorReporter } from './observability/error-reporter.js';

export interface ShutdownOptions {
  app: FastifyInstance;
  db: Database;
  reporter: ErrorReporter;
  logger: FastifyBaseLogger;
  /** Past this, the process exits with code 1 even if requests are still running. */
  timeoutMs: number;
  exit: (code: number) => void;
}

/** Time reserved, inside `timeoutMs`, to flush Sentry after the server and pool closed. */
const FLUSH_TIMEOUT_MS = 2000;

/**
 * Returns the shutdown routine. Order: stop being ready (new requests get
 * `503`), let Fastify finish in-flight requests and close the server, close
 * the database pool, flush Sentry, exit. Idempotent: a second call while
 * shutting down only logs.
 */
export function createShutdown(options: ShutdownOptions) {
  const { app, db, reporter, logger, timeoutMs, exit } = options;
  let running: Promise<void> | undefined;

  return function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (running !== undefined) {
      logger.warn({ reason }, 'shutdown already in progress');
      return running;
    }
    app.lifecycle.draining = true;
    logger.info({ reason }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error({ reason, timeoutMs }, 'shutdown timed out; exiting');
      exit(1);
    }, timeoutMs);
    timer.unref();

    running = (async () => {
      let code = exitCode;
      try {
        await app.close();
        await db.close();
      } catch (error) {
        logger.error({ err: error }, 'error while shutting down');
        code = 1;
      }
      await reporter.flush(Math.min(FLUSH_TIMEOUT_MS, timeoutMs));
      clearTimeout(timer);
      logger.info({ reason, exitCode: code }, 'shutdown complete');
      exit(code);
    })();
    return running;
  };
}

export type Shutdown = ReturnType<typeof createShutdown>;

/** The subset of `process` the handlers need (tests pass an `EventEmitter`). */
export interface ProcessLike {
  on(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  on(
    event: 'uncaughtException' | 'unhandledRejection',
    listener: (error: unknown) => void,
  ): unknown;
}

/**
 * `SIGTERM` (Railway, Docker) and `SIGINT` (Ctrl+C) shut down cleanly with
 * code 0. An uncaught exception or unhandled rejection leaves the process in
 * an unknown state: it is logged, reported and the process shuts down with 1.
 */
export function installProcessHandlers(
  proc: ProcessLike,
  shutdown: Shutdown,
  logger: FastifyBaseLogger,
  reporter: ErrorReporter,
): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    proc.on(signal, () => void shutdown(signal, 0));
  }
  for (const source of ['uncaughtException', 'unhandledRejection'] as const) {
    proc.on(source, (error: unknown) => {
      logger.fatal({ err: error, source }, 'fatal error');
      reporter.capture(error, { source });
      void shutdown(source, 1);
    });
  }
}
