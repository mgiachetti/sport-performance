import { describe, expect, it } from 'vitest';
import { ageBucket, pendingBucket, syncTelemetryNotice } from './sync-telemetry.ts';

describe('sync telemetry notices (B-703)', () => {
  it('a rejected mutation is one issue per operation and error code', () => {
    expect(
      syncTelemetryNotice({ kind: 'mutation_rejected', op: 'rpe.submit', errorCode: 'conflict' }),
    ).toEqual({
      message: 'Sync mutation rejected: rpe.submit conflict',
      level: 'warning',
      fingerprint: ['sync-mutation-rejected', 'rpe.submit', 'conflict'],
      tags: { sync_op: 'rpe.submit', sync_error: 'conflict' },
    });
  });

  it('a stalled queue carries buckets, not exact counts', () => {
    expect(
      syncTelemetryNotice({
        kind: 'queue_stalled',
        pendingCount: 37,
        oldestPendingAgeS: 30 * 3600,
        failures: 9,
      }),
    ).toEqual({
      message: 'Sync queue stalled on a failing server',
      level: 'error',
      fingerprint: ['sync-queue-stalled'],
      tags: { sync_pending: '11-100', sync_oldest: '1-3d' },
    });
  });

  it.each([
    [1, '1'],
    [2, '2-10'],
    [10, '2-10'],
    [100, '11-100'],
    [101, '>100'],
  ])('%d pending is %s', (count, bucket) => {
    expect(pendingBucket(count)).toBe(bucket);
  });

  it.each([
    [3600, '1-6h'],
    [6 * 3600, '6-24h'],
    [24 * 3600, '1-3d'],
    [72 * 3600, '>3d'],
  ])('%d s old is %s', (ageS, bucket) => {
    expect(ageBucket(ageS)).toBe(bucket);
  });
});
