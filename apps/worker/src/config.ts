import {
  storageConfigOf,
  storageEnvProblems,
  storageEnvShape,
  type S3StorageConfig,
} from '@sport-performance/storage';
import { z } from 'zod';

const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** A database password that is clearly an example (`postgres`, `changeme`, `<password>`). */
const PLACEHOLDER = /^(postgres|password|changeme|change-me|secret|example|<.*>|x+)$/i;
const MIN_DATABASE_PASSWORD_LENGTH = 16;

/**
 * Environment variables of the worker, documented in `apps/worker/.env.example`.
 * Secrets (`DATABASE_URL`, `SENTRY_DSN`) never appear in error messages or logs.
 */
export const envSchema = z
  .object({
    ...storageEnvShape,
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** A login of `sport_performance_worker` (ADR 0026), never the owner. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Connections of the worker's own queries (pg-boss keeps its own, smaller pool). */
    DATABASE_POOL_MAX: integer(1, 50).default(5),
    DATABASE_CONNECT_TIMEOUT_MS: integer(100, 60_000).default(5000),
    /** A recalculation of one player is a few statements; this bounds a stuck one. */
    DATABASE_STATEMENT_TIMEOUT_MS: integer(1000, 600_000).default(60_000),
    JOB_QUEUE_POOL_MAX: integer(2, 20).default(4),
    /** Clubs recalculated at the same time by this replica. */
    WORKER_CLUB_CONCURRENCY: integer(1, 32).default(2),
    /** How long a stop waits for the jobs in progress before giving up. */
    SHUTDOWN_TIMEOUT_MS: integer(1000, 600_000).default(30_000),
    SENTRY_DSN: z.url({ protocol: /^https?$/ }).optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
    /** Set by Railway on every deploy; used as environment when `SENTRY_ENVIRONMENT` is unset. */
    RAILWAY_ENVIRONMENT_NAME: z.string().min(1).max(64).optional(),
    APP_VERSION: z.string().min(1).max(64).optional(),
    /** Set by Railway on every deploy; used as version when `APP_VERSION` is unset. */
    RAILWAY_GIT_COMMIT_SHA: z.string().min(1).max(64).optional(),
  })
  .superRefine((env, ctx) => {
    // The bucket of the file retention job (ADR 0044): all of its variables or none.
    for (const problem of storageEnvProblems(env, env.NODE_ENV === 'production')) {
      ctx.addIssue({ code: 'custom', path: [problem.variable], message: problem.message });
    }
    if (env.NODE_ENV !== 'production') return;
    let password = '';
    try {
      password = decodeURIComponent(new URL(env.DATABASE_URL).password);
    } catch {
      // The URL shape is already validated above.
    }
    if (password.length < MIN_DATABASE_PASSWORD_LENGTH || PLACEHOLDER.test(password)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: `needs a real password of at least ${String(MIN_DATABASE_PASSWORD_LENGTH)} characters in production`,
      });
    }
  });

export interface SentryConfig {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string;
}

export interface WorkerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly version: string;
  readonly log: { readonly level: LogLevel };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
    readonly connectTimeoutMs: number;
    readonly statementTimeoutMs: number;
  };
  readonly jobQueue: { readonly poolMax: number };
  readonly clubConcurrency: number;
  readonly shutdownTimeoutMs: number;
  /** `null` when `SENTRY_DSN` is unset. */
  readonly sentry: SentryConfig | null;
  /** The bucket of uploaded files; `null` (development only) turns file retention off. Never logged. */
  readonly storage: S3StorageConfig | null;
}

/** Invalid environment: the message names the variables, never their values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Unset and empty are the same (`.env.example` leaves optional variables empty). */
function withoutEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') result[key] = value;
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid worker environment:\n- ${problems.join('\n- ')}`);
  }
  const e = parsed.data;
  const version = e.APP_VERSION ?? e.RAILWAY_GIT_COMMIT_SHA ?? 'dev';
  return {
    nodeEnv: e.NODE_ENV,
    version,
    log: { level: e.LOG_LEVEL },
    database: {
      url: e.DATABASE_URL,
      poolMax: e.DATABASE_POOL_MAX,
      connectTimeoutMs: e.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    jobQueue: { poolMax: e.JOB_QUEUE_POOL_MAX },
    clubConcurrency: e.WORKER_CLUB_CONCURRENCY,
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
    storage: storageConfigOf(e),
    sentry:
      e.SENTRY_DSN === undefined
        ? null
        : {
            dsn: e.SENTRY_DSN,
            environment: e.SENTRY_ENVIRONMENT ?? e.RAILWAY_ENVIRONMENT_NAME ?? e.NODE_ENV,
            release: version,
          },
  };
}

/** What is safe to log about the configuration: no URLs, no secrets. */
export function configSummary(config: WorkerConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    poolMax: config.database.poolMax,
    jobQueuePoolMax: config.jobQueue.poolMax,
    clubConcurrency: config.clubConcurrency,
    sentry: config.sentry !== null,
    storage: config.storage === null ? null : { bucket: config.storage.bucket },
  };
}
