import type { LocalDate } from '@sport-performance/domain';
import type { SyncEngine } from '../offline/engine.ts';
import type { LocalStore } from '../offline/local-store.ts';
import {
  EXTERNAL_LOAD_OPS,
  archiveRequest,
  correctionRequest,
  externalLoadItems,
  reportRequest,
  reportableDays,
  type ExternalLoadDraft,
  type ExternalLoadItem,
} from './model.ts';

/**
 * External load through the local database and the offline queue (B-511,
 * ADR 0069, ADR 0084): every write is a mutation of the queue, every read
 * is the local rows with what is still queued on top. Works the same with
 * and without signal.
 */

/** The activities of the reportable week that ends `today`. */
export async function readExternalLoadWeek(
  store: Pick<LocalStore, 'list' | 'pending'>,
  membershipId: string,
  today: LocalDate,
): Promise<ExternalLoadItem[]> {
  const days = reportableDays(today);
  const from = days[days.length - 1] ?? today;
  const synced = await store.list(membershipId, 'external_load', { from, to: today });
  const queue = await store.pending(membershipId, EXTERNAL_LOAD_OPS);
  return externalLoadItems({ synced, queue, from, to: today });
}

type Queue = Pick<SyncEngine, 'enqueue'>;

export async function queueExternalLoadReport(
  sync: Queue,
  draft: ExternalLoadDraft,
  randomUUID: () => string,
): Promise<void> {
  await sync.enqueue('external_load.report', reportRequest(draft, randomUUID()));
}

/** Queues the correction; `unchanged` when the draft is the item as it is. */
export async function queueExternalLoadCorrection(
  sync: Queue,
  item: ExternalLoadItem,
  draft: ExternalLoadDraft,
  reason: string,
): Promise<'saved' | 'unchanged'> {
  const request = correctionRequest(item, draft, reason);
  if (request === null) return 'unchanged';
  await sync.enqueue('external_load.correct', request);
  return 'saved';
}

export async function queueExternalLoadArchive(sync: Queue, item: ExternalLoadItem): Promise<void> {
  await sync.enqueue('external_load.archive', archiveRequest(item));
}
