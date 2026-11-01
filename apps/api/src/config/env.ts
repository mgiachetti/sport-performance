import { z } from 'zod';

const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const sentryShape = {
  SENTRY_DSN: z.url({ protocol: /^https?$/ }).optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  /** Set by Railway on every deploy; used as environment when `SENTRY_ENVIRONMENT` is unset. */
  RAILWAY_ENVIRONMENT_NAME: z.string().min(1).max(64).optional(),
  APP_VERSION: z.string().min(1).max(64).optional(),
  /** Set by Railway on every deploy; used as version when `APP_VERSION` is unset. */
  RAILWAY_GIT_COMMIT_SHA: z.string().min(1).max(64).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
};

/**
 * Environment variables of the API. Every variable is documented in
 * `apps/api/.env.example`. Secrets (`DATABASE_URL`, `SENTRY_DSN`) never
 * appear in error messages or logs.
 */
export const envSchema = z.object({
  ...sentryShape,
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: integer(0, 65_535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Number of proxies in front of the API (Railway: 1). `0` trusts none. */
  TRUST_PROXY_HOPS: integer(0, 10).default(0),
  BODY_LIMIT_BYTES: integer(1024, 50 * 1024 * 1024).default(1024 * 1024),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: integer(1, 100).default(10),
  DATABASE_CONNECT_TIMEOUT_MS: integer(100, 60_000).default(5000),
  DATABASE_STATEMENT_TIMEOUT_MS: integer(100, 600_000).default(15_000),
  HEALTH_DB_TIMEOUT_MS: integer(100, 30_000).default(2000),
  SHUTDOWN_TIMEOUT_MS: integer(1000, 120_000).default(10_000),
});

export interface SentryConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
}

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  version: string;
  host: string;
  port: number;
  trustProxyHops: number;
  bodyLimitBytes: number;
  log: { level: LogLevel };
  database: {
    url: string;
    poolMax: number;
    connectTimeoutMs: number;
    statementTimeoutMs: number;
  };
  health: { databaseTimeoutMs: number };
  shutdownTimeoutMs: number;
  /** `null` when `SENTRY_DSN` is unset: Sentry stays disabled. */
  sentry: SentryConfig | null;
}

/** The environment is invalid. The message names variables and problems, never values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly variables: readonly string[];

  constructor(issues: readonly z.core.$ZodIssue[], env: Env) {
    const variables = [...new Set(issues.map((issue) => issue.path.map(String).join('.')))];
    const lines = variables.map((variable) => {
      if (env[variable] === undefined) return `${variable}: required`;
      const codes = issues
        .filter((issue) => issue.path.map(String).join('.') === variable)
        .map((issue) => issue.code);
      return `${variable}: invalid (${[...new Set(codes)].join(', ')})`;
    });
    super(`Invalid environment configuration:\n  ${lines.join('\n  ')}`);
    this.variables = variables;
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

const sentryEnvSchema = z.object(sentryShape);

/** Empty strings count as unset, so `FOO=` in a `.env` file falls back to the default. */
function withoutEmpty(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

function versionOf(env: {
  APP_VERSION?: string | undefined;
  RAILWAY_GIT_COMMIT_SHA?: string | undefined;
}) {
  return env.APP_VERSION ?? env.RAILWAY_GIT_COMMIT_SHA ?? 'dev';
}

function sentryOf(env: z.output<typeof sentryEnvSchema>): SentryConfig | null {
  if (env.SENTRY_DSN === undefined) return null;
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV,
    release: versionOf(env),
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  };
}

/**
 * Reads only the Sentry variables. `instrument.ts` uses it to start Sentry
 * before anything else is imported; an invalid value returns `null` there and
 * {@link loadConfig} reports it when the app starts.
 */
export function loadSentryConfig(env: Env = process.env): SentryConfig | null {
  const parsed = sentryEnvSchema.safeParse(withoutEmpty(env));
  return parsed.success ? sentryOf(parsed.data) : null;
}

/** Validates the environment once at startup. Throws {@link ConfigError}. */
export function loadConfig(env: Env = process.env): ApiConfig {
  const cleaned = withoutEmpty(env);
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) throw new ConfigError(parsed.error.issues, cleaned);
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    version: versionOf(e),
    host: e.HOST,
    port: e.PORT,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    bodyLimitBytes: e.BODY_LIMIT_BYTES,
    log: { level: e.LOG_LEVEL },
    database: {
      url: e.DATABASE_URL,
      poolMax: e.DATABASE_POOL_MAX,
      connectTimeoutMs: e.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    health: { databaseTimeoutMs: e.HEALTH_DB_TIMEOUT_MS },
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
    sentry: sentryOf(e),
  };
}
