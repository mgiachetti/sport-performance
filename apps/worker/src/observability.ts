import * as Sentry from '@sentry/node';
import { pino, stdSerializers, type DestinationStream, type Logger } from 'pino';
import type { LogLevel, SentryConfig } from './config.js';

/**
 * Logs and error reports of the worker (ADR 0016). Jobs only carry ids (club,
 * player, job), never names or health data; the redaction below is a second
 * line of defense for errors of node-postgres, whose `detail` carries row values.
 */
export const REDACTED_PATHS = [
  'err.detail',
  'err.where',
  'err.parameters',
  '*.password',
  '*.email',
  '*.connectionString',
  '*.databaseUrl',
];

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly version: string;
  readonly environment: string;
  /** Where lines go; stdout by default. Tests pass a memory stream. */
  readonly destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { service: 'worker', version: options.version, env: options.environment },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      serializers: { err: stdSerializers.err },
    },
    options.destination,
  );
}

/** Ids attached to a reported error. */
export interface ErrorReportContext {
  readonly job?: string | undefined;
  readonly jobId?: string | undefined;
  readonly clubId?: string | undefined;
  readonly playerId?: string | undefined;
  readonly source?: string | undefined;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  capture(error: unknown, context?: ErrorReportContext): void;
  flush(timeoutMs: number): Promise<boolean>;
}

export const disabledErrorReporter: ErrorReporter = {
  enabled: false,
  capture() {
    // Disabled: the error is still logged.
  },
  flush: () => Promise.resolve(true),
};

/** Starts Sentry without collecting anything personal (same settings as the API). */
export function sentryErrorReporter(config: SentryConfig): ErrorReporter {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: 0,
    // Collect nothing that could be personal or health data (ADR 0016).
    includeServerName: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'Console'),
    beforeSend: (event) => {
      delete event.extra;
      delete event.user;
      delete event.request;
      return event;
    },
    beforeBreadcrumb: (crumb) => (crumb.category === 'console' ? null : { ...crumb, data: {} }),
  });
  return {
    enabled: true,
    capture(error, context = {}) {
      Sentry.withScope((scope) => {
        for (const [key, value] of Object.entries(context)) {
          if (typeof value === 'string') scope.setTag(key, value);
        }
        Sentry.captureException(error);
      });
    },
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
  };
}
