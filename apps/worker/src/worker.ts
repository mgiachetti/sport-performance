import { JOB_QUEUE_SCHEMA } from '@sport-performance/db';
import type { ClubId } from '@sport-performance/domain';
import type { ObjectStorage } from '@sport-performance/storage';
import { PgBoss, type Job } from 'pg-boss';
import type pg from 'pg';
import type { Logger } from 'pino';
import { refreshClub, type RefreshDependencies } from './derived/refresh.js';
import { listExportClubs, runClubExports } from './exports/process.js';
import { purgeClubFiles } from './files.js';
import { runClubNotifications, type DeliveryDependencies } from './notifications/index.js';
import { createOpsMonitor } from './ops/monitor.js';
import { runClubReports } from './reports/job.js';
import { startRefreshListener, type RefreshListener } from './listener.js';
import { foldClubUsage } from './usage.js';
import type { ErrorReporter } from './observability.js';
import {
  QUEUES,
  enqueueClubJob,
  enqueueClubRefresh,
  listClubs,
  listReportClubs,
  parseRefreshClubJob,
  setUpQueues,
} from './queues.js';

export interface StartWorkerOptions {
  /** Pool of a `sport_performance_worker` login for the recalculations. */
  readonly pool: pg.Pool;
  /** Same login, for pg-boss's own pool and the listener. Never logged. */
  readonly connectionString: string;
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  /** Clubs recalculated at the same time by this process. */
  readonly clubConcurrency: number;
  readonly jobQueuePoolMax?: number;
  /** How often idle workers poll for jobs (seconds); tests use a short one. */
  readonly pollingIntervalSeconds?: number;
  /** Run the cron schedules (sweep and daily). Default `true`. */
  readonly schedule?: boolean;
  /** The bucket of uploaded files; `null` turns the file retention job off. */
  readonly storage: ObjectStorage | null;
  /**
   * Push (Expo), email and the web's URL for the notifications (B-328);
   * `null` turns the notification jobs off (tests of other jobs).
   */
  readonly notifications: Omit<DeliveryDependencies, 'pool' | 'logger'> | null;
  /**
   * The operational monitor (B-703, ADR 0095): a failing check is announced
   * again every `renotifyMinutes`. `null` turns it off (`OPS_MONITOR=off`, tests
   * of other jobs). Default: on, every 60 minutes.
   */
  readonly opsMonitor?: { readonly renotifyMinutes: number } | null;
  /** Current instant for "today"; injectable for tests. */
  readonly now?: () => Date;
}

export interface RunningWorker {
  readonly boss: PgBoss;
  /** Stops taking jobs, waits up to `timeoutMs` for the ones in progress and closes pg-boss. */
  readonly stop: (timeoutMs: number) => Promise<void>;
}

/**
 * Starts pg-boss (without migrating it: `runMigrations` does that as the
 * owner, ADR 0046), creates the queues and schedules, starts the handlers and
 * the notification listener. Throws if the queue schema is not at the
 * version this pg-boss expects.
 */
