import { describe, expect, it } from 'vitest';
import { describeRelease, releasePlanFromEnv, ReleaseConfigError } from './release.js';

const OWNER = 'postgresql://postgres:owner-secret@postgres.railway.internal:5432/railway';
const login = (user: string, password = `${user}-password-0123456789`) =>
  `postgresql://${user}:${password}@postgres.railway.internal:5432/railway`;

describe('releasePlanFromEnv', () => {
  it('provisions the login of every role whose URL is set', () => {
    const plan = releasePlanFromEnv({
      MIGRATIONS_DATABASE_URL: OWNER,
      DATABASE_URL: login('sp_api'),
      AUTH_DATABASE_URL: login('sp_auth'),
      WORKER_DATABASE_URL: login('sp_worker'),
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });
    expect(plan.ownerConnectionString).toBe(OWNER);
    expect(plan.logins.map(({ role, login }) => [role, login])).toEqual([
      ['app', 'sp_api'],
      ['auth', 'sp_auth'],
      ['worker', 'sp_worker'],
    ]);
    expect(plan.logins[0]?.password).toBe('sp_api-password-0123456789');
    expect(plan.deploymentEnvironment).toBe('production');
  });

  it('decodes percent-encoded logins and passwords and skips unset roles', () => {
    const plan = releasePlanFromEnv({
      MIGRATIONS_DATABASE_URL: OWNER,
      DATABASE_URL: login('sp_api', 'p%40ss%2Fword-0123456789'),
      AUTH_DATABASE_URL: '  ',
    });
    expect(plan.logins).toEqual([
      { role: 'app', variable: 'DATABASE_URL', login: 'sp_api', password: 'p@ss/word-0123456789' },
    ]);
    expect(plan.deploymentEnvironment).toBeNull();
  });

  it('requires the owner URL and never falls back to the API login', () => {
    expect(() => releasePlanFromEnv({ DATABASE_URL: login('sp_api') })).toThrow(
      /MIGRATIONS_DATABASE_URL/,
    );
    expect(() => releasePlanFromEnv({ MIGRATIONS_DATABASE_URL: ' ' })).toThrow(ReleaseConfigError);
    expect(() => releasePlanFromEnv({ MIGRATIONS_DATABASE_URL: 'mysql://x@h/db' })).toThrow(
      /postgres/,
    );
  });

  it('refuses logins on another server or database', () => {
    expect(() =>
      releasePlanFromEnv({
        MIGRATIONS_DATABASE_URL: OWNER,
        DATABASE_URL: 'postgresql://sp_api:password-0123456789@other.internal:5432/railway',
      }),
    ).toThrow(/server/);
    expect(() =>
      releasePlanFromEnv({
        MIGRATIONS_DATABASE_URL: OWNER,
        DATABASE_URL:
          'postgresql://sp_api:password-0123456789@postgres.railway.internal:6543/railway',
      }),
    ).toThrow(/server/);
    expect(() =>
      releasePlanFromEnv({
        MIGRATIONS_DATABASE_URL: OWNER,
        WORKER_DATABASE_URL:
          'postgresql://sp_worker:password-0123456789@postgres.railway.internal:5432/other',
      }),
    ).toThrow(/database/);
  });

  it('refuses a URL without password, the owner login, or a login shared by two roles', () => {
    expect(() =>
      releasePlanFromEnv({
        MIGRATIONS_DATABASE_URL: OWNER,
        DATABASE_URL: 'postgresql://sp_api@postgres.railway.internal:5432/railway',
      }),
    ).toThrow(/password/);
    expect(() =>
      releasePlanFromEnv({ MIGRATIONS_DATABASE_URL: OWNER, AUTH_DATABASE_URL: login('postgres') }),
    ).toThrow(/owner/);
    expect(() =>
      releasePlanFromEnv({
        MIGRATIONS_DATABASE_URL: OWNER,
        DATABASE_URL: login('sp_api'),
        AUTH_DATABASE_URL: login('sp_api'),
      }),
    ).toThrow(/same login/);
  });

  it('lowercases the environment and refuses names that are not identifiers', () => {
    expect(
      releasePlanFromEnv({ MIGRATIONS_DATABASE_URL: OWNER, RAILWAY_ENVIRONMENT_NAME: 'Staging' })
        .deploymentEnvironment,
    ).toBe('staging');
    expect(() =>
      releasePlanFromEnv({ MIGRATIONS_DATABASE_URL: OWNER, RAILWAY_ENVIRONMENT_NAME: "x'; drop" }),
    ).toThrow(ReleaseConfigError);
  });

  it('never puts a password or a URL in its errors', () => {
    const attempts = [
      { MIGRATIONS_DATABASE_URL: OWNER, DATABASE_URL: 'postgresql://sp_api:hunter2@other/railway' },
      { MIGRATIONS_DATABASE_URL: 'not a url owner-secret' },
      { MIGRATIONS_DATABASE_URL: OWNER, DATABASE_URL: login('postgres', 'hunter2') },
    ];
    for (const env of attempts) {
      try {
        releasePlanFromEnv(env);
        expect.unreachable();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('hunter2');
        expect(message).not.toContain('owner-secret');
        expect(message).not.toContain('://');
      }
    }
  });
});

describe('describeRelease', () => {
  it('reports each step without secrets', () => {
    const text = describeRelease({
      migrations: { applied: 2, total: 45, unknown: 0, jobQueueVersion: 27 },
      logins: [{ login: 'sp_api', group: 'sport_performance_app' }],
      deploymentEnvironment: 'staging',
    });
    expect(text).toBe(
      'Migrations: 2 applied, 45 in the database; job queue at version 27.\n' +
        'Login sp_api provisioned as sport_performance_app.\n' +
        'Database declared as "staging".\n',
    );
  });
});
