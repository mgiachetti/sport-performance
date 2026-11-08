import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memoryLogger } from '../testing/support.js';
import { ConfigError, configSummary, loadConfig, loadSentryConfig } from './env.js';

const DATABASE_URL = 'postgres://api:pa55word@localhost:5432/sport_performance';
const AUTH_DATABASE_URL = 'postgres://auth:pa55word@localhost:5432/sport_performance';
const AUTH_SECRET = 'a-test-secret-of-at-least-32-characters!!';
/** Obviously fake: never anything shaped like a real Resend key. */
const RESEND_KEY_PLACEHOLDER = 'placeholder-resend-key';
/** Production-grade values, generated per run so no strong-looking secret is committed. */
const strongSecret = () => randomBytes(48).toString('base64url');
const OPS_TOKEN = strongSecret();
const strongDatabaseUrl = (user: string) =>
  `postgres://${user}:${randomBytes(24).toString('base64url')}@db.internal:5432/sport_performance`;

function configError(env: Record<string, string>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('applies defaults with only the required variables', () => {
    expect(loadConfig({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET })).toEqual({
      nodeEnv: 'development',
      version: 'dev',
      host: '0.0.0.0',
      port: 3000,
      trustProxyHops: 0,
      bodyLimitBytes: 1024 * 1024,
      http: {
        requestTimeoutMs: 30_000,
        headersTimeoutMs: 10_000,
        keepAliveTimeoutMs: 72_000,
        connectionTimeoutMs: 60_000,
        maxConnections: 2048,
        maxHeaderSizeBytes: 16_384,
      },
      rateLimit: { enabled: true, timeoutMs: 500 },
      securityHeaders: { hsts: false },
      log: { level: 'info' },
      database: {
        url: DATABASE_URL,
        poolMax: 10,
        connectTimeoutMs: 5000,
        statementTimeoutMs: 15_000,
      },
      health: { databaseTimeoutMs: 2000, opsMonitorToken: null },
      shutdownTimeoutMs: 10_000,
      sentry: null,
      auth: {
        secret: AUTH_SECRET,
        baseUrl: 'http://localhost:3000',
        secureCookies: false,
        sessionExpiresInS: 30 * 24 * 60 * 60,
        webOrigins: ['http://localhost:5173'],
        links: { webAppUrl: 'http://localhost:5173', appScheme: 'sportperformance' },
        database: { url: AUTH_DATABASE_URL, poolMax: 5 },
      },
      email: { resendApiKey: null, from: 'Sport Performance <no-reply@localhost>' },
      files: { storage: null, uploadUrlTtlS: 900, downloadUrlTtlS: 300, logoUrlTtlS: 3600 },
      podCommands: null,
      mobileApp: {
        ios: { minVersion: '0.0.0', latestVersion: null, storeUrl: null },
        android: { minVersion: '0.0.0', latestVersion: null, storeUrl: null },
      },
    });
  });

  it("takes the pods' command signing key with its id, only a P-256 one, never alone", async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    const base = { DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET };
    expect(
      loadConfig({ ...base, POD_COMMAND_SIGNING_KEY: key, POD_COMMAND_SIGNING_KEY_ID: 'srv-1' })
        .podCommands,
    ).toEqual({ signingKey: key, keyId: 'srv-1' });
    // Wrapped by `base64` or pasted with spaces: the whitespace is dropped.
    const wrapped = `${key.slice(0, 64)}\n${key.slice(64, 100)} \n${key.slice(100)}\n`;
    expect(
      loadConfig({ ...base, POD_COMMAND_SIGNING_KEY: wrapped, POD_COMMAND_SIGNING_KEY_ID: 'srv-1' })
        .podCommands,
    ).toEqual({ signingKey: key, keyId: 'srv-1' });
    expect(() => loadConfig({ ...base, POD_COMMAND_SIGNING_KEY: key })).toThrow(
      'POD_COMMAND_SIGNING_KEY_ID',
    );
    expect(() => loadConfig({ ...base, POD_COMMAND_SIGNING_KEY_ID: 'srv-1' })).toThrow(
      'POD_COMMAND_SIGNING_KEY',
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    let message = '';
    try {
      loadConfig({ ...base, POD_COMMAND_SIGNING_KEY: rsa, POD_COMMAND_SIGNING_KEY_ID: 'srv-1' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('POD_COMMAND_SIGNING_KEY');
    // The key never appears in the error.
    expect(message).not.toContain(rsa.slice(0, 40));
  });

  it('coerces numbers and treats empty strings as unset', () => {
    const config = loadConfig({
      DATABASE_URL,
      AUTH_DATABASE_URL,
      AUTH_SECRET,
      PORT: '8080',
      DATABASE_POOL_MAX: '4',
      TRUST_PROXY_HOPS: '1',
      LOG_LEVEL: '',
      SENTRY_DSN: '',
    });
    expect(config.port).toBe(8080);
    expect(config.database.poolMax).toBe(4);
    expect(config.trustProxyHops).toBe(1);
    expect(config.log.level).toBe('info');
    expect(config.sentry).toBeNull();
  });

  it('takes the version from APP_VERSION, then from Railway', () => {
    expect(
      loadConfig({
        DATABASE_URL,
        AUTH_DATABASE_URL,
        AUTH_SECRET,
        RAILWAY_GIT_COMMIT_SHA: 'a1b2c3d',
      }).version,
    ).toBe('a1b2c3d');
    expect(
      loadConfig({
        DATABASE_URL,
        AUTH_DATABASE_URL,
        AUTH_SECRET,
        APP_VERSION: '1.2.3',
        RAILWAY_GIT_COMMIT_SHA: 'a1b2c3d',
      }).version,
    ).toBe('1.2.3');
  });

  it('names every invalid variable', () => {
    const error = configError({ PORT: 'eighty', LOG_LEVEL: 'loud' });
    expect(error.variables).toEqual(expect.arrayContaining(['DATABASE_URL', 'PORT', 'LOG_LEVEL']));
    expect(error.message).toContain('DATABASE_URL: required');
    expect(error.message).toContain('PORT: invalid');
    expect(error.message).not.toContain('eighty');
  });

  it('never prints the value of a variable', () => {
    const error = configError({
      DATABASE_URL: 'mysql://api:pa55word@db:3306/x',
      AUTH_DATABASE_URL,
      AUTH_SECRET,
    });
    expect(error.variables).toEqual(['DATABASE_URL']);
    expect(error.message).not.toContain('pa55word');
    expect(error.message).not.toContain('mysql');
  });

  it('rejects out-of-range values', () => {
    expect(
      configError({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, DATABASE_POOL_MAX: '0' })
        .variables,
    ).toEqual(['DATABASE_POOL_MAX']);
    expect(
      configError({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, SENTRY_TRACES_SAMPLE_RATE: '2' })
        .variables,
    ).toEqual(['SENTRY_TRACES_SAMPLE_RATE']);
  });
});

describe('auth and email configuration', () => {
  const production = {
    DATABASE_URL: strongDatabaseUrl('api'),
    AUTH_SECRET: strongSecret(),
    NODE_ENV: 'production',
    RESEND_API_KEY: RESEND_KEY_PLACEHOLDER,
    EMAIL_FROM: 'Sport Performance <no-reply@sport.example.com>',
    AUTH_BASE_URL: 'https://api.sport.example.com/',
    WEB_APP_URL: 'https://app.sport.example.com/',
    WEB_ORIGINS: 'https://app.sport.example.com, https://staff.sport.example.com/',
    AUTH_DATABASE_URL: strongDatabaseUrl('auth'),
    TRUST_PROXY_HOPS: '1',
    STORAGE_ENDPOINT: 'https://storage.railway.app',
    STORAGE_BUCKET: 'sport-performance-files',
    STORAGE_ACCESS_KEY_ID: 'tid_placeholder',
    STORAGE_SECRET_ACCESS_KEY: strongSecret(),
  };

  it('takes the ops monitor token and checks it like a production secret (B-703)', () => {
    const token = strongSecret();
    expect(loadConfig({ ...production, OPS_MONITOR_TOKEN: token }).health.opsMonitorToken).toBe(
      token,
    );
    for (const value of [
      'change-me-to-a-long-random-ops-token-of-40-chars',
      'a'.repeat(40),
      production.AUTH_SECRET,
      'short',
      `${token} x`,
    ]) {
      expect(configError({ ...production, OPS_MONITOR_TOKEN: value }).variables).toEqual([
        'OPS_MONITOR_TOKEN',
      ]);
    }
  });

  it('logs a summary of the configuration without any secret', () => {
    const config = loadConfig({
      ...production,
      SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
      OPS_MONITOR_TOKEN: OPS_TOKEN,
    });
    const logs = memoryLogger();
    logs.logger.info({ config: configSummary(config) }, 'api ready');
    const raw = logs.raw();
    expect(raw).toContain('"maxConnections":2048');
    for (const secret of [
      production.AUTH_SECRET,
      production.RESEND_API_KEY,
      production.DATABASE_URL,
      production.AUTH_DATABASE_URL,
      new URL(production.DATABASE_URL).password,
      production.STORAGE_SECRET_ACCESS_KEY,
      production.STORAGE_ACCESS_KEY_ID,
      OPS_TOKEN,
      'o1.ingest.sentry.io',
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it('turns HSTS on in production only', () => {
    expect(loadConfig(production).securityHeaders).toEqual({ hsts: true });
    expect(loadConfig({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET }).securityHeaders).toEqual({
      hsts: false,
    });
  });

  it('refuses weak, placeholder or example secrets in production, without printing them', () => {
    const cases = [
      'change-me-to-a-long-random-string-of-48-characters',
      'a'.repeat(64),
      'abababababababababababababababababababab',
      '0123456789abcdef',
    ];
    for (const value of cases) {
      const error = configError({ ...production, AUTH_SECRET: value });
      expect(error.variables).toEqual(['AUTH_SECRET']);
      expect(error.message).not.toContain(value);
    }
    expect(configError({ ...production, AUTH_SECRET: 'a'.repeat(64) }).message).toContain(
      'too predictable',
    );
    expect(
      configError({
        ...production,
        AUTH_SECRET: 'change-me-to-a-long-random-string-of-48-characters',
      }).message,
    ).toContain('placeholder');
    // The same weak values are fine in development (the example `.env` uses one).
    expect(() =>
      loadConfig({
        DATABASE_URL,
        AUTH_DATABASE_URL,
        AUTH_SECRET: 'change-me-to-a-long-random-string-of-48-characters',
      }),
    ).not.toThrow();
  });

  it('refuses the owner and worker logins of the release step in the API process', () => {
    const owner = 'postgres://postgres:owner-password-0123456789@db.internal:5432/railway';
    const error = configError({
      ...production,
      MIGRATIONS_DATABASE_URL: owner,
      WORKER_DATABASE_URL: strongDatabaseUrl('worker'),
    });
    expect(error.variables).toEqual(['MIGRATIONS_DATABASE_URL', 'WORKER_DATABASE_URL']);
    expect(error.message).not.toContain('owner-password');
    // Outside production (local development, CI) a single .env may hold them.
    expect(() =>
      loadConfig({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, MIGRATIONS_DATABASE_URL: owner }),
    ).not.toThrow();
  });

  it('refuses database logins without a strong password in production', () => {
    const weak = 'postgres://sp_api:change-me-local-only@db.internal:5432/sport_performance';
    const error = configError({ ...production, DATABASE_URL: weak });
    expect(error.variables).toEqual(['DATABASE_URL']);
    expect(error.message).not.toContain('change-me-local-only');
    expect(
      configError({
        ...production,
        AUTH_DATABASE_URL: 'postgres://sp_auth@db.internal:5432/sport_performance',
      }).message,
    ).toContain('needs a password');
    expect(
      configError({ ...production, AUTH_DATABASE_URL: 'postgres://a:short@db.internal/x' })
        .variables,
    ).toEqual(['AUTH_DATABASE_URL']);
    expect(
      configError({ ...production, AUTH_DATABASE_URL: production.DATABASE_URL }).message,
    ).toContain('different login');
  });

  it('refuses a short Resend key, http web origins and disabled limits in production', () => {
    expect(configError({ ...production, RESEND_API_KEY: 'too-short-key' }).variables).toEqual([
      'RESEND_API_KEY',
    ]);
    const origins = configError({
      ...production,
      WEB_ORIGINS: 'https://app.sport.example.com,http://staff.sport.example.com',
    });
    expect(origins.variables).toEqual(['WEB_ORIGINS']);
    expect(origins.message).toContain('https');
    expect(configError({ ...production, RATE_LIMIT_ENABLED: 'false' }).variables).toEqual([
      'RATE_LIMIT_ENABLED',
    ]);
    expect(
      loadConfig({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, RATE_LIMIT_ENABLED: 'false' })
        .rateLimit.enabled,
    ).toBe(false);
    expect(
      configError({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, RATE_LIMIT_ENABLED: 'yes' })
        .variables,
    ).toEqual(['RATE_LIMIT_ENABLED']);
  });

  it('reads HTTP timeouts and keeps the headers timeout within the request timeout', () => {
    const config = loadConfig({
      DATABASE_URL,
      AUTH_DATABASE_URL,
      AUTH_SECRET,
      HTTP_REQUEST_TIMEOUT_MS: '20000',
      HTTP_HEADERS_TIMEOUT_MS: '5000',
      HTTP_MAX_CONNECTIONS: '100',
    });
    expect(config.http).toMatchObject({
      requestTimeoutMs: 20_000,
      headersTimeoutMs: 5000,
      maxConnections: 100,
    });
    const error = configError({
      DATABASE_URL,
      AUTH_DATABASE_URL,
      AUTH_SECRET,
      HTTP_REQUEST_TIMEOUT_MS: '5000',
      HTTP_HEADERS_TIMEOUT_MS: '10000',
    });
    expect(error.variables).toEqual(['HTTP_HEADERS_TIMEOUT_MS']);
    expect(error.message).toContain('must not exceed HTTP_REQUEST_TIMEOUT_MS');
    expect(
      configError({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, BODY_LIMIT_BYTES: '104857600' })
        .variables,
    ).toEqual(['BODY_LIMIT_BYTES']);
  });

  it('reads a production configuration', () => {
    const config = loadConfig(production);
    expect(config.auth).toMatchObject({
      baseUrl: 'https://api.sport.example.com',
      secureCookies: true,
      webOrigins: ['https://app.sport.example.com', 'https://staff.sport.example.com'],
      links: { webAppUrl: 'https://app.sport.example.com', appScheme: 'sportperformance' },
      database: { url: production.AUTH_DATABASE_URL, poolMax: 5 },
    });
    expect(config.email).toEqual({
      resendApiKey: RESEND_KEY_PLACEHOLDER,
      from: production.EMAIL_FROM,
    });
  });

  it('requires the proxy hops in production, so per-IP limits see the client IP', () => {
    expect(loadConfig(production).trustProxyHops).toBe(1);
    const rest: Record<string, string> = { ...production };
    delete rest.TRUST_PROXY_HOPS;
    const missing = configError(rest);
    expect(missing.variables).toEqual(['TRUST_PROXY_HOPS']);
    expect(missing.message).toContain('TRUST_PROXY_HOPS: required');
    expect(configError({ ...production, TRUST_PROXY_HOPS: '0' }).variables).toEqual([
      'TRUST_PROXY_HOPS',
    ]);
    // Outside production 0 (no proxy) stays the default.
    expect(loadConfig({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET }).trustProxyHops).toBe(0);
  });

  it('requires Resend and public https URLs in production, without local defaults', () => {
    const rest: Record<string, string> = { ...production };
    delete rest.RESEND_API_KEY;
    delete rest.EMAIL_FROM;
    delete rest.WEB_APP_URL;
    const error = configError({ ...rest, AUTH_BASE_URL: 'http://api.sport.example.com' });
    expect([...error.variables].sort()).toEqual(['AUTH_BASE_URL', 'RESEND_API_KEY', 'WEB_APP_URL']);
    expect(error.message).toContain('RESEND_API_KEY: required');
    expect(error.message).toContain('AUTH_BASE_URL: invalid');
    const noOrigins: Record<string, string> = { ...production };
    delete noOrigins.WEB_ORIGINS;
    expect(loadConfig(noOrigins).auth.webOrigins).toEqual([]);
  });

  it('requires a long AUTH_SECRET and EMAIL_FROM with RESEND_API_KEY, never printing them', () => {
    const error = configError({
      DATABASE_URL,
      AUTH_DATABASE_URL,
      AUTH_SECRET: 'short-secret',
      RESEND_API_KEY: 'secret-value-never-printed',
    });
    expect([...error.variables].sort()).toEqual(['AUTH_SECRET', 'EMAIL_FROM']);
    expect(error.message).not.toContain('short-secret');
    expect(error.message).not.toContain('secret-value-never-printed');
    expect([...configError({ DATABASE_URL }).variables].sort()).toEqual([
      'AUTH_DATABASE_URL',
      'AUTH_SECRET',
    ]);
  });

  it('validates origins and the deep link scheme', () => {
    expect(
      configError({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, WEB_ORIGINS: 'not an origin' })
        .variables,
    ).toEqual(['WEB_ORIGINS']);
    expect(
      configError({
        DATABASE_URL,
        AUTH_DATABASE_URL,
        AUTH_SECRET,
        APP_DEEP_LINK_SCHEME: 'Bad Scheme',
      }).variables,
    ).toEqual(['APP_DEEP_LINK_SCHEME']);
  });

  it('reads the versions policy of the mobile app by platform', () => {
    const config = loadConfig({
      DATABASE_URL,
      AUTH_DATABASE_URL,
      AUTH_SECRET,
      APP_MIN_VERSION_IOS: '1.2.0',
      APP_LATEST_VERSION_IOS: '1.4.1',
      APP_STORE_URL_IOS: 'https://apps.apple.com/app/id0000000000',
      APP_MIN_VERSION_ANDROID: '1.1.0',
      APP_LATEST_VERSION_ANDROID: '',
    });
    expect(config.mobileApp).toEqual({
      ios: {
        minVersion: '1.2.0',
        latestVersion: '1.4.1',
        storeUrl: 'https://apps.apple.com/app/id0000000000',
      },
      android: { minVersion: '1.1.0', latestVersion: null, storeUrl: null },
    });
    expect(configSummary(config).mobileApp).toEqual(config.mobileApp);
  });

  it('validates the versions policy of the mobile app', () => {
    const base = { DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET };
    expect(configError({ ...base, APP_MIN_VERSION_IOS: '1.2' }).variables).toEqual([
      'APP_MIN_VERSION_IOS',
    ]);
    expect(configError({ ...base, APP_LATEST_VERSION_ANDROID: 'v2.0.0' }).variables).toEqual([
      'APP_LATEST_VERSION_ANDROID',
    ]);
    expect(
      configError({ ...base, APP_STORE_URL_ANDROID: 'http://play.google.com/x' }).variables,
    ).toEqual(['APP_STORE_URL_ANDROID']);
    const older = configError({
      ...base,
      APP_MIN_VERSION_IOS: '2.0.0',
      APP_LATEST_VERSION_IOS: '1.9.9',
    });
    expect(older.variables).toEqual(['APP_LATEST_VERSION_IOS']);
    expect(older.message).toContain('must not be older than APP_MIN_VERSION_IOS');
  });
});

describe('Sentry configuration', () => {
  it('is disabled without SENTRY_DSN', () => {
    expect(loadSentryConfig({})).toBeNull();
    expect(loadConfig({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET }).sentry).toBeNull();
  });

  it('is enabled with a DSN, environment and release falling back to Railway', () => {
    const env = {
      DATABASE_URL,
      AUTH_DATABASE_URL,
      AUTH_SECRET,
      SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      RAILWAY_GIT_COMMIT_SHA: 'a1b2c3d',
    };
    const expected = {
      dsn: 'https://public@o1.ingest.sentry.io/1',
      environment: 'staging',
      release: 'a1b2c3d',
      tracesSampleRate: 0,
    };
    expect(loadSentryConfig(env)).toEqual(expected);
    expect(loadConfig(env).sentry).toEqual(expected);
    expect(
      loadSentryConfig({ ...env, SENTRY_ENVIRONMENT: 'production', NODE_ENV: 'production' }),
    ).toMatchObject({ environment: 'production' });
  });

  it('returns null on an invalid Sentry variable (loadConfig reports it)', () => {
    expect(loadSentryConfig({ SENTRY_DSN: 'not a url' })).toBeNull();
    expect(
      configError({ DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET, SENTRY_DSN: 'not a url' })
        .variables,
    ).toEqual(['SENTRY_DSN']);
  });
});

describe('files configuration', () => {
  const base = { DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET };

  it('reads the bucket and the life of the signed URLs', () => {
    const config = loadConfig({
      ...base,
      STORAGE_ENDPOINT: 'http://localhost:9000',
      STORAGE_BUCKET: 'files',
      STORAGE_ACCESS_KEY_ID: 'minioadmin',
      STORAGE_SECRET_ACCESS_KEY: 'minioadmin123',
      STORAGE_FORCE_PATH_STYLE: 'true',
      FILE_DOWNLOAD_URL_TTL_S: '60',
    });
    expect(config.files).toEqual({
      storage: {
        endpoint: 'http://localhost:9000',
        region: 'auto',
        bucket: 'files',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin123',
        forcePathStyle: true,
      },
      uploadUrlTtlS: 900,
      downloadUrlTtlS: 60,
      logoUrlTtlS: 3600,
    });
    expect(configSummary(config).files).toEqual({
      storage: { endpoint: 'http://localhost:9000', bucket: 'files' },
      uploadUrlTtlS: 900,
      downloadUrlTtlS: 60,
      logoUrlTtlS: 3600,
    });
  });

  it('asks for the whole bucket once one variable is set, without printing values', () => {
    const error = configError({
      ...base,
      STORAGE_SECRET_ACCESS_KEY: 'a-secret-that-must-not-leak',
    });
    expect([...error.variables].sort()).toEqual([
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_BUCKET',
      'STORAGE_ENDPOINT',
    ]);
    expect(error.message).not.toContain('a-secret-that-must-not-leak');
  });

  it('requires the bucket over https in production', () => {
    const production = {
      ...base,
      DATABASE_URL: strongDatabaseUrl('api'),
      AUTH_DATABASE_URL: strongDatabaseUrl('auth'),
      AUTH_SECRET: strongSecret(),
      NODE_ENV: 'production',
      RESEND_API_KEY: RESEND_KEY_PLACEHOLDER,
      EMAIL_FROM: 'Sport Performance <no-reply@sport.example.com>',
      AUTH_BASE_URL: 'https://api.sport.example.com',
      WEB_APP_URL: 'https://app.sport.example.com',
      TRUST_PROXY_HOPS: '1',
    };
    expect([...configError(production).variables].sort()).toEqual([
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_BUCKET',
      'STORAGE_ENDPOINT',
      'STORAGE_SECRET_ACCESS_KEY',
    ]);
    const insecure = configError({
      ...production,
      STORAGE_ENDPOINT: 'http://bucket.internal:9000',
      STORAGE_BUCKET: 'files',
      STORAGE_ACCESS_KEY_ID: 'tid_placeholder',
      STORAGE_SECRET_ACCESS_KEY: strongSecret(),
    });
    expect(insecure.variables).toEqual(['STORAGE_ENDPOINT']);
    expect(insecure.message).toContain('STORAGE_ENDPOINT: invalid (must be https in production)');
    expect(() => loadConfig({ ...base, FILE_UPLOAD_URL_TTL_S: '30' })).toThrow(ConfigError);
  });
});
