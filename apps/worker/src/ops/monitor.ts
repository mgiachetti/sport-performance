import { JOB_QUEUE_SCHEMA } from '@sport-performance/db';
import {
  OPS_CHECKS,
  OPS_FAILED_DELIVERIES_WINDOW_S,
  OPS_FAILED_JOBS_WINDOW_S,
  evaluateOpsCheck,
  isOpsCheckStatus,
  trackSyncHorizon,
  type OpsCheckCode,
  type OpsCheckStatus,
  type SyncHorizonState,
} from '@sport-performance/domain';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { ErrorReporter } from '../observability.js';
import { DEAD_LETTER_QUEUES, OPS_MONITOR_SCHEDULE, QUEUE_DEFINITIONS } from '../queues.js';

/**
 * The operational monitor (B-703, ADR 0095): every minute it measures the
 * checks of the platform the worker can see, records them in `ops.check_state`
 * (through `app.worker_record_ops_checks`, the only writer) and announces the
 * failing ones to Sentry, one issue per check. It also checks in with Sentry
 * Crons, so a worker that stops running is an alert without the worker.
 *
 * Only counts, ages and queue names leave this module: never a club, a
 * player or a job's payload.
 */

/** Sentry Crons monitor of this job (one per environment, by Sentry's `environment`). */
export const OPS_MONITOR_SLUG = 'worker-ops-monitor';

export interface OpsMonitorDependencies {
  /** A `sport_performance_worker` login (it reads `pgboss` and calls the `app.worker_*` functions). */
  readonly pool: pg.Pool;
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  /** A failing check is announced again after this many minutes while it stays failing. */
  readonly renotifyMinutes: number;
  readonly now?: () => Date;
}

