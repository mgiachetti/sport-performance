import { isUuid, type ClubId } from '@sport-performance/domain';
import type { PgBoss, Queue } from 'pg-boss';
import type pg from 'pg';

/**
 * Queues of the worker (ADR 0011, ADR 0046). Every job carries the `club_id`
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
  /** Write the pending CSV exports of one club (B-608, ADR 0072). */
  dataExportClub: 'data-export-club',
  dataExportClubDead: 'data-export-club-dead',
  /** Every minute: clubs with a pending export (in case a notification was lost). */
  dataExportSweep: 'data-export-sweep',
  /** Plan and deliver the notifications of one club (B-328, ADR 0054). */
  notificationsClub: 'notifications-club',
  notificationsClubDead: 'notifications-club-dead',
  /** Every minute: every club's notifications (due times are minutes apart). */
  notificationsSweep: 'notifications-sweep',
  /** Render the pending PDF reports of one club, of players and categories (B-602, B-603). */
  playerReportsClub: 'player-reports-club',
  playerReportsClubDead: 'player-reports-club-dead',
  /** Every minute: the clubs with due reports (a lost notification, a retry's backoff). */
  playerReportsSweep: 'player-reports-sweep',
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
  { name: QUEUES.dataExportClubDead, policy: 'standard', deleteAfterSeconds: 30 * DAY },
  {
    // An export of years of a big club takes minutes; expiring before the stale window of
    // the export (30 min) means pg-boss gives up on a stuck job before another run takes
    // the export over.
    name: QUEUES.dataExportClub,
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 30 * MINUTE,
    expireInSeconds: 25 * MINUTE,
    deleteAfterSeconds: 7 * DAY,
    deadLetter: QUEUES.dataExportClubDead,
  },
  {
    name: QUEUES.dataExportSweep,
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 2 * MINUTE,
    deleteAfterSeconds: DAY,
  },
  { name: QUEUES.notificationsClubDead, policy: 'standard', deleteAfterSeconds: 30 * DAY },
  {
    // A retry soon: a lost minute delays a nudge, and each delivery has its own attempts.
    name: QUEUES.notificationsClub,
    policy: 'stately',
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 15 * MINUTE,
    expireInSeconds: 5 * MINUTE,
    deleteAfterSeconds: DAY,
    deadLetter: QUEUES.notificationsClubDead,
  },
  {
    name: QUEUES.notificationsSweep,
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 2 * MINUTE,
    deleteAfterSeconds: DAY,
  },
  { name: QUEUES.playerReportsClubDead, policy: 'standard', deleteAfterSeconds: 30 * DAY },
  {
    // Each report has its own attempts and backoff; a job retry only covers a crash.
    name: QUEUES.playerReportsClub,
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 15 * MINUTE,
    expireInSeconds: 10 * MINUTE,
    deleteAfterSeconds: DAY,
    deadLetter: QUEUES.playerReportsClubDead,
  },
  {
    name: QUEUES.playerReportsSweep,
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 2 * MINUTE,
    deleteAfterSeconds: DAY,
  },
];

/** Cron schedules (UTC; each club job computes "the day" in the club's own zone). */
export const SCHEDULES = [
  { queue: QUEUES.sweep, cron: '* * * * *' },
  { queue: QUEUES.daily, cron: '5 * * * *' },
] as const;

/** Notifications: every minute, when the worker sends them (B-328). */
export const NOTIFICATION_SCHEDULES = [
  { queue: QUEUES.notificationsSweep, cron: '* * * * *' },
] as const;

/**
/**
 * Bucket jobs, only when the bucket is configured: file retention once a day, and the
 * sweeps of the player reports and of the pending CSV exports every minute.
 */
export const FILE_SCHEDULES = [
  { queue: QUEUES.filesDaily, cron: '17 6 * * *' },
  { queue: QUEUES.playerReportsSweep, cron: '* * * * *' },
  { queue: QUEUES.dataExportSweep, cron: '* * * * *' },
] as const;

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
 * the file retention schedule is removed (nothing to purge against); without
 * notification services, the notifications schedule.
 */
export async function setUpQueues(
  boss: PgBoss,
  options: { readonly files: boolean; readonly notifications: boolean },
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
  for (const { queue, cron } of NOTIFICATION_SCHEDULES) {
    if (options.notifications) await boss.schedule(queue, cron, {}, { tz: 'UTC' });
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

/** The clubs with a pending report that is due (`app.worker_report_clubs()`, B-602, B-603). */
export async function listReportClubs(pool: pg.Pool): Promise<ClubId[]> {
  const { rows } = await pool.query<{ club_id: ClubId }>(
    'select club_id from app.worker_report_clubs()',
  );
  return rows.map((r) => r.club_id);
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
