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
/** The web app of `pnpm dev` (the same default as the API's). */
const LOCAL_WEB_URL = 'http://localhost:5173';

/** A lowercase DNS name with at least two labels (`demo.club.app`). */
const DOMAIN_NAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Domains reserved by RFC 2606 / RFC 6761 that never receive email: a demo
 * catch-all among them would only bounce (the demo's own accounts are
 * `@example.com`, ADR 0055).
 */
export function isReservedEmailDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (['example.com', 'example.net', 'example.org'].some((r) => d === r || d.endsWith(`.${r}`))) {
    return true;
  }
  const tld = d.slice(d.lastIndexOf('.') + 1);
  return ['example', 'invalid', 'test', 'localhost', 'local'].includes(tld);
}

/** The comma-separated domains of `DEMO_NOTIFICATION_EMAIL_DOMAINS`, lowercase and unique. */
const demoEmailDomains = z
  .string()
  .max(2000)
  .transform((value, ctx) => {
    const domains = [
      ...new Set(
        value
          .split(',')
          .map((d) => d.trim().toLowerCase())
          .filter((d) => d !== ''),
      ),
    ];
    for (const domain of domains) {
      if (!DOMAIN_NAME.test(domain)) {
        ctx.addIssue({ code: 'custom', message: 'expects comma-separated domain names' });
        return z.NEVER;
      }
      if (isReservedEmailDomain(domain)) {
        ctx.addIssue({ code: 'custom', message: 'reserved domains never receive email' });
        return z.NEVER;
      }
    }
    return domains;
  });

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
    // Notifications (B-328, ADR 0054)
    /** Empty = notification emails are written to the log instead of sent (development only). */
    RESEND_API_KEY: z.string().min(10).max(256).optional(),
    /** `Name <address@domain>` of a domain verified in Resend (the same as the API's). */
    EMAIL_FROM: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[^<>@\s]+@[^<>@\s]+$|^[^<>]*<[^<>@\s]+@[^<>@\s]+>$/)
      .optional(),
    /** The web app, for the links of the notification emails. */
    WEB_APP_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Expo access token, when the project enables "enhanced security for push". Never logged. */
    EXPO_ACCESS_TOKEN: z.string().min(10).max(256).optional(),
    /** `off`: no notifications at all (a staging copy of production data, for example). */
    NOTIFICATIONS: z.enum(['on', 'off']).default('on'),
    /**
     * Demo clubs (`club.is_demo`, ADR 0055) deliver nothing, except to users
     * whose email is of one of these domains (catch-all mailboxes of staging).
     */
    DEMO_NOTIFICATION_EMAIL_DOMAINS: demoEmailDomains.default([]),
  })
  .superRefine((env, ctx) => {
    // The bucket of the file retention job (ADR 0044): all of its variables or none.
    for (const problem of storageEnvProblems(env, env.NODE_ENV === 'production')) {
      ctx.addIssue({ code: 'custom', path: [problem.variable], message: problem.message });
    }
    if (env.RESEND_API_KEY !== undefined && env.EMAIL_FROM === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'required with RESEND_API_KEY',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.NOTIFICATIONS === 'on') {
      for (const variable of ['RESEND_API_KEY', 'WEB_APP_URL'] as const) {
        if (env[variable] === undefined) {
          ctx.addIssue({ code: 'custom', path: [variable], message: 'required in production' });
        }
      }
      if (env.WEB_APP_URL !== undefined && !env.WEB_APP_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_APP_URL'],
          message: 'must be https in production',
        });
      }
    }
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
  /** `null` when `NOTIFICATIONS=off`. Secrets are never logged. */
  readonly notifications: {
    /** `null`: emails go to the log (development only). */
    readonly resend: { readonly apiKey: string; readonly from: string } | null;
    readonly webAppUrl: string;
    readonly expoAccessToken: string | undefined;
    /** The only domains a demo club delivers to; empty = a demo club delivers nothing. */
    readonly demoEmailDomains: readonly string[];
  } | null;
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
    notifications:
      e.NOTIFICATIONS === 'off'
        ? null
        : {
            resend:
              e.RESEND_API_KEY === undefined || e.EMAIL_FROM === undefined
                ? null
                : { apiKey: e.RESEND_API_KEY, from: e.EMAIL_FROM },
            webAppUrl: (e.WEB_APP_URL ?? LOCAL_WEB_URL).replace(/\/+$/, ''),
            expoAccessToken: e.EXPO_ACCESS_TOKEN,
            demoEmailDomains: e.DEMO_NOTIFICATION_EMAIL_DOMAINS,
          },
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
    notifications:
      config.notifications === null
        ? null
        : {
            email: config.notifications.resend === null ? 'log' : 'resend',
            // How many, not which: the domains say little, but the summary stays minimal.
            demoEmailDomains: config.notifications.demoEmailDomains.length,
          },
  };
}
