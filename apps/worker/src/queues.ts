import { isUuid, type ClubId } from '@sport-performance/domain';
import type { PgBoss, Queue } from 'pg-boss';
import type pg from 'pg';

/**
 * Queues of the worker (ADR 0011, ADR 0045). Every job carries the `club_id`
 * it works on; the fan-out jobs (sweep, daily) only list clubs and enqueue one
 * job per club.
 */
export const QUEUES = {
  /** Recalculate the derived values of one club (pending marks + daily extension). */
  refreshClub: 'derived-refresh-club',
  /** Jobs of `refreshClub` that failed every retry, kept for inspection and redrive. */
  refreshClubDead: 'derived-refresh-club-dead',
  /** Every minute: clubs with pending recalculations (in case a notification was lost). */
  sweep: 'derived-sweep',
  /** Every hour: every club, so each series reaches the club's new day after midnight. */
  daily: 'derived-daily',
  /** Purge the expired files of one club (retention, B-325, ADR 0044). */
  filesPurgeClub: 'files-purge-club',
  filesPurgeClubDead: 'files-purge-club-dead',
  /** Once a day: every club's file retention. */
  filesDaily: 'files-daily',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

/**
 * - `stately` keeps at most one queued and one active job per club
 *   (`singletonKey` = club id): a burst of writes collapses into one job, and
 *   one club is never recalculated by two jobs at once.
 * - Retries with exponential backoff; after the last one the job goes to the
 *   dead letter queue (and to Sentry through the `failed` log).
 * - Fan-out jobs do not retry: the next cron run does the same work.
 */
export const QUEUE_DEFINITIONS: readonly Queue[] = [
  { name: QUEUES.refreshClubDead, policy: 'standard', deleteAfterSeconds: 30 * DAY },
  {
    name: QUEUES.refreshClub,
    policy: 'stately',
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 30 * MINUTE,
    expireInSeconds: 15 * MINUTE,
    deleteAfterSeconds: 7 * DAY,
    deadLetter: QUEUES.refreshClubDead,
  },
  {
    name: QUEUES.sweep,
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 2 * MINUTE,
    deleteAfterSeconds: DAY,
  },
  {
    name: QUEUES.daily,
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 10 * MINUTE,
    deleteAfterSeconds: 7 * DAY,
  },
  { name: QUEUES.filesPurgeClubDead, policy: 'standard', deleteAfterSeconds: 30 * DAY },
  {
    name: QUEUES.filesPurgeClub,
    policy: 'stately',
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 60 * MINUTE,
    expireInSeconds: 5 * MINUTE,
    deleteAfterSeconds: 7 * DAY,
    deadLetter: QUEUES.filesPurgeClubDead,
  },
  {
    name: QUEUES.filesDaily,
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 10 * MINUTE,
    deleteAfterSeconds: 7 * DAY,
  },
];

/** Cron schedules (UTC; each club job computes "the day" in the club's own zone). */
export const SCHEDULES = [
  { queue: QUEUES.sweep, cron: '* * * * *' },
  { queue: QUEUES.daily, cron: '5 * * * *' },
] as const;

/** File retention: once a day, only when the bucket is configured. */
export const FILE_SCHEDULES = [{ queue: QUEUES.filesDaily, cron: '17 6 * * *' }] as const;

export interface RefreshClubJob {
  readonly clubId: ClubId;
}

/** Validates a per-club job payload: jobs come from the database, never trusted blindly. */
export function parseRefreshClubJob(data: unknown): RefreshClubJob {
  const clubId = (data as { clubId?: unknown } | null)?.clubId;
  if (!isUuid(clubId)) throw new Error('Per-club job without a valid clubId.');
  return { clubId: clubId as ClubId };
}

/**
 * Creates the queues (idempotent) and the cron schedules. Without a bucket
 * the file retention schedule is removed (nothing to purge against).
 */
export async function setUpQueues(
  boss: PgBoss,
  options: { readonly files: boolean },
): Promise<void> {
  const existing = new Set((await boss.getQueues()).map((q) => q.name));
  for (const { name, ...options } of QUEUE_DEFINITIONS) {
    if (existing.has(name)) {
      // The policy, the dead letter queue and the backoff cap are fixed at creation.
      const updatable = {
        ...(options.retryLimit !== undefined && { retryLimit: options.retryLimit }),
        ...(options.retryDelay !== undefined && { retryDelay: options.retryDelay }),
        ...(options.retryBackoff !== undefined && { retryBackoff: options.retryBackoff }),
        ...(options.expireInSeconds !== undefined && { expireInSeconds: options.expireInSeconds }),
        ...(options.deleteAfterSeconds !== undefined && {
          deleteAfterSeconds: options.deleteAfterSeconds,
        }),
      };
      await boss.updateQueue(name, updatable);
    } else {
      await boss.createQueue(name, options);
    }
  }
  for (const { queue, cron } of SCHEDULES) await boss.schedule(queue, cron, {}, { tz: 'UTC' });
  for (const { queue, cron } of FILE_SCHEDULES) {
    if (options.files) await boss.schedule(queue, cron, {}, { tz: 'UTC' });
    else await boss.unschedule(queue);
  }
}

/** Enqueues the refresh of a club; a no-op when one is already queued (`stately`). */
export async function enqueueClubRefresh(boss: PgBoss, clubId: ClubId): Promise<boolean> {
  return enqueueClubJob(boss, QUEUES.refreshClub, clubId);
}

/** Enqueues a per-club job (`{ clubId }`, one queued per club). */
export async function enqueueClubJob(
  boss: PgBoss,
  queue: QueueName,
  clubId: ClubId,
): Promise<boolean> {
  const id = await boss.send(queue, { clubId } satisfies RefreshClubJob, { singletonKey: clubId });
  return id !== null;
}

interface WorkerClubRow {
  readonly club_id: ClubId;
  readonly has_pending_refresh: boolean;
}

/**
 * The clubs a fan-out job enqueues: those with pending recalculations, or all
 * of them. Read through `app.worker_clubs()`, the only cross-club read of the
 * worker (ids and zones, nothing else).
 */
export async function listClubs(pool: pg.Pool, onlyPending: boolean): Promise<ClubId[]> {
  const { rows } = await pool.query<WorkerClubRow>(
    'select club_id, has_pending_refresh from app.worker_clubs()',
  );
  return rows.filter((r) => !onlyPending || r.has_pending_refresh).map((r) => r.club_id);
}
