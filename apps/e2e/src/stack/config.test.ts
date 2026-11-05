import { describe, expect, it } from 'vitest';
import {
  REPO_DIR,
  StackConfigError,
  defaultRunDir,
  stackConfig,
  stackEndpoints,
  withDatabase,
  withLogin,
} from './config.ts';

const DB = 'postgres://postgres:postgres@localhost:5432/postgres';

describe('stack configuration', () => {
  it('takes an optional S3-compatible server with its credentials', () => {
    const url = 'http://minio:secret123@localhost:9000';
    expect(stackConfig({ DATABASE_URL: DB, E2E_STORAGE_URL: url }).storageServerUrl).toBe(url);
    expect(stackConfig({ DATABASE_URL: DB, STORAGE_TEST_URL: url }).storageServerUrl).toBe(url);
    expect(() =>
      stackConfig({ DATABASE_URL: DB, E2E_STORAGE_URL: 'http://localhost:9000' }),
    ).toThrow(StackConfigError);
    expect(() => stackConfig({ DATABASE_URL: DB, E2E_STORAGE_URL: 'not a url' })).toThrow(
      StackConfigError,
    );
  });

  it('defaults to loopback ports and the package run directory', () => {
    expect(stackEndpoints({})).toEqual({
      apiPort: 3100,
      webPort: 4174,
      apiUrl: 'http://127.0.0.1:3100',
      webUrl: 'http://127.0.0.1:4174',
      runDir: defaultRunDir(),
    });
    expect(stackConfig({ DATABASE_URL: DB })).toMatchObject({
      adminDatabaseUrl: DB,
      databaseName: 'sport_performance_e2e',
      storageServerUrl: null,
    });
  });

  it('takes its own variables first', () => {
    const config = stackConfig({
      DATABASE_URL: 'postgres://ignored@localhost/x',
      E2E_DATABASE_URL: DB,
      E2E_DATABASE_NAME: 'sp_e2e_local',
      E2E_API_PORT: '3200',
      E2E_WEB_PORT: '4200',
      E2E_RUN_DIR: 'tmp/e2e',
    });
    expect(config).toMatchObject({
      adminDatabaseUrl: DB,
      databaseName: 'sp_e2e_local',
      apiUrl: 'http://127.0.0.1:3200',
      webUrl: 'http://127.0.0.1:4200',
      runDir: `${REPO_DIR}/tmp/e2e`,
    });
  });

  it('refuses what would point somewhere unexpected', () => {
    expect(() => stackConfig({})).toThrow(StackConfigError);
    expect(() => stackConfig({ DATABASE_URL: DB, E2E_DATABASE_NAME: 'x; drop' })).toThrow(
      StackConfigError,
    );
    // Too long for its logins (`<name>_worker` must fit in 63 bytes).
    expect(() => stackConfig({ DATABASE_URL: DB, E2E_DATABASE_NAME: 'a'.repeat(57) })).toThrow(
      StackConfigError,
    );
    expect(stackConfig({ DATABASE_URL: DB, E2E_DATABASE_NAME: 'a'.repeat(56) }).databaseName).toBe(
      'a'.repeat(56),
    );
    expect(() => stackEndpoints({ E2E_API_PORT: '80' })).toThrow(StackConfigError);
    expect(() => stackEndpoints({ E2E_API_PORT: '4174' })).toThrow(StackConfigError);
  });

  it('swaps the database and the login of a connection string', () => {
    expect(withDatabase(DB, 'sport_performance_e2e')).toBe(
      'postgres://postgres:postgres@localhost:5432/sport_performance_e2e',
    );
    expect(withLogin(DB, 'sp_e2e_api', 'a/b+c')).toBe(
      'postgres://sp_e2e_api:a%2Fb%2Bc@localhost:5432/postgres',
    );
  });
});
