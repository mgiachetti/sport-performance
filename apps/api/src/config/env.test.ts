import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadSentryConfig } from './env.js';

const DATABASE_URL = 'postgres://api:pa55word@localhost:5432/sport_performance';

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
  it('applies defaults with only DATABASE_URL', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
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
    });
  });

  it('coerces numbers and treats empty strings as unset', () => {
    const config = loadConfig({
      DATABASE_URL,
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
    expect(loadConfig({ DATABASE_URL, RAILWAY_GIT_COMMIT_SHA: 'a1b2c3d' }).version).toBe('a1b2c3d');
    expect(
      loadConfig({ DATABASE_URL, APP_VERSION: '1.2.3', RAILWAY_GIT_COMMIT_SHA: 'a1b2c3d' }).version,
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
    const error = configError({ DATABASE_URL: 'mysql://api:pa55word@db:3306/x' });
    expect(error.variables).toEqual(['DATABASE_URL']);
    expect(error.message).not.toContain('pa55word');
    expect(error.message).not.toContain('mysql');
  });

  it('rejects out-of-range values', () => {
    expect(configError({ DATABASE_URL, DATABASE_POOL_MAX: '0' }).variables).toEqual([
      'DATABASE_POOL_MAX',
    ]);
    expect(configError({ DATABASE_URL, SENTRY_TRACES_SAMPLE_RATE: '2' }).variables).toEqual([
      'SENTRY_TRACES_SAMPLE_RATE',
    ]);
  });
});

describe('Sentry configuration', () => {
  it('is disabled without SENTRY_DSN', () => {
    expect(loadSentryConfig({})).toBeNull();
    expect(loadConfig({ DATABASE_URL }).sentry).toBeNull();
  });

  it('is enabled with a DSN, environment and release falling back to Railway', () => {
    const env = {
      DATABASE_URL,
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
    expect(configError({ DATABASE_URL, SENTRY_DSN: 'not a url' }).variables).toEqual([
      'SENTRY_DSN',
    ]);
  });
});
