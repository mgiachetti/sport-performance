import { randomUUID } from 'node:crypto';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index.js';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  type MigratedTestDatabase,
  type RoleConnection,
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture } from './testing/tenant-fixture.js';

/**
 * Isolation between clubs for every table with `club_id` (ADR 0006, ADR
 * 0026), through real logins of the connection roles. The list of tables
 * comes from the schema and is checked against the migrated database's
 * catalog, and the fixture must have a row in each: a new table without
 * policies or without fixture data fails here.
 */

const CLUB_TABLES = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value as object, PgTable))
  .map((table) => getTableConfig(table))
  // The `medical` schema has its own access model and tests (medical.integration.test.ts).
  .filter((config) => config.schema === undefined)
  .filter((config) => config.columns.some((column) => column.name === 'club_id'))
  .map((config) => config.name)
  .sort();

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

describe.skipIf(!hasDatabase)('RLS isolation between clubs (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  /** Insertable (non-generated) columns per table. */
  const columns = new Map<string, string[]>();

  const adminOf = (club: ClubFixture): TestContext => ({
    clubId: club.clubId,
    userId: club.users.admin,
    role: 'admin',
  });

  /** A JSON copy of an existing row (read as the owner) moved to `clubId`, with fresh ids. */
  async function copyOf(table: string, rowId: string, clubId: string): Promise<string> {
    const { rows } = await t.pool.query<{ row: Record<string, unknown> }>(
      `select row_to_json(x) as row from "${table}" x where id = $1`,
      [rowId],
    );
    const row = must(rows[0], `${table} row`).row;
    return JSON.stringify({ ...row, id: randomUUID(), client_uuid: randomUUID(), club_id: clubId });
  }

  function insertCopy(client: pg.ClientBase, table: string, json: string) {
    const list = must(columns.get(table))
      .map((c) => `"${c}"`)
      .join(', ');
    return client.query(
      `insert into "${table}" (${list}) select ${list} from json_populate_record(null::"${table}", $1::json)`,
      [json],
    );
  }

  async function count(client: pg.ClientBase | pg.Pool, sql: string, params: unknown[] = []) {
    const { rows } = await client.query<{ n: number }>(`select count(*)::int as n ${sql}`, params);
    return must(rows[0]).n;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'club-a');
    b = await seedClubFixture(t.db, 'club-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    const { rows } = await t.pool.query<{ table: string; column: string }>(
      `select c.relname as table, a.attname as column
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where n.nspname = 'public' and c.relkind = 'r' and a.attgenerated = ''
        order by a.attnum`,
    );
    for (const row of rows) columns.set(row.table, [...(columns.get(row.table) ?? []), row.column]);
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  it('covers every table with club_id of the migrated database', async () => {
    const { rows } = await t.pool.query<{ table: string }>(
      `select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and exists (select 1 from pg_attribute a
                       where a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped)
        order by 1`,
    );
    expect(rows.map((r) => r.table)).toEqual(CLUB_TABLES);
    expect(Object.keys(a.rows).sort()).toEqual(CLUB_TABLES);
    expect(CLUB_TABLES.length).toBeGreaterThan(25);
  });

  describe.each(CLUB_TABLES)('%s', (table) => {
    it('an admin of club A sees the row of A and nothing of club B', async () => {
      for (const [own, foreign] of [
        [a, b],
        [b, a],
      ] as const) {
        await inContext(app.pool, adminOf(own), async (client) => {
          expect(
            await count(client, `from "${table}" where id = $1`, [must(own.rows[table])]),
          ).toBe(1);
          expect(await count(client, `from "${table}" where club_id <> $1`, [own.clubId])).toBe(0);
          expect(
            await count(client, `from "${table}" where id = $1`, [must(foreign.rows[table])]),
          ).toBe(0);
        });
      }
    });

    it('an admin of club A cannot update, delete or insert rows of club B', async () => {
      const foreignRow = must(b.rows[table]);
      await inContext(app.pool, adminOf(a), async (client) => {
        const updated = await client.query(
          `update "${table}" set updated_at = now() where id = $1`,
          [foreignRow],
        );
        expect(updated.rowCount).toBe(0);
      });
      const deleted = await pgCode(
        inContext(app.pool, adminOf(a), async (client) => {
          const result = await client.query(`delete from "${table}" where id = $1`, [foreignRow]);
          if (result.rowCount !== 0) throw new Error(`deleted ${String(result.rowCount)} rows`);
        }),
      );
      // No DELETE grant (42501), or the policy hides the row (no error, 0 rows).
      expect(['42501', 'no error']).toContain(deleted);

      // A copy of an A row moved to club B: the restrictive policy rejects it.
      const json = await copyOf(table, must(a.rows[table]), b.clubId);
      expect(
        await pgCode(inContext(app.pool, adminOf(a), (client) => insertCopy(client, table, json))),
      ).toBe('42501');
      expect(await count(t.pool, `from "${table}" where id = $1`, [foreignRow])).toBe(1);
    });

    it('cannot move a row to another club', async () => {
      const code = await pgCode(
        inContext(app.pool, adminOf(a), (client) =>
          client.query(`update "${table}" set club_id = $1 where id = $2`, [
            b.clubId,
            must(a.rows[table]),
          ]),
        ),
      );
      expect(code).toBe('42501');
    });

    it('denies everything without a tenant context (fail closed)', async () => {
      for (const context of [{}, { userId: a.users.admin }, { role: 'admin' }] as TestContext[]) {
        await inContext(app.pool, context, async (client) => {
          // Own memberships are visible to a user without a club (club selector).
          const sql =
            table === 'membership' && context.userId !== undefined
              ? `from "${table}" where user_id <> $1`
              : `from "${table}" where $1::text is not null`;
          expect(await count(client, sql, [context.userId ?? 'x'])).toBe(0);
        });
      }
      const json = await copyOf(table, must(a.rows[table]), a.clubId);
      expect(
        await pgCode(inContext(app.pool, {}, (client) => insertCopy(client, table, json))),
      ).toBe('42501');
      await inContext(worker.pool, {}, async (client) => {
        expect(await count(client, `from "${table}"`)).toBe(0);
      });
      expect(
        await pgCode(inContext(worker.pool, {}, (client) => insertCopy(client, table, json))),
      ).toBe('42501');
    });

    it('the worker sees and writes only the club of its job', async () => {
      await inContext(worker.pool, { clubId: a.clubId }, async (client) => {
        expect(await count(client, `from "${table}" where id = $1`, [must(a.rows[table])])).toBe(1);
        expect(await count(client, `from "${table}" where club_id <> $1`, [a.clubId])).toBe(0);
      });
      const json = await copyOf(table, must(a.rows[table]), b.clubId);
      expect(
        await pgCode(
          inContext(worker.pool, { clubId: a.clubId }, (client) => insertCopy(client, table, json)),
        ),
      ).toBe('42501');
    });
  });

  describe('global tables', () => {
    it('club: the context club only, never another one', async () => {
      await inContext(app.pool, adminOf(a), async (client) => {
        const { rows } = await client.query<{ id: string }>('select id from club');
        expect(rows.map((r) => r.id)).toEqual([a.clubId]);
        const updated = await client.query(`update club set name = 'x' where id = $1`, [b.clubId]);
        expect(updated.rowCount).toBe(0);
      });
      await inContext(app.pool, {}, async (client) => {
        expect(await count(client, 'from club')).toBe(0);
      });
      await inContext(worker.pool, { clubId: b.clubId }, async (client) => {
        const { rows } = await client.query<{ id: string }>('select id from club');
        expect(rows.map((r) => r.id)).toEqual([b.clubId]);
      });
    });

    it('user: staff see the members of their club, nobody sees another club', async () => {
      await inContext(app.pool, adminOf(a), async (client) => {
        const { rows } = await client.query<{ id: string }>('select id from "user"');
        expect(rows.map((r) => r.id).sort()).toEqual(Object.values(a.users).sort());
      });
      await inContext(worker.pool, { clubId: b.clubId }, async (client) => {
        const { rows } = await client.query<{ id: string }>('select id from "user"');
        expect(rows.map((r) => r.id).sort()).toEqual(Object.values(b.users).sort());
      });
      await inContext(app.pool, {}, async (client) => {
        expect(await count(client, 'from "user"')).toBe(0);
      });
    });

    it.each(['session', 'account', 'verification'])(
      '%s is not readable by the API or the worker',
      async (table) => {
        for (const connection of [app, worker]) {
          expect(
            await pgCode(
              inContext(connection.pool, adminOf(a), (client) =>
                client.query(`select 1 from "${table}"`),
              ),
            ),
          ).toBe('42501');
        }
      },
    );
  });

  describe('pooled connections', () => {
    it('never carry the context of a previous transaction', async () => {
      const single = await connectAs(t, 'app', { max: 1 });
      try {
        const pid = (client: pg.ClientBase | pg.Pool) =>
          client
            .query<{ pid: number }>('select pg_backend_pid() as pid')
            .then((r) => r.rows[0]?.pid);
        const first = await inContext(single.pool, adminOf(a), async (client) => {
          expect(await count(client, 'from player')).toBe(2);
          return pid(client);
        });
        // Same physical connection, outside any transaction context.
        expect(await pid(single.pool)).toBe(first);
        expect(await count(single.pool, 'from player')).toBe(0);
        const { rows } = await single.pool.query<{ club: string | null }>(
          `select current_setting('app.club_id', true) as club`,
        );
        expect(rows[0]?.club ?? '').toBe('');

        // Nor after a rolled-back transaction.
        await expect(
          inContext(single.pool, adminOf(b), async (client) => {
            expect(await count(client, 'from player')).toBe(2);
            throw new Error('boom');
          }),
        ).rejects.toThrow('boom');
        await inContext(single.pool, {}, async (client) => {
          expect(await pid(client)).toBe(first);
          expect(await count(client, 'from player')).toBe(0);
        });

        // A transaction of club B on the same connection sees B only.
        await inContext(single.pool, adminOf(b), async (client) => {
          expect(await count(client, 'from player where club_id = $1', [a.clubId])).toBe(0);
          expect(await count(client, 'from player where club_id = $1', [b.clubId])).toBe(2);
        });
      } finally {
        await single.close();
      }
    });
  });
});
