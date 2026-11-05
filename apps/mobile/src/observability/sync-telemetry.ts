import type { SyncTelemetry } from '../offline/engine.ts';

/**
 * An operational notice of the app (B-703, ADR 0095): one Sentry issue per
 * `fingerprint`, tags with codes and buckets only, never a value typed by
 * anyone, an id of a person or health data (ADR 0016).
 */
export interface AppNotice {
  readonly message: string;
  readonly level: 'warning' | 'error';
  readonly fingerprint: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

/** Coarse buckets: enough to see a trend, too coarse to single out a device. */
export function pendingBucket(count: number): string {
  if (count <= 1) return '1';
  if (count <= 10) return '2-10';
  if (count <= 100) return '11-100';
  return '>100';
}

export function ageBucket(ageS: number): string {
  const hours = ageS / 3600;
  if (hours < 6) return '1-6h';
  if (hours < 24) return '6-24h';
  if (hours < 72) return '1-3d';
  return '>3d';
}

/** The notice of a sync telemetry event. */
export function syncTelemetryNotice(event: SyncTelemetry): AppNotice {
  if (event.kind === 'mutation_rejected') {
    return {
      message: `Sync mutation rejected: ${event.op} ${event.errorCode}`,
      level: 'warning',
      // One issue per operation and code: a release that breaks one operation stands out.
      fingerprint: ['sync-mutation-rejected', event.op, event.errorCode],
      tags: { sync_op: event.op, sync_error: event.errorCode },
    };
  }
  return {
    message: 'Sync queue stalled on a failing server',
    level: 'error',
    fingerprint: ['sync-queue-stalled'],
    tags: {
      sync_pending: pendingBucket(event.pendingCount),
      sync_oldest: ageBucket(event.oldestPendingAgeS),
    },
  };
}
