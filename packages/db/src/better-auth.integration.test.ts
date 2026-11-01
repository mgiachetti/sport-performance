import { randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getAuthTables } from 'better-auth/db';
import { eq } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, authSchema, session, user } from './schema/index.js';
import {
  createMigratedDatabase,
  hasDatabase,
  type MigratedTestDatabase,
  must,
} from './testing/database.js';

/**
 * The identity tables must work with Better Auth unchanged (B-309, ADR 0010).
 * Better Auth is only a dev dependency here: the API mounts it.
 */

const SQL_TYPE_BY_FIELD_TYPE: Record<string, string> = {
  string: 'text',
  boolean: 'boolean',
  date: 'timestamp with time zone',
  number: 'integer',
};

describe('Better Auth core schema', () => {
  const tables = getAuthTables({});

  it.each(Object.entries(tables))('%s matches our table field by field', (model, definition) => {
    const table = (authSchema as Record<string, PgTable>)[definition.modelName];
    expect(table, model).toBeDefined();
    const config = getTableConfig(must(table));
    expect(config.name).toBe(definition.modelName);
    const columns = table as unknown as Record<string, { notNull: boolean; isUnique: boolean }>;

    expect(columns.id).toBeDefined();
    for (const [field, attributes] of Object.entries(definition.fields)) {
      const column = config.columns.find((c) => c === (columns[field] as unknown));
      expect(column, `${model}.${field}`).toBeDefined();
      expect(must(column).getSQLType(), `${model}.${field}`).toBe(
        SQL_TYPE_BY_FIELD_TYPE[String(attributes.type)],
      );
      expect(must(column).notNull, `${model}.${field} required`).toBe(attributes.required === true);
      if (attributes.unique === true)
        expect(must(column).isUnique, `${model}.${field} unique`).toBe(true);
      if (attributes.references !== undefined) {
        const fk = config.foreignKeys.find((f) => f.reference().columns.some((c) => c === column));
        expect(getTableConfig(must(fk).reference().foreignTable).name).toBe(
          attributes.references.model,
        );
        expect(must(fk).onDelete).toBe(attributes.references.onDelete ?? 'cascade');
      }
    }
  });
});

describe.skipIf(!hasDatabase)('Better Auth over the migrated database (Postgres 16)', () => {
  let t: MigratedTestDatabase;

  beforeAll(async () => {
    t = await createMigratedDatabase();
  });

  afterAll(async () => {
    await t.close();
  });

  it('signs a user up through the Drizzle adapter', async () => {
    const auth = betterAuth({
      // Random per run: nothing is persisted beyond this throwaway database.
      secret: randomBytes(32).toString('hex'),
      baseURL: 'http://localhost:3000',
      database: drizzleAdapter(t.db, { provider: 'pg', schema: authSchema }),
      advanced: { database: { generateId: 'uuid' } },
      emailAndPassword: { enabled: true },
      user: {
        additionalFields: { isSuperadmin: { type: 'boolean', input: false, defaultValue: false } },
      },
      logger: { disabled: true },
    });

    const result = await auth.api.signUpEmail({
      body: { email: 'jugador@example.com', password: 'una-clave-larga-123', name: 'Jugador' },
    });
    expect(result.user.email).toBe('jugador@example.com');

    const [stored] = await t.db.select().from(user).where(eq(user.email, 'jugador@example.com'));
    expect(stored?.isSuperadmin).toBe(false);
    expect(stored?.emailVerified).toBe(false);
    expect(stored?.id).toMatch(/^[0-9a-f-]{36}$/);

    const accounts = await t.db
      .select()
      .from(account)
      .where(eq(account.userId, must(stored).id));
    expect(accounts.map((a) => a.providerId)).toEqual(['credential']);
    const sessions = await t.db
      .select()
      .from(session)
      .where(eq(session.userId, must(stored).id));
    expect(sessions).toHaveLength(1);

    // A user cannot grant themselves superadmin (`input: false` drops the field).
    const attacker = await auth.api
      .signUpEmail({
        body: {
          email: 'atacante@example.com',
          password: 'una-clave-larga-123',
          name: 'Atacante',
          isSuperadmin: true,
        } as never,
      })
      .then(
        (r) => r.user.id,
        () => null,
      );
    if (attacker !== null) {
      const [row] = await t.db.select().from(user).where(eq(user.id, attacker));
      expect(row?.isSuperadmin).toBe(false);
    }
  });
});
