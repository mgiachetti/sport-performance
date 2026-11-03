import type { ClubId } from '@sport-performance/domain';
import { inClubTransaction } from '../database.js';
import { ClubPreferences, readNotificationClub } from './club.js';
import {
  checkReceipts,
  deliverDue,
  purgeOldNotifications,
  type DeliveryDependencies,
} from './deliver.js';
import { planClubNotifications } from './plan.js';

export { ExpoPushService, MemoryPushService, type PushService } from './expo.js';
export {
  MAX_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_RETENTION_DAYS,
  type DeliveryDependencies,
} from './deliver.js';

export interface NotificationDependencies extends DeliveryDependencies {
  /** Current instant; injectable for tests. */
  readonly now?: () => Date;
}

export interface ClubNotificationReport {
  readonly clubId: ClubId;
  readonly created: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly retried: number;
  /** Due outside the recipient's allowed hours: moved to the next opening. */
  readonly deferred: number;
  readonly receipts: number;
  readonly purged: number;
  /** Due deliveries left for the next job of the club. */
  readonly more: boolean;
}

/** Delivery rounds per job; what is left goes to the next job of the club. */
const MAX_DELIVERY_ROUNDS = 5;

/**
 * The notifications job of one club (B-328, ADR 0054): plan what is due
 * (idempotent), purge past the retention, deliver in rounds and read the
 * push receipts. Provider failures retry per delivery; an invalid
 * `settings.notifications` fails the job loudly (retries, dead letter, Sentry).
 */
export async function runClubNotifications(
  deps: NotificationDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<ClubNotificationReport> {
  const now = deps.now?.() ?? new Date();
  const requestId = options.jobId === undefined ? undefined : `job:${options.jobId}`;
  const planned = await inClubTransaction(
    deps.pool,
    clubId,
    async (tx) => {
      const club = await readNotificationClub(tx, clubId, now);
      if (club === null) return null;
      const preferences = await ClubPreferences.read(tx);
      const { created } = await planClubNotifications(tx, club, preferences, now);
      const purged = await purgeOldNotifications(tx, now);
      return { club, created, purged };
    },
    { requestId },
  );
  const empty = {
    sent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    deferred: 0,
    receipts: 0,
    more: false,
  };
  if (planned === null) return { clubId, created: 0, purged: 0, ...empty };

  const totals = { sent: 0, skipped: 0, failed: 0, retried: 0, deferred: 0 };
  let more = false;
  for (let round = 0; round < MAX_DELIVERY_ROUNDS; round += 1) {
    const report = await deliverDue(deps, planned.club, now, requestId);
    totals.sent += report.sent;
    totals.skipped += report.skipped;
    totals.failed += report.failed;
    totals.retried += report.retried;
    totals.deferred += report.deferred;
    more = report.more;
    if (!more) break;
  }
  const receipts = await checkReceipts(deps, clubId, now, requestId);
  const result: ClubNotificationReport = {
    clubId,
    created: planned.created,
    purged: planned.purged,
    receipts,
    more,
    ...totals,
  };
  if (
    result.created +
      result.sent +
      result.skipped +
      result.failed +
      result.retried +
      result.deferred +
      receipts +
      result.purged >
    0
  ) {
    // Counts and ids only (ADR 0016).
    deps.logger.info({ ...result, jobId: options.jobId }, 'notifications processed');
  }
  return result;
}
