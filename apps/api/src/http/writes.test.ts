import { describe, expect, it } from 'vitest';
import { batchBodySha256, batchRowClientUuid } from './writes.js';

describe('batchRowClientUuid', () => {
  const batch = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';

  it('is a stable UUIDv8 per batch, kind and index', () => {
    const uuid = batchRowClientUuid(batch, 'test_result', 0);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(batchRowClientUuid(batch, 'test_result', 0)).toBe(uuid);
    expect(batchRowClientUuid(batch, 'test_result', 1)).not.toBe(uuid);
    expect(batchRowClientUuid(batch, 'test_result_entry:0', 0)).not.toBe(uuid);
    expect(batchRowClientUuid(batch.toUpperCase(), 'test_result', 0)).toBe(uuid);
  });
});

describe('batchBodySha256', () => {
  it('ignores the order of the keys and undefined values', () => {
    const a = batchBodySha256({ source: 'x', rows: [{ a: 1, b: [2, 3] }], skip: undefined });
    const b = batchBodySha256({ rows: [{ b: [2, 3], a: 1 }], source: 'x' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it('tells apart batches that differ in any value or in the order of the rows', () => {
    const base = batchBodySha256({ rows: [{ value: 40 }, { value: 41 }] });
    expect(batchBodySha256({ rows: [{ value: 40 }, { value: 42 }] })).not.toBe(base);
    expect(batchBodySha256({ rows: [{ value: 41 }, { value: 40 }] })).not.toBe(base);
    expect(batchBodySha256({ rows: [{ value: '40' }, { value: 41 }] })).not.toBe(base);
  });
});
