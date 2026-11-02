import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadSentryConfig } from './env.js';

const DATABASE_URL = 'postgres://api:pa55word@localhost:5432/sport_performance';
const AUTH_DATABASE_URL = 'postgres://auth:pa55word@localhost:5432/sport_performance';
const AUTH_SECRET = 'a-test-secret-of-at-least-32-characters!!';
/** Obviously fake: never anything shaped like a real Resend key. */
const RESEND_KEY_PLACEHOLDER = 'placeholder-resend-key';

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
      log: { level: 'info' },
      database: {
        url: DATABASE_URL,
        poolMax: 10,
        connectTimeoutMs: 5000,
        statementTimeoutMs: 15_000,
      },
      health: { databaseTimeoutMs: 2000 },
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
    });
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
    DATABASE_URL,
    AUTH_SECRET,
    NODE_ENV: 'production',
    RESEND_API_KEY: RESEND_KEY_PLACEHOLDER,
    EMAIL_FROM: 'Sport Performance <no-reply@sport.example.com>',
    AUTH_BASE_URL: 'https://api.sport.example.com/',
    WEB_APP_URL: 'https://app.sport.example.com/',
    WEB_ORIGINS: 'https://app.sport.example.com, https://staff.sport.example.com/',
    AUTH_DATABASE_URL: 'postgres://auth:pw@localhost:5432/sport_performance',
    TRUST_PROXY_HOPS: '1',
  };

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
