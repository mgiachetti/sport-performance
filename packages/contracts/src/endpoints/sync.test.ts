import { SYNC_OPERATIONS } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { nonStrictObjectPaths } from '../strict-input.js';
import {
  SYNC_OPERATION_INPUTS,
  hlcSchema,
  pullSyncChanges,
  pushSyncMutations,
  syncChangeSchema,
} from './sync.js';

const ID = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
const HLC = '001793620800000-000003-0f1e2d3c4b5a6978';

describe('sync endpoints', () => {
  it('are club endpoints under /v1/sync', () => {
    for (const endpoint of [pushSyncMutations, pullSyncChanges]) {
      expect(endpoint.auth).toBe('club');
      expect(endpoint.tags).toEqual(['sync']);
      expect(endpoint.path.startsWith('/v1/sync/')).toBe(true);
    }
    expect(pushSyncMutations.method).toBe('POST');
    expect(pullSyncChanges.method).toBe('GET');
  });

  it('takes hybrid logical clocks in their fixed-width text form only', () => {
    expect(hlcSchema.safeParse(HLC).success).toBe(true);
    expect(hlcSchema.safeParse('001793620800000-000003-server').success).toBe(true);
    for (const bad of [
      '',
      '1793620800000-3-0f1e2d3c4b5a6978',
      `${HLC}x`,
      '001793620800000-000003-PHONE',
    ]) {
      expect(hlcSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('checks the envelope of a mutation and leaves its operation to the server', () => {
    const body = pushSyncMutations.body;
    expect(
      body.safeParse({ mutations: [{ mutationId: ID, hlc: HLC, op: 'not.yet', body: { x: 1 } }] })
        .success,
    ).toBe(true);
    expect(
      body.safeParse({ mutations: [{ mutationId: ID, hlc: HLC, op: 'x', extra: 1 }] }).success,
    ).toBe(false);
    expect(body.safeParse({ mutations: [] }).success).toBe(false);
  });

  it('has a strict input for every operation', () => {
    expect(Object.keys(SYNC_OPERATION_INPUTS).sort()).toEqual([...SYNC_OPERATIONS].sort());
    for (const [op, schema] of Object.entries(SYNC_OPERATION_INPUTS)) {
      expect(nonStrictObjectPaths(schema, op), op).toEqual([]);
    }
  });

  it('edits name their row and carry no version (the field clocks replace it)', () => {
    const update = SYNC_OPERATION_INPUTS['test_result.update'];
    expect(update.safeParse({ target: { id: ID }, body: { notes: 'Viento' } }).success).toBe(true);
    expect(update.safeParse({ target: { clientUuid: ID }, body: {} }).success).toBe(true);
    expect(
      update.safeParse({ target: { id: ID }, body: { version: '1', notes: 'Viento' } }).success,
    ).toBe(false);
    expect(update.safeParse({ target: { id: ID, clientUuid: ID }, body: {} }).success).toBe(false);
  });

  it('describes upserts with the read DTO and tombstones without data', () => {
    expect(
      syncChangeSchema.safeParse({
        collection: 'wellness',
        op: 'delete',
        id: ID,
        clientUuid: null,
        data: null,
      }).success,
    ).toBe(true);
    expect(
      syncChangeSchema.safeParse({
        collection: 'wellness',
        op: 'upsert',
        id: ID,
        clientUuid: ID,
        data: { id: ID },
      }).success,
    ).toBe(false);
  });

  it('takes a comma-separated list of known collections', () => {
    const query = pullSyncChanges.query;
    expect(query.safeParse({ collections: 'wellness,test_result' }).success).toBe(true);
    expect(query.safeParse({ collections: 'wellness,gym_sets' }).success).toBe(false);
    expect(query.parse({}).limit).toBe(200);
    expect(query.safeParse({ limit: '501' }).success).toBe(false);
  });
});