export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const { logger, reporter } = options;
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: JOB_QUEUE_SCHEMA,
    application_name: 'sport-performance-worker-queue',
    max: options.jobQueuePoolMax ?? 4,
    // The login has no DDL: installing and upgrading the schema is the migration runner's job.
    migrate: false,
    createSchema: false,
    // REINDEX needs ownership of the tables; the owner can run it as maintenance.
    reindex: false,
    supervise: true,
    schedule: options.schedule ?? true,
    instanceName: 'worker',
    persistWarnings: false,
  });
  boss.on('error', (error) => {
    logger.error({ err: error }, 'job queue error');
    reporter.capture(error, { source: 'pg-boss' });
  });
  boss.on('warning', (warning) => {
    const type = (warning.data as { type?: unknown } | undefined)?.type;
    logger.warn({ warning: warning.message, type }, 'job queue warning');
  });
  await boss.start();
  const opsMonitorOptions =
    options.opsMonitor === undefined ? { renotifyMinutes: 60 } : options.opsMonitor;
  await setUpQueues(boss, {
    files: options.storage !== null,
    notifications: options.notifications !== null,
    opsMonitor: opsMonitorOptions !== null,
  });
  if (options.storage === null) {
    logger.warn('no bucket configured (STORAGE_*): the file retention and report jobs are off');
  }

  const deps: RefreshDependencies = {
    pool: options.pool,
    logger,
    ...(options.now && { now: options.now }),
  };
  const pollingIntervalSeconds = options.pollingIntervalSeconds ?? 2;

  await boss.work(
    QUEUES.refreshClub,
    { localConcurrency: options.clubConcurrency, pollingIntervalSeconds },
    async ([job]: Job<unknown>[]) => {
      if (job === undefined) return;
      const { clubId } = parseRefreshClubJob(job.data);
      try {
        const report = await refreshClub(deps, clubId, { jobId: job.id });
        // More pending than one job processes: queue the next one for the club.
        if (report.remaining) await enqueueClubRefresh(boss, clubId);
      } catch (error) {
        logger.error(
          { err: error, clubId, jobId: job.id, retry: job.retryCount },
          'refresh failed',
        );
        reporter.capture(error, { job: QUEUES.refreshClub, jobId: job.id, clubId });
        throw error;
      }
    },
  );

  const fanOut = (onlyPending: boolean) => async (jobs: Job<unknown>[]) => {
    const clubs = await listClubs(options.pool, onlyPending);
    let enqueued = 0;
    for (const clubId of clubs) if (await enqueueClubRefresh(boss, clubId)) enqueued += 1;
    if (enqueued > 0 || !onlyPending) {
      logger.debug({ jobId: jobs[0]?.id, clubs: clubs.length, enqueued }, 'clubs enqueued');
    }
  };
  await boss.work(QUEUES.sweep, { pollingIntervalSeconds }, fanOut(true));
  await boss.work(QUEUES.daily, { pollingIntervalSeconds }, fanOut(false));

  // Usage metrics retention (B-707, ADR 0093): per-member rows become weekly counts.
  await boss.work(
    QUEUES.usageFoldClub,
    { localConcurrency: options.clubConcurrency, pollingIntervalSeconds },
    async ([job]: Job<unknown>[]) => {
      if (job === undefined) return;
      const { clubId } = parseRefreshClubJob(job.data);
      try {
        await foldClubUsage({ pool: options.pool, logger }, clubId, { jobId: job.id });
      } catch (error) {
        logger.error({ err: error, clubId, jobId: job.id }, 'usage fold failed');
        reporter.capture(error, { job: QUEUES.usageFoldClub, jobId: job.id, clubId });
        throw error;
      }
    },
  );
  await boss.work(QUEUES.usageDaily, { pollingIntervalSeconds }, async () => {
    for (const clubId of await listClubs(options.pool, false)) {
      await enqueueClubJob(boss, QUEUES.usageFoldClub, clubId);
    }
  });

  const storage = options.storage;
  if (storage !== null) {
    await boss.work(
      QUEUES.filesPurgeClub,
      { localConcurrency: options.clubConcurrency, pollingIntervalSeconds },
      async ([job]: Job<unknown>[]) => {
        if (job === undefined) return;
        const { clubId } = parseRefreshClubJob(job.data);
        try {
          const report = await purgeClubFiles(
            { pool: options.pool, storage, logger, ...(options.now && { now: options.now }) },
            clubId,
            { jobId: job.id },
          );
          if (report.more) await enqueueClubJob(boss, QUEUES.filesPurgeClub, clubId);
        } catch (error) {
          logger.error({ err: error, clubId, jobId: job.id }, 'file purge failed');
          reporter.capture(error, { job: QUEUES.filesPurgeClub, jobId: job.id, clubId });
          throw error;
        }
      },
    );
    await boss.work(QUEUES.filesDaily, { pollingIntervalSeconds }, async () => {
      for (const clubId of await listClubs(options.pool, false)) {
        await enqueueClubJob(boss, QUEUES.filesPurgeClub, clubId);
      }
    });

    // PDF reports of players (B-602, ADR 0071): rendered and uploaded to the bucket.
    await boss.work(
      QUEUES.playerReportsClub,
      { localConcurrency: options.clubConcurrency, pollingIntervalSeconds },
      async ([job]: Job<unknown>[]) => {
        if (job === undefined) return;
        const { clubId } = parseRefreshClubJob(job.data);
        try {
          const report = await runClubReports(
            { pool: options.pool, storage, logger, ...(options.now && { now: options.now }) },
            clubId,
            { jobId: job.id },
          );
          if (report.more) await enqueueClubJob(boss, QUEUES.playerReportsClub, clubId);
        } catch (error) {
          logger.error({ err: error, clubId, jobId: job.id }, 'player reports failed');
          reporter.capture(error, { job: QUEUES.playerReportsClub, jobId: job.id, clubId });
          throw error;
        }
      },
    );
    await boss.work(QUEUES.playerReportsSweep, { pollingIntervalSeconds }, async () => {
      for (const clubId of await listReportClubs(options.pool)) {
        await enqueueClubJob(boss, QUEUES.playerReportsClub, clubId);
      }
    });

    // CSV exports of the club's data (B-608, ADR 0072): they end in the bucket.
    const exportDeps = {
      pool: options.pool,
      storage,
      logger,
      ...(options.now && { now: options.now }),
    };
    await boss.work(
      QUEUES.dataExportClub,
      { localConcurrency: options.clubConcurrency, pollingIntervalSeconds },
      async ([job]: Job<unknown>[]) => {
        if (job === undefined) return;
        const { clubId } = parseRefreshClubJob(job.data);
        try {
          const report = await runClubExports(exportDeps, clubId, { jobId: job.id });
          if (report.more) await enqueueClubJob(boss, QUEUES.dataExportClub, clubId);
        } catch (error) {
          logger.error({ err: error, clubId, jobId: job.id }, 'club data export failed');
          reporter.capture(error, { job: QUEUES.dataExportClub, jobId: job.id, clubId });
          throw error;
        }
      },
    );
    await boss.work(QUEUES.dataExportSweep, { pollingIntervalSeconds }, async () => {
      for (const clubId of await listExportClubs(options.pool)) {
        await enqueueClubJob(boss, QUEUES.dataExportClub, clubId);
      }
    });
  }

  const notifications = options.notifications;
  if (notifications !== null) {
    const deps = {
      ...notifications,
      pool: options.pool,
      logger,
      ...(options.now && { now: options.now }),
    };
    await boss.work(
      QUEUES.notificationsClub,
      { localConcurrency: options.clubConcurrency, pollingIntervalSeconds },
      async ([job]: Job<unknown>[]) => {
        if (job === undefined) return;
        const { clubId } = parseRefreshClubJob(job.data);
        try {
          const report = await runClubNotifications(deps, clubId, { jobId: job.id });
          if (report.more) await enqueueClubJob(boss, QUEUES.notificationsClub, clubId);
        } catch (error) {
          logger.error({ err: error, clubId, jobId: job.id }, 'notifications failed');
          reporter.capture(error, { job: QUEUES.notificationsClub, jobId: job.id, clubId });
          throw error;
        }
      },
    );
    await boss.work(QUEUES.notificationsSweep, { pollingIntervalSeconds }, async () => {
      for (const clubId of await listClubs(options.pool, false)) {
        await enqueueClubJob(boss, QUEUES.notificationsClub, clubId);
      }
    });
  }

  if (opsMonitorOptions !== null) {
    const monitor = createOpsMonitor({
      pool: options.pool,
      logger,
      reporter,
      renotifyMinutes: opsMonitorOptions.renotifyMinutes,
      ...(options.now && { now: options.now }),
    });
    await boss.work(QUEUES.opsMonitor, { pollingIntervalSeconds }, async (jobs: Job<unknown>[]) => {
      try {
        await monitor.run();
      } catch (error) {
        logger.error({ err: error, jobId: jobs[0]?.id }, 'ops monitor failed');
        reporter.capture(error, { job: QUEUES.opsMonitor, jobId: jobs[0]?.id });
        throw error;
      }
    });
  } else {
    logger.warn('OPS_MONITOR=off: no operational checks; /health/ops reports the worker as down');
  }

  const listener: RefreshListener = startRefreshListener({
    connectionString: options.connectionString,
    logger,
    onClub: async (clubId: ClubId) => {
      await enqueueClubRefresh(boss, clubId);
    },
    ...(storage !== null && {
      onReportClub: async (clubId: ClubId) => {
        await enqueueClubJob(boss, QUEUES.playerReportsClub, clubId);
      },
      // A new export request wakes its club's job up; the sweep covers lost notifications.
      onExportClub: async (clubId: ClubId) => {
        await enqueueClubJob(boss, QUEUES.dataExportClub, clubId);
      },
    }),
  });
  await listener.ready;
  // Catch up at start: marks written while the worker was down.
  for (const clubId of await listClubs(options.pool, true)) await enqueueClubRefresh(boss, clubId);
  if (storage !== null) {
    for (const clubId of await listReportClubs(options.pool)) {
      await enqueueClubJob(boss, QUEUES.playerReportsClub, clubId);
    }
    for (const clubId of await listExportClubs(options.pool)) {
      await enqueueClubJob(boss, QUEUES.dataExportClub, clubId);
    }
  }

  return {
    boss,
    stop: async (timeoutMs) => {
      await listener.stop();
      await boss.stop({ graceful: true, timeout: timeoutMs });
    },
  };
}
