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

/**
 * An operational notice (B-703, ADR 0095): one Sentry issue per `fingerprint`,
 * so a check failing for hours is one issue, not one per pass. Tags are codes
 * and statuses, never ids of a club or a person.
 */
export interface OpsNotice {
  readonly message: string;
  readonly level: 'warning' | 'error';
  readonly fingerprint: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

/** A heartbeat of a scheduled job for Sentry Crons: a missing one is an alert in Sentry. */
export interface CronCheckIn {
  readonly monitorSlug: string;
  readonly status: 'ok' | 'error';
  /** Crontab of the job (UTC), declared with every check-in: the monitor is configuration as code. */
  readonly crontab: string;
  /** Minutes late before Sentry counts the check-in as missed. */
  readonly marginMinutes: number;
  /** Minutes a run may take. */
  readonly maxRuntimeMinutes: number;
  /** Consecutive misses or errors before Sentry opens an issue. */
  readonly failureIssueThreshold: number;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  capture(error: unknown, context?: ErrorReportContext): void;
  notice(notice: OpsNotice): void;
  checkIn(checkIn: CronCheckIn): void;
  flush(timeoutMs: number): Promise<boolean>;
}

export const disabledErrorReporter: ErrorReporter = {
  enabled: false,
  capture() {
    // Disabled: the error is still logged.
  },
  notice() {
    // Disabled: the notice is still logged.
  },
  checkIn() {
    // Disabled: nothing watches the schedule but `/health/ops`.
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
    notice(notice) {
      Sentry.captureMessage(notice.message, {
        level: notice.level,
        fingerprint: [...notice.fingerprint],
        tags: { ...notice.tags },
      });
    },
    checkIn(checkIn) {
      Sentry.captureCheckIn(
        { monitorSlug: checkIn.monitorSlug, status: checkIn.status },
        {
          schedule: { type: 'crontab', value: checkIn.crontab },
          timezone: 'Etc/UTC',
          checkinMargin: checkIn.marginMinutes,
          maxRuntime: checkIn.maxRuntimeMinutes,
          failureIssueThreshold: checkIn.failureIssueThreshold,
          recoveryThreshold: 1,
        },
      );
    },
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
  };
}
