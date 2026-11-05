import {
  APP_PLATFORMS,
  APP_VERSION_PATTERN,
  FILE_UPLOAD_URL_MAX_TTL_S,
  compareAppVersions,
  isAppVersion,
  type AppPlatform,
} from '@sport-performance/domain';
import {
  storageConfigOf,
  storageEnvProblems,
  storageEnvShape,
  type S3StorageConfig,
} from '@sport-performance/storage';
import { z } from 'zod';
import { databaseUrlProblems, secretProblems } from '../security/secrets.js';

const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');
const httpUrl = z.url({ protocol: /^https?$/ });
const httpsUrl = z.url({ protocol: /^https$/ });
/** Native version of the mobile app: `MAJOR.MINOR.PATCH`. */
const appVersion = z.string().regex(APP_VERSION_PATTERN);

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
 * `AUTH_SECRET`, `RESEND_API_KEY`, `STORAGE_SECRET_ACCESS_KEY`, `OPS_MONITOR_TOKEN`) never appear in error
 * messages or logs.
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
    /** Largest JSON body. Files never go through the API: they go to the bucket with signed URLs (B-325). */
    BODY_LIMIT_BYTES: integer(1024, 10 * 1024 * 1024).default(1024 * 1024),

    // HTTP server timeouts and connection limits (ADR 0031)
    /** Whole request (headers + body) must arrive within this; slow-loris defense. */
    HTTP_REQUEST_TIMEOUT_MS: integer(1000, 300_000).default(30_000),
    /** Headers must arrive within this; at most `HTTP_REQUEST_TIMEOUT_MS`. */
    HTTP_HEADERS_TIMEOUT_MS: integer(1000, 120_000).default(10_000),
    /** Idle keep-alive connections are closed after this; above the proxy's idle timeout. */
    HTTP_KEEP_ALIVE_TIMEOUT_MS: integer(1000, 600_000).default(72_000),
    /** A socket with no activity for this long is destroyed (a stuck request included). */
    HTTP_CONNECTION_TIMEOUT_MS: integer(1000, 600_000).default(60_000),
    /** Concurrent sockets per replica; past it new connections are refused. */
    HTTP_MAX_CONNECTIONS: integer(10, 100_000).default(2048),
    /** Request line + headers. Bounds URLs and query strings too. */
    HTTP_MAX_HEADER_SIZE_BYTES: integer(4096, 65_536).default(16_384),

    // General rate limits (ADR 0031). `false` only for load tests in a non-production environment.
    RATE_LIMIT_ENABLED: booleanFlag.default(true),
    /** Past this the counter store is considered down and requests go through. */
    RATE_LIMIT_TIMEOUT_MS: integer(50, 10_000).default(500),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: integer(1, 100).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: integer(100, 60_000).default(5000),
    DATABASE_STATEMENT_TIMEOUT_MS: integer(100, 600_000).default(15_000),
    HEALTH_DB_TIMEOUT_MS: integer(100, 30_000).default(2000),
    /**
     * Bearer token of `GET /health/ops` for the uptime monitor (B-703, ADR 0095).
     * Unset: the route does not exist. 32+ random characters in production.
     */
    OPS_MONITOR_TOKEN: z
      .string()
      .min(32)
      .max(512)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
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

    // Versions of the mobile app (B-324, ADR 0045): one policy per store, for every club.
    /** Oldest native version the API serves; older apps get `426 app_update_required`. */
    APP_MIN_VERSION_IOS: appVersion.default('0.0.0'),
    APP_MIN_VERSION_ANDROID: appVersion.default('0.0.0'),
    /** Newest version in the store: older apps (at or above the minimum) see a dismissible notice. */
    APP_LATEST_VERSION_IOS: appVersion.optional(),
    APP_LATEST_VERSION_ANDROID: appVersion.optional(),
    /** Link of the app in each store, for the "actualizá la app" screen. */
    APP_STORE_URL_IOS: httpsUrl.optional(),
    APP_STORE_URL_ANDROID: httpsUrl.optional(),

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

    /**
     * Owner and worker logins of the release step (`db:release`, the pre-deploy command,
     * ADR 0090). Read only to refuse them: the API process must never hold them in
     * production (the image's command removes them, `apps/api/Dockerfile`).
     */
    MIGRATIONS_DATABASE_URL: z.string().optional(),
    WORKER_DATABASE_URL: z.string().optional(),

    // Files (B-325, ADR 0044): the S3-compatible bucket and the life of the signed URLs.
    ...storageEnvShape,
    /** Life of a signed upload URL; a new one is asked with the same `clientUuid`. */
    FILE_UPLOAD_URL_TTL_S: integer(60, FILE_UPLOAD_URL_MAX_TTL_S).default(900),
    /** Life of a signed download URL: short, the files are personal. */
    FILE_DOWNLOAD_URL_TTL_S: integer(30, 3600).default(300),
    /** Life of the crest URL of the public theme; above the theme's cache (300 s). */
    FILE_LOGO_URL_TTL_S: integer(600, 86_400).default(3600),
  })
  .superRefine((env, ctx) => {
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
    if (env.HTTP_HEADERS_TIMEOUT_MS > env.HTTP_REQUEST_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['HTTP_HEADERS_TIMEOUT_MS'],
        message: 'must not exceed HTTP_REQUEST_TIMEOUT_MS',
      });
    }
    for (const platform of APP_PLATFORMS) {
      const suffix = platform.toUpperCase() as Uppercase<AppPlatform>;
      const latest = env[`APP_LATEST_VERSION_${suffix}`];
      const min = env[`APP_MIN_VERSION_${suffix}`];
      // Refinements run even when a field failed: compare only well-formed versions.
      if (isAppVersion(latest) && isAppVersion(min) && compareAppVersions(latest, min) < 0) {
        ctx.addIssue({
          code: 'custom',
          path: [`APP_LATEST_VERSION_${suffix}`],
          message: `must not be older than APP_MIN_VERSION_${suffix}`,
        });
      }
    }
    if (env.NODE_ENV !== 'production') return;
    // Secrets of production: long, unpredictable, not the example values (ADR 0031).
    for (const message of secretProblems(env.AUTH_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_SECRET'], message });
    }
    if (env.OPS_MONITOR_TOKEN !== undefined) {
      for (const message of secretProblems(env.OPS_MONITOR_TOKEN)) {
        ctx.addIssue({ code: 'custom', path: ['OPS_MONITOR_TOKEN'], message });
      }
      if (env.OPS_MONITOR_TOKEN === env.AUTH_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['OPS_MONITOR_TOKEN'],
          message: 'must not be the same value as AUTH_SECRET',
        });
      }
    }
    if (env.RESEND_API_KEY !== undefined && env.RESEND_API_KEY.length < 20) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is too short to be a Resend API key',
      });
    }
    for (const variable of ['DATABASE_URL', 'AUTH_DATABASE_URL'] as const) {
      for (const message of databaseUrlProblems(env[variable])) {
        ctx.addIssue({ code: 'custom', path: [variable], message });
      }
    }
    // The release step's logins stay in the pre-deploy container: with the owner's URL a
    // flaw in the API would bypass RLS, with the worker's it would act as the worker.
    for (const variable of ['MIGRATIONS_DATABASE_URL', 'WORKER_DATABASE_URL'] as const) {
      if (env[variable] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [variable],
          message: 'must not reach the API process in production (only db:release uses it)',
        });
      }
    }
    if (env.DATABASE_URL === env.AUTH_DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DATABASE_URL'],
        message: 'must be a different login than DATABASE_URL',
      });
    }
    if (!env.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_ENABLED'],
        message: 'cannot be disabled in production',
      });
    }
    // The session cookie only travels to https web origins in production.
    for (const origin of env.WEB_ORIGINS ?? []) {
      if (!origin.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_ORIGINS'],
          message: 'every origin must be https in production',
        });
        break;
      }
    }
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
  http: HttpServerConfig;
  rateLimit: RateLimitConfig;
  /** Response headers of ADR 0031. */
  securityHeaders: { hsts: boolean };
  log: { level: LogLevel };
  database: {
    url: string;
    poolMax: number;
    connectTimeoutMs: number;
    statementTimeoutMs: number;
  };
  health: {
    databaseTimeoutMs: number;
    /** `null`: no `/health/ops`. Never logged. */
    opsMonitorToken?: string | null;
  };
  shutdownTimeoutMs: number;
  /** `null` when `SENTRY_DSN` is unset: Sentry stays disabled. */
  sentry: SentryConfig | null;
  auth: AuthConfig;
  email: EmailConfig;
  files: FilesConfig;
  /** Versions policy of the mobile app, by platform (ADR 0045). */
  mobileApp: MobileAppConfig;
}