/** A measured check, before it is recorded. */
export interface MeasuredCheck {
  readonly code: OpsCheckCode;
  readonly status: OpsCheckStatus;
  readonly value: number | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface RecordedCheck {
  readonly code: OpsCheckCode;
  readonly status: OpsCheckStatus;
  readonly previousStatus: OpsCheckStatus | null;
  readonly statusSince: Date;
  readonly notify: boolean;
}

/** The values the worker measures, by check (`null`: could not be measured). */
export interface OpsMeasurements {
  readonly job_dead_letter_n: number | null;
  readonly job_failed_recent_n: number | null;
  readonly job_backlog_s: number | null;
  readonly derived_refresh_lag_s: number | null;
  readonly reports_failed_n: number | null;
  readonly exports_failed_n: number | null;
  readonly notifications_failed_n: number | null;
  readonly sync_horizon_stalled_s: number | null;
  /** Breakdown per queue of the job checks (names of our queues and counts only). */
  readonly details: Partial<Record<OpsCheckCode, Record<string, number>>>;
}

interface QueueStatsRow {
  readonly name: string;
  readonly failed_recent: string;
  readonly queued: string;
  readonly ready_oldest_s: number | null;
}

/** Our queues only: a queue some tool left in the schema says nothing about us. */
const KNOWN_QUEUES = new Set(QUEUE_DEFINITIONS.map((q) => q.name));
const DEAD = new Set(DEAD_LETTER_QUEUES);

/**
 * Counts of the job queue: jobs that failed for good since `failedSince`,
 * jobs waiting in a dead letter queue, and the age of the oldest job ready to
 * run (queued or waiting for a retry whose time came) outside the dead letter
 * queues, which nobody works.
 */
export async function measureJobQueue(
  pool: pg.Pool,
  failedSince: Date,
): Promise<
  Pick<OpsMeasurements, 'job_dead_letter_n' | 'job_failed_recent_n' | 'job_backlog_s'> & {
    readonly details: Partial<Record<OpsCheckCode, Record<string, number>>>;
  }
> {
  const { rows } = await pool.query<QueueStatsRow>(
    `select j.name,
            count(*) filter (where j.state = 'failed' and j.completed_on >= $1) as failed_recent,
            count(*) filter (where j.state in ('created', 'retry')) as queued,
            extract(epoch from now() - min(j.start_after)
              filter (where j.state in ('created', 'retry') and j.start_after <= now()))::double precision
              as ready_oldest_s
       from "${JOB_QUEUE_SCHEMA}".job j
      where j.state in ('created', 'retry', 'failed')
      group by j.name`,
    [failedSince],
  );
  const dead: Record<string, number> = {};
  const failed: Record<string, number> = {};
  const backlog: Record<string, number> = {};
  let deadTotal = 0;
  let failedTotal = 0;
  let oldest = 0;
  for (const row of rows) {
    if (!KNOWN_QUEUES.has(row.name)) continue;
    if (DEAD.has(row.name)) {
      const queued = Number(row.queued);
      if (queued > 0) dead[row.name] = queued;
      deadTotal += queued;
      continue;
    }
    const failedRecent = Number(row.failed_recent);
    if (failedRecent > 0) failed[row.name] = failedRecent;
    failedTotal += failedRecent;
    if (row.ready_oldest_s !== null && row.ready_oldest_s > 0) {
      backlog[row.name] = Math.round(row.ready_oldest_s);
      oldest = Math.max(oldest, row.ready_oldest_s);
    }
  }
  return {
    job_dead_letter_n: deadTotal,
    job_failed_recent_n: failedTotal,
    job_backlog_s: oldest,
    details: { job_dead_letter_n: dead, job_failed_recent_n: failed, job_backlog_s: backlog },
  };
}

interface BacklogRow {
  readonly derived_refresh_pending_n: string;
  readonly derived_refresh_oldest_s: number | null;
  readonly reports_failed_n: string;
  readonly exports_failed_n: string;
  readonly notifications_failed_n: string;
}

/** The worker's own tables across clubs, through `app.worker_ops_backlog` (counts only). */
export async function measureBacklog(
  pool: pg.Pool,
  failedSince: Date,
): Promise<
  Pick<
    OpsMeasurements,
    'derived_refresh_lag_s' | 'reports_failed_n' | 'exports_failed_n' | 'notifications_failed_n'
  > & { readonly derivedRefreshPendingN: number }
> {
  const { rows } = await pool.query<BacklogRow>('select * from app.worker_ops_backlog($1)', [
    failedSince,
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error('app.worker_ops_backlog returned no row');
  return {
    derivedRefreshPendingN: Number(row.derived_refresh_pending_n),
    // No pending recalculation: no lag.
    derived_refresh_lag_s: row.derived_refresh_oldest_s ?? 0,
    reports_failed_n: Number(row.reports_failed_n),
    exports_failed_n: Number(row.exports_failed_n),
    notifications_failed_n: Number(row.notifications_failed_n),
  };
}

/** `xmin` and `xmax` of a fresh snapshot: the horizon a sync pull would serve up to (ADR 0050). */
export async function sampleSyncHorizon(
  pool: pg.Pool,
): Promise<{ readonly xmin: string; readonly xmax: string }> {
  const { rows } = await pool.query<{ xmin: string; xmax: string }>(
    `select pg_snapshot_xmin(s)::text as xmin, pg_snapshot_xmax(s)::text as xmax
       from pg_current_snapshot() as s`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('pg_current_snapshot returned no row');
  return row;
}

/** Evaluates every check the worker measures (`measuredBy: 'worker'`) against its definition. */
export function evaluateMeasurements(measurements: OpsMeasurements): MeasuredCheck[] {
  return OPS_CHECKS.filter((d) => d.measuredBy === 'worker').map((definition) => {
    const code = definition.code as Exclude<OpsCheckCode, 'worker_heartbeat_s'>;
    const value = measurements[code];
    return {
      code,
      status: evaluateOpsCheck(definition, value),
      value: value === null || !Number.isFinite(value) ? null : value,
      detail: measurements.details[code] ?? {},
    };
  });
}

interface RecordedRow {
  readonly code: string;
  readonly status: string;
  readonly previous_status: string | null;
  readonly status_since: Date;
  readonly notify: boolean;
}

/** Stores one pass (`app.worker_record_ops_checks`); says which checks to announce now. */
export async function recordChecks(
  pool: pg.Pool,
  checks: readonly MeasuredCheck[],
  renotifyMinutes: number,
): Promise<RecordedCheck[]> {
  const { rows } = await pool.query<RecordedRow>(
    `select code, status, previous_status, status_since, notify
       from app.worker_record_ops_checks($1::jsonb, make_interval(mins => $2::int))`,
    [JSON.stringify(checks), renotifyMinutes],
  );
  return rows.map((row) => ({
    code: row.code as OpsCheckCode,
    status: isOpsCheckStatus(row.status) ? row.status : 'unknown',
    previousStatus:
      row.previous_status !== null && isOpsCheckStatus(row.previous_status)
        ? row.previous_status
        : null,
    statusSince: row.status_since,
    notify: row.notify,
  }));
}

const FAILING = new Set<OpsCheckStatus>(['warning', 'critical']);

export interface OpsMonitor {
  /** One pass: measure, record, announce, check in. Throws when it could not record. */
  run(): Promise<readonly MeasuredCheck[]>;
}

/**
 * The monitor keeps the sync horizon between passes in memory: a restart
 * starts the count over (it under-reports a stall, never over-reports).
 */
export function createOpsMonitor(deps: OpsMonitorDependencies): OpsMonitor {
  const now = deps.now ?? (() => new Date());
  let horizon: SyncHorizonState | null = null;

  /** A source that fails is `unknown` (and logged), never a failed pass: the rest still counts. */
  async function attempt<T>(source: string, read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      deps.logger.warn({ err: error, source }, 'ops monitor: a source could not be measured');
      return null;
    }
  }

  async function measure(): Promise<OpsMeasurements> {
    const at = now();
    const failedJobsSince = new Date(at.getTime() - OPS_FAILED_JOBS_WINDOW_S * 1000);
    const failedDeliveriesSince = new Date(at.getTime() - OPS_FAILED_DELIVERIES_WINDOW_S * 1000);
    const [jobs, backlog, sample] = await Promise.all([
      attempt('job_queue', () => measureJobQueue(deps.pool, failedJobsSince)),
      attempt('backlog', () => measureBacklog(deps.pool, failedDeliveriesSince)),
      attempt('sync_horizon', () => sampleSyncHorizon(deps.pool)),
    ]);
    let stalledS: number | null = null;
    if (sample !== null) {
      const tracked = trackSyncHorizon(horizon, { ...sample, at });
      horizon = tracked.state;
      stalledS = tracked.stalledS;
    }
    return {
      job_dead_letter_n: jobs?.job_dead_letter_n ?? null,
      job_failed_recent_n: jobs?.job_failed_recent_n ?? null,
      job_backlog_s: jobs?.job_backlog_s ?? null,
      derived_refresh_lag_s: backlog?.derived_refresh_lag_s ?? null,
      reports_failed_n: backlog?.reports_failed_n ?? null,
      exports_failed_n: backlog?.exports_failed_n ?? null,
      notifications_failed_n: backlog?.notifications_failed_n ?? null,
      sync_horizon_stalled_s: stalledS,
      details: jobs?.details ?? {},
    };
  }

  function announce(checks: readonly MeasuredCheck[], recorded: readonly RecordedCheck[]): void {
    const byCode = new Map(checks.map((c) => [c.code, c]));
    for (const row of recorded) {
      const check = byCode.get(row.code);
      if (check === undefined) continue;
      const fields = {
        check: row.code,
        status: row.status,
        previous: row.previousStatus,
        value: check.value,
        detail: check.detail,
        since: row.statusSince.toISOString(),
      };
      if (FAILING.has(row.status)) {
        if (row.notify) {
          deps.logger.warn(fields, 'ops check failing');
          deps.reporter.notice({
            message: `Operational check ${row.code} is ${row.status}`,
            level: row.status === 'critical' ? 'error' : 'warning',
            // One issue per check: a status change or a repeat lands in the same issue.
            fingerprint: ['ops-check', row.code],
            tags: { ops_check: row.code, ops_status: row.status },
          });
        }
      } else if (row.previousStatus !== null && FAILING.has(row.previousStatus)) {
        deps.logger.info(fields, 'ops check recovered');
      }
    }
  }

  return {
    async run() {
      try {
        const checks = evaluateMeasurements(await measure());
        const recorded = await recordChecks(deps.pool, checks, deps.renotifyMinutes);
        announce(checks, recorded);
        deps.reporter.checkIn(checkIn('ok'));
        return checks;
      } catch (error) {
        deps.reporter.checkIn(checkIn('error'));
        throw error;
      }
    },
  };
}

function checkIn(status: 'ok' | 'error') {
  return {
    monitorSlug: OPS_MONITOR_SLUG,
    status,
    crontab: OPS_MONITOR_SCHEDULE.cron,
    // A deploy restarts the worker in a minute or two: alert from the third minute late.
    marginMinutes: 3,
    maxRuntimeMinutes: 2,
    failureIssueThreshold: 2,
  } as const;
}
