import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { releaseDatabase, releasePlanFromEnv } from './release.js';
import { DATABASE_ROLES } from './roles.js';
import { DATABASE_ENVIRONMENT_SETTING } from './seeds/demo/guard.js';
import { createEmptyDatabase, hasDatabase, type TestDatabase } from './testing/database.js';
import { FULL_MIGRATION_TIMEOUT_MS } from './testing/temporary-database.js';

/**
 * The deploy step (B-701, ADR 0090) on a real Postgres 16: from an empty
 * database to migrated, with the three logins and the declared environment;
 * and again, as every later deploy does.
 */
describe.skipIf(!hasDatabase)('releaseDatabase (Postgres 16)', () => {
  let t: TestDatabase;
  const suffix = randomBytes(4).toString('hex');
  const logins = {
    app: `sp_rel_api_${suffix}`,
    auth: `sp_rel_auth_${suffix}`,
    worker: `sp_rel_worker_${suffix}`,
  };
  const password = () => randomBytes(24).toString('hex');

  function urlFor(user: string, secret: string): string {
    const url = new URL(t.connectionString);
    url.username = user;
    url.password = secret;
    return url.toString();
  }

  async function connectsAs(connectionString: string): Promise<{ user: string; groups: string[] }> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ user: string; groups: string[] }>(
        `select current_user as user,
                array(select g.rolname::text from pg_auth_members m
                        join pg_roles g on g.oid = m.roleid
                       where m.member = (select oid from pg_roles where rolname = current_user)
                       order by 1) as groups`,
      );
      const row = rows[0];
      if (row === undefined) throw new Error('no row');
      return row;
    } finally {
      await client.end();
    }
  }

  async function declared(): Promise<string | null> {
    const client = new pg.Client({ connectionString: t.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ value: string | null }>(
        'select current_setting($1, true) as value',
        [DATABASE_ENVIRONMENT_SETTING],
      );
      return rows[0]?.value ?? null;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    t = await createEmptyDatabase();
  });

  afterAll(async () => {
    await t.drop();
    // Roles are cluster-wide: drop the ones this file created.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      for (const login of Object.values(logins)) {
        await client.query(`drop role if exists ${client.escapeIdentifier(login)}`);
      }
    } finally {
      await client.end();
    }
  });

  it(
    'migrates an empty database, provisions each login in its role and declares the environment',
    async () => {
      const secrets = { app: password(), auth: password(), worker: password() };
      const env = {
        MIGRATIONS_DATABASE_URL: t.connectionString,
        DATABASE_URL: urlFor(logins.app, secrets.app),
        AUTH_DATABASE_URL: urlFor(logins.auth, secrets.auth),
        WORKER_DATABASE_URL: urlFor(logins.worker, secrets.worker),
        RAILWAY_ENVIRONMENT_NAME: 'staging',
      };
      const report = await releaseDatabase(releasePlanFromEnv(env));
      expect(report.migrations.applied).toBeGreaterThan(0);
      expect(report.migrations.applied).toBe(report.migrations.total);
      expect(report.logins).toEqual([
        { login: logins.app, group: DATABASE_ROLES.app },
        { login: logins.auth, group: DATABASE_ROLES.auth },
        { login: logins.worker, group: DATABASE_ROLES.worker },
      ]);
      expect(await connectsAs(env.DATABASE_URL)).toEqual({
        user: logins.app,
        groups: [DATABASE_ROLES.app],
      });
      expect(await connectsAs(env.AUTH_DATABASE_URL)).toEqual({
        user: logins.auth,
        groups: [DATABASE_ROLES.auth],
      });
      expect(await connectsAs(env.WORKER_DATABASE_URL)).toEqual({
        user: logins.worker,
        groups: [DATABASE_ROLES.worker],
      });
      expect(await declared()).toBe('staging');
    },
    FULL_MIGRATION_TIMEOUT_MS,
  );

  it('is idempotent and rotates a password on the next deploy', async () => {
    const rotated = password();
    const env = {
      MIGRATIONS_DATABASE_URL: t.connectionString,
      DATABASE_URL: urlFor(logins.app, rotated),
      RAILWAY_ENVIRONMENT_NAME: 'production',
    };
    const report = await releaseDatabase(releasePlanFromEnv(env));
    expect(report.migrations.applied).toBe(0);
    expect((await connectsAs(env.DATABASE_URL)).user).toBe(logins.app);
    expect(await declared()).toBe('production');
  });
});