export interface FilesConfig {
  /** `null` outside production when the bucket is not configured: file endpoints answer `503`. */
  storage: S3StorageConfig | null;
  uploadUrlTtlS: number;
  downloadUrlTtlS: number;
  logoUrlTtlS: number;
}

/** Versions policy of the app in one store. */
export interface MobileAppPolicy {
  minVersion: string;
  /** `null`: no newer version announced, so no soft notice. */
  latestVersion: string | null;
  /** `null` until the app is published in that store. */
  storeUrl: string | null;
}

export type MobileAppConfig = Readonly<Record<AppPlatform, MobileAppPolicy>>;

export interface HttpServerConfig {
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
  connectionTimeoutMs: number;
  maxConnections: number;
  maxHeaderSizeBytes: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  timeoutMs: number;
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

/**
 * What the API logs about its configuration at startup: limits, timeouts,
 * origins and which integrations are on. No secret, no connection string.
 */
export function configSummary(config: ApiConfig) {
  return {
    nodeEnv: config.nodeEnv,
    version: config.version,
    trustProxyHops: config.trustProxyHops,
    bodyLimitBytes: config.bodyLimitBytes,
    http: config.http,
    rateLimit: config.rateLimit,
    securityHeaders: config.securityHeaders,
    database: {
      poolMax: config.database.poolMax,
      statementTimeoutMs: config.database.statementTimeoutMs,
    },
    auth: {
      baseUrl: config.auth.baseUrl,
      secureCookies: config.auth.secureCookies,
      webOrigins: config.auth.webOrigins,
      poolMax: config.auth.database.poolMax,
    },
    email: { resend: config.email.resendApiKey !== null },
    files: {
      storage:
        config.files.storage === null
          ? null
          : { endpoint: config.files.storage.endpoint, bucket: config.files.storage.bucket },
      uploadUrlTtlS: config.files.uploadUrlTtlS,
      downloadUrlTtlS: config.files.downloadUrlTtlS,
      logoUrlTtlS: config.files.logoUrlTtlS,
    },
    mobileApp: config.mobileApp,
    sentry: config.sentry !== null,
    // Whether the ops probe is on, never the token.
    opsHealth: (config.health.opsMonitorToken ?? null) !== null,
  };
}

/** The environment is invalid. The message names variables and problems, never values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly variables: readonly string[];

  constructor(issues: readonly z.core.$ZodIssue[], env: Env) {
    const variables = [...new Set(issues.map((issue) => String(issue.path[0])))];
    const lines = variables.map((variable) => {
      if (env[variable] === undefined) return `${variable}: required`;
      const own = issues.filter((issue) => String(issue.path[0]) === variable);
      // Our own (custom) messages are written without values; zod's are not shown.
      const messages = own.filter((issue) => issue.code === 'custom').map((issue) => issue.message);
      const codes = own.filter((issue) => issue.code !== 'custom').map((issue) => issue.code);
      const parts: string[] = [...new Set(codes)];
      if (messages.length > 0) parts.push(...new Set(messages));
      return `${variable}: invalid (${parts.join('; ')})`;
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
    http: {
      requestTimeoutMs: e.HTTP_REQUEST_TIMEOUT_MS,
      headersTimeoutMs: e.HTTP_HEADERS_TIMEOUT_MS,
      keepAliveTimeoutMs: e.HTTP_KEEP_ALIVE_TIMEOUT_MS,
      connectionTimeoutMs: e.HTTP_CONNECTION_TIMEOUT_MS,
      maxConnections: e.HTTP_MAX_CONNECTIONS,
      maxHeaderSizeBytes: e.HTTP_MAX_HEADER_SIZE_BYTES,
    },
    rateLimit: { enabled: e.RATE_LIMIT_ENABLED, timeoutMs: e.RATE_LIMIT_TIMEOUT_MS },
    securityHeaders: { hsts: e.NODE_ENV === 'production' },
    log: { level: e.LOG_LEVEL },
    database: {
      url: e.DATABASE_URL,
      poolMax: e.DATABASE_POOL_MAX,
      connectTimeoutMs: e.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    health: {
      databaseTimeoutMs: e.HEALTH_DB_TIMEOUT_MS,
      opsMonitorToken: e.OPS_MONITOR_TOKEN ?? null,
    },
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
    files: {
      storage: storageConfigOf(e),
      uploadUrlTtlS: e.FILE_UPLOAD_URL_TTL_S,
      downloadUrlTtlS: e.FILE_DOWNLOAD_URL_TTL_S,
      logoUrlTtlS: e.FILE_LOGO_URL_TTL_S,
    },
    mobileApp: {
      ios: {
        minVersion: e.APP_MIN_VERSION_IOS,
        latestVersion: e.APP_LATEST_VERSION_IOS ?? null,
        storeUrl: e.APP_STORE_URL_IOS ?? null,
      },
      android: {
        minVersion: e.APP_MIN_VERSION_ANDROID,
        latestVersion: e.APP_LATEST_VERSION_ANDROID ?? null,
        storeUrl: e.APP_STORE_URL_ANDROID ?? null,
      },
    },
  };
}
