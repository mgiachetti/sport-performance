import { z } from 'zod';

const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const httpUrl = z.url({ protocol: /^https?$/ });

/** `https://app.example.com,http://localhost:5173` → origins without trailing slash. */
const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
  .pipe(z.array(httpUrl.transform((url) => new URL(url).origin)));

/** Defaults of the identity flows when running locally (web of Vite on 5173). */
const LOCAL_WEB_URL = 'http://localhost:5173';

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
 * `apps/api/.env.example`. Secrets (`DATABASE_URL`, `AUTH_DATABASE_URL`, `SENTRY_DSN`,
 * `AUTH_SECRET`, `RESEND_API_KEY`) never appear in error messages or logs.
 */
export const envSchema = z
  .object({
    ...sentryShape,
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: integer(0, 65_535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /**
     * Number of proxies in front of the API (Railway: 1). `0` trusts none.
     * Default `0` outside production; required and at least `1` in production,
     * where the client IP keys the per-IP sign-in limits (ADR 0028).
     */
    TRUST_PROXY_HOPS: integer(0, 10).optional(),
    BODY_LIMIT_BYTES: integer(1024, 50 * 1024 * 1024).default(1024 * 1024),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: integer(1, 100).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: integer(100, 60_000).default(5000),
    DATABASE_STATEMENT_TIMEOUT_MS: integer(100, 600_000).default(15_000),
    HEALTH_DB_TIMEOUT_MS: integer(100, 30_000).default(2000),
    SHUTDOWN_TIMEOUT_MS: integer(1000, 120_000).default(10_000),

    // Auth (ADR 0010, ADR 0028)
    /** Signs session cookies and keys the attempt counters. 32+ random characters; rotate = sign everyone out. */
    AUTH_SECRET: z.string().min(32).max(512),
    /** Public URL of this API. Default `http://localhost:<PORT>`; `https` sets `Secure` cookies. */
    AUTH_BASE_URL: httpUrl.optional(),
    /**
     * Better Auth's own connection (sessions, codes, attempt counters): a login of
     * `sport_performance_auth` (ADR 0026), never the one of `DATABASE_URL`.
     */
    AUTH_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    AUTH_DATABASE_POOL_MAX: integer(1, 50).default(5),
    SESSION_EXPIRES_IN_DAYS: integer(1, 365).default(30),
    /** Origins of the web app allowed to call with the session cookie (CORS + CSRF). */
    WEB_ORIGINS: originList.optional(),
    /** Base of the universal links of invitations (`<WEB_APP_URL>/invite/<token>`). */
    WEB_APP_URL: httpUrl.optional(),
    /** Scheme of the Expo app deep links (`<scheme>://invite/<token>`). */
    APP_DEEP_LINK_SCHEME: z
      .string()
      .regex(/^[a-z][a-z0-9+.-]{1,31}$/)
      .default('sportperformance'),

    // Email (Resend + React Email)
    /** Empty = emails are written to the log instead of sent (development only). */
    RESEND_API_KEY: z.string().min(10).max(256).optional(),
    /** `Name <address@domain>` of a domain verified in Resend. */
    EMAIL_FROM: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[^<>@\s]+@[^<>@\s]+$|^[^<>]*<[^<>@\s]+@[^<>@\s]+>$/)
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.RESEND_API_KEY !== undefined && env.EMAIL_FROM === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'required with RESEND_API_KEY',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    // In production the identity flows cannot fall back to local defaults.
    for (const variable of ['RESEND_API_KEY', 'AUTH_BASE_URL', 'WEB_APP_URL'] as const) {
      if (env[variable] === undefined) {
        ctx.addIssue({ code: 'custom', path: [variable], message: 'required in production' });
      }
    }
    // Behind Railway's proxy, with 0 hops every request comes from the edge's IP:
    // the per-IP limits of sign-in would be shared by every user (a global lockout).
    if (env.TRUST_PROXY_HOPS === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY_HOPS'],
        message: 'required in production',
      });
    } else if (env.TRUST_PROXY_HOPS < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY_HOPS'],
        message: 'must be at least 1 in production (Railway: 1)',
      });
    }
    for (const variable of ['AUTH_BASE_URL', 'WEB_APP_URL'] as const) {
      const value = env[variable];
      if (value !== undefined && !value.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: [variable], message: 'must be https in production' });
      }
    }
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
  auth: AuthConfig;
  email: EmailConfig;
}

export interface AuthConfig {
  /** Never logged. */
  secret: string;
  /** Public origin of the API (Better Auth `baseURL`). */
  baseUrl: string;
  /** `Secure` cookies with the `__Secure-` prefix: true when `baseUrl` is https. */
  secureCookies: boolean;
  sessionExpiresInS: number;
  /** Web origins allowed to use the session cookie. */
  webOrigins: readonly string[];
  links: {
    /** `https://app.example.com`: universal links are `<webAppUrl>/invite/<token>`. */
    webAppUrl: string;
    /** `sportperformance`: deep links are `<appScheme>://invite/<token>`. */
    appScheme: string;
  };
  database: { url: string; poolMax: number };
}

export interface EmailConfig {
  /** `null`: development transport that writes emails to the log. Never logged. */
  resendApiKey: string | null;
  from: string;
}

/** The environment is invalid. The message names variables and problems, never values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly variables: readonly string[];

  constructor(issues: readonly z.core.$ZodIssue[], env: Env) {
    const variables = [...new Set(issues.map((issue) => String(issue.path[0])))];
    const lines = variables.map((variable) => {
      if (env[variable] === undefined) return `${variable}: required`;
      const codes = issues
        .filter((issue) => String(issue.path[0]) === variable)
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
    trustProxyHops: e.TRUST_PROXY_HOPS ?? 0,
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
    auth: {
      secret: e.AUTH_SECRET,
      baseUrl: new URL(e.AUTH_BASE_URL ?? `http://localhost:${String(e.PORT)}`).origin,
      secureCookies: (e.AUTH_BASE_URL ?? '').startsWith('https://'),
      sessionExpiresInS: e.SESSION_EXPIRES_IN_DAYS * 24 * 60 * 60,
      webOrigins: e.WEB_ORIGINS ?? (e.NODE_ENV === 'production' ? [] : [LOCAL_WEB_URL]),
      links: {
        webAppUrl: (e.WEB_APP_URL ?? LOCAL_WEB_URL).replace(/\/+$/, ''),
        appScheme: e.APP_DEEP_LINK_SCHEME,
      },
      database: { url: e.AUTH_DATABASE_URL, poolMax: e.AUTH_DATABASE_POOL_MAX },
    },
    email: {
      resendApiKey: e.RESEND_API_KEY ?? null,
      from: e.EMAIL_FROM ?? 'Sport Performance <no-reply@localhost>',
    },
  };
}
