import { describe, expect, it } from 'vitest';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import { openLocalDatabase } from './db/database.ts';
import { syncScope } from './db/schema.ts';
import { createReadCache, type ReadSchema } from './read-cache.ts';

const A = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const B = { membershipId: 'a2222222-2222-4222-8222-222222222222', userId: 'u1' };

const numberBox: ReadSchema<{ n: number }> = {
  safeParse: (value) =>
    typeof value === 'object' && value !== null && typeof (value as { n?: unknown }).n === 'number'
      ? { success: true, data: value as { n: number } }
      : { success: false },
};

async function setup() {
  const database = await openLocalDatabase(nodeSqliteDriver());
  let time = 1_000;
  let scope: typeof A | null = A;
  const cache = createReadCache(database, { now: () => time, currentScope: () => scope });
  return {
    database,
    cache,
    setScope: (next: typeof A | null) => {
      scope = next;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('cached reads', () => {
  it('replace the document whole, per membership, with when it was read', async () => {
    const { cache, advance, setScope } = await setup();
    await cache.put(A, 'k', { n: 1 });
    advance(500);
    await cache.put(A, 'k', { n: 2 });
    setScope(B);
    await cache.put(B, 'k', { n: 3 });
    expect(await cache.get(A.membershipId, 'k', numberBox)).toEqual({
      data: { n: 2 },
      fetchedAt: 1_500,
    });
    expect((await cache.get(B.membershipId, 'k', numberBox))?.data).toEqual({ n: 3 });
    await cache.remove(A.membershipId, 'k');
    expect(await cache.get(A.membershipId, 'k', numberBox)).toBeNull();
  });

  it('are a miss when they no longer match their contract', async () => {
    const { cache } = await setup();
    await cache.put(A, 'old', { n: 'one' });
    expect(await cache.get(A.membershipId, 'old', numberBox)).toBeNull();
  });

  it('list by prefix, where `_` is not a wildcard', async () => {
    const { cache } = await setup();
    await cache.put(A, 'test_day:1', { n: 1 });
    await cache.put(A, 'testXday:2', { n: 2 });
    await cache.put(A, 'test_day:bad', { n: 'x' });
    expect([...(await cache.list(A.membershipId, 'test_day:', numberBox)).keys()]).toEqual([
      'test_day:1',
    ]);
  });

  it('go with their membership', async () => {
    const { cache, database } = await setup();
    await cache.put(A, 'k', { n: 1 });
    await database.write((db) => db.delete(syncScope));
    expect(await cache.get(A.membershipId, 'k', numberBox)).toBeNull();
  });

  it('write nothing once the device no longer syncs their scope', async () => {
    const { cache, database, setScope } = await setup();
    // A download still running when the user signs out (or changes club).
    setScope(null);
    await cache.put(A, 'k', { n: 1 });
    setScope(B);
    await cache.put(A, 'k', { n: 2 });
    expect(await cache.get(A.membershipId, 'k', numberBox)).toBeNull();
    expect(await database.read((db) => db.select().from(syncScope))).toEqual([]);
  });
});
