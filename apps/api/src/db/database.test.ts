import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { DatabaseTimeoutError, databaseFromPool } from './database.js';

function poolWith(query: () => Promise<unknown>): pg.Pool {
  return { query } as unknown as pg.Pool;
}

describe('Database.ping', () => {
  it('resolves when the database answers', async () => {
    await expect(
      databaseFromPool(poolWith(() => Promise.resolve({}))).ping(50),
    ).resolves.toBeUndefined();
  });

  it('fails after the timeout when the database hangs', async () => {
    const hanging = databaseFromPool(poolWith(() => new Promise(() => undefined)));
    await expect(hanging.ping(20)).rejects.toBeInstanceOf(DatabaseTimeoutError);
  });

  it('propagates connection errors', async () => {
    const down = databaseFromPool(poolWith(() => Promise.reject(new Error('ECONNREFUSED'))));
    await expect(down.ping(50)).rejects.toThrow('ECONNREFUSED');
  });
});
