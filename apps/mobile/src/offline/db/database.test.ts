import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeSqliteDriver, temporaryDatabaseFile } from '../../test/node-sqlite.ts';
import { LocalDatabaseVersionError, openLocalDatabase } from './database.ts';
import { LOCAL_MIGRATIONS } from './migrations.ts';
import { deviceMeta, localSchema, mutation, syncScope, syncedRow } from './schema.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function strings(
  driver: ReturnType<typeof nodeSqliteDriver>,
  sql: string,
): Promise<string[][]> {
  const { rows } = await driver.query(sql, []);
  return rows.map((row) => row.map((value) => String(value)));
}

describe('local database migrations', () => {
  it('create exactly the tables, columns and indexes of the Drizzle schema', async () => {
    const driver = nodeSqliteDriver();
    await openLocalDatabase(driver);
    const tables = await strings(
      driver,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const schemaTables = Object.values(localSchema).map((table) => getTableConfig(table));
    expect(tables.map(([name]) => name)).toEqual(schemaTables.map((t) => t.name).sort());

    for (const config of schemaTables) {
      const columns = await strings(driver, `PRAGMA table_info(${config.name})`);
      // cid, name, type, notnull, default, pk
      expect(
        columns.map(([, name, type, notNull]) => ({ name, type, notNull: notNull === '1' })),
        config.name,
      ).toEqual(
        config.columns.map((column) => ({
          name: column.name,
          type: column.getSQLType().toUpperCase(),
          notNull: column.notNull,
        })),
      );
      const indexes = await strings(
        driver,
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${config.name}' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      expect(
        indexes.map(([name]) => name),
        config.name,
      ).toEqual(config.indexes.map((index) => index.config.name).sort());
      const foreignKeys = await strings(driver, `PRAGMA foreign_key_list(${config.name})`);
      expect(foreignKeys.map((fk) => `${fk[2] ?? ''}.${fk[4] ?? ''}:${fk[6] ?? ''}`)).toEqual(
        config.foreignKeys.map((fk) => {
          const reference = fk.reference();
          return `${getTableConfig(reference.foreignTable).name}.${reference.foreignColumns[0]?.name ?? ''}:${fk.onDelete?.toUpperCase() ?? 'NO ACTION'}`;
        }),
      );
    }
    expect(await strings(driver, 'PRAGMA user_version')).toEqual([
      [String(LOCAL_MIGRATIONS.length)],
    ]);
  });

  it('keeps the data and does not migrate again when reopened', async () => {
    const file = temporaryDatabaseFile();
    cleanups.push(file.remove);
    const first = await openLocalDatabase(nodeSqliteDriver(file.path));
    await first.write((db) => db.insert(deviceMeta).values({ key: 'k', value: 'v' }));
    await first.close();

    const driver = nodeSqliteDriver(file.path);
    const second = await openLocalDatabase(driver);
    expect(driver.statements.some((sql) => sql.includes('CREATE TABLE'))).toBe(false);
    expect(await second.read((db) => db.select().from(deviceMeta))).toEqual([
      { key: 'k', value: 'v' },
    ]);
    await second.close();
  });

  it('refuses a file of a newer build', async () => {
    const driver = nodeSqliteDriver();
    await driver.exec(`PRAGMA user_version = ${String(LOCAL_MIGRATIONS.length + 1)}`);
    await expect(openLocalDatabase(driver)).rejects.toBeInstanceOf(LocalDatabaseVersionError);
  });
});

describe('local database access', () => {
  it('rolls back the whole write when the task fails', async () => {
    const db = await openLocalDatabase(nodeSqliteDriver());
    await expect(
      db.write(async (tx) => {
        await tx.insert(deviceMeta).values({ key: 'a', value: '1' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.read((tx) => tx.select().from(deviceMeta))).toEqual([]);
  });

  it('never interleaves two transactions on the one connection', async () => {
    const db = await openLocalDatabase(nodeSqliteDriver());
    const order: string[] = [];
    await Promise.all([
      db.write(async (tx) => {
        order.push('a:start');
        await tx.insert(deviceMeta).values({ key: 'a', value: '1' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('a:end');
      }),
      db.write(async (tx) => {
        order.push('b:start');
        await tx.insert(deviceMeta).values({ key: 'b', value: '1' });
        order.push('b:end');
      }),
    ]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('deletes the rows of a scope with it', async () => {
    const db = await openLocalDatabase(nodeSqliteDriver());
    await db.write(async (tx) => {
      await tx.insert(syncScope).values({ membershipId: 'm', userId: 'u', createdAt: 1 });
      await tx.insert(syncedRow).values({
        membershipId: 'm',
        collection: 'wellness',
        id: 'r',
        data: '{}',
        pulledAt: 1,
      });
      await tx.insert(mutation).values({
        membershipId: 'm',
        mutationId: 'x',
        op: 'wellness.submit',
        hlc: 'h',
        input: '{}',
        targets: '[]',
        state: 'pending',
        attempts: 0,
        createdAt: 1,
      });
    });
    await db.write((tx) => tx.delete(syncScope).where(eq(syncScope.membershipId, 'm')));
    expect(await db.read((tx) => tx.select().from(syncedRow))).toEqual([]);
    expect(await db.read((tx) => tx.select().from(mutation))).toEqual([]);
  });

  it('refuses a row of a scope that does not exist', async () => {
    const db = await openLocalDatabase(nodeSqliteDriver());
    await expect(
      db.write((tx) =>
        tx.insert(syncedRow).values({
          membershipId: 'nope',
          collection: 'wellness',
          id: 'r',
          data: '{}',
          pulledAt: 1,
        }),
      ),
    ).rejects.toThrow();
  });
});
