import { memberGuard } from './enum.js';

/**
 * Operational checks of the platform (B-703, ADR 0095): whether the worker
 * runs, whether jobs fail or fall behind, and whether the sync horizon moves.
 * Declarative: each check is data (code, unit, thresholds), evaluated by the
 * same pure functions in the worker (that measures and announces) and in the
 * API (that serves `/health/ops` to the uptime monitor).
 *
 * Values are platform-wide counts and ages: never a club, a player or
 * anything of the `medical` schema.
 */

export const OPS_CHECK_STATUSES = ['ok', 'warning', 'critical', 'unknown'] as const;
export type OpsCheckStatus = (typeof OPS_CHECK_STATUSES)[number];
export const isOpsCheckStatus = memberGuard(OPS_CHECK_STATUSES);

/** `s`: seconds (an age); `n`: a count. */
export type OpsCheckUnit = 's' | 'n';

export const OPS_CHECK_CODES = [
  'worker_heartbeat_s',
  'job_dead_letter_n',
  'job_failed_recent_n',
  'job_backlog_s',
  'derived_refresh_lag_s',
  'reports_failed_n',
  'exports_failed_n',
  'notifications_failed_n',
  'sync_horizon_stalled_s',
] as const;
export type OpsCheckCode = (typeof OPS_CHECK_CODES)[number];
export const isOpsCheckCode = memberGuard(OPS_CHECK_CODES);

export interface OpsCheckDefinition {
  readonly code: OpsCheckCode;
  readonly unit: OpsCheckUnit;
  /** At or above: `warning`. */
  readonly warning: number;
  /** At or above: `critical`. Never below `warning`. */
  readonly critical: number;
  /**
   * Who measures it: the worker's monitor job, or the API from the time of the
   * worker's last pass (the worker cannot report its own absence).
   */
  readonly measuredBy: 'worker' | 'api';
  /** Status when the value could not be measured. */
  readonly whenMissing: 'unknown' | 'critical';
  /** Short English description, for logs and the runbook (`docs/ops/monitoreo.md`). */
  readonly description: string;
}

/** How often the worker's monitor runs (cron `* * * * *`). */
export const OPS_MONITOR_INTERVAL_S = 60;
/** Window of `job_failed_recent_n`. */
export const OPS_FAILED_JOBS_WINDOW_S = 60 * 60;
/** Window of `reports_failed_n`, `exports_failed_n` and `notifications_failed_n`. */
export const OPS_FAILED_DELIVERIES_WINDOW_S = 24 * 60 * 60;

const MINUTE = 60;

/**
 * The checks and their default thresholds. Changing a threshold is a reviewed
 * change of this file (configuration as code), documented in the runbook.
 */
export const OPS_CHECKS: readonly OpsCheckDefinition[] = [
  {
    code: 'worker_heartbeat_s',
    unit: 's',
    // Three missed passes of the monitor, five for critical: a deploy restarts it in less.
    warning: 3 * MINUTE,
    critical: 5 * MINUTE,
    measuredBy: 'api',
    whenMissing: 'critical',
    description: 'seconds since the last pass of the worker monitor',
  },
  {
    code: 'job_dead_letter_n',
    unit: 'n',
    warning: 1,
    critical: 10,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description: 'jobs in the dead letter queues (every retry failed), waiting for a redrive',
  },
  {
    code: 'job_failed_recent_n',
    unit: 'n',
    warning: 1,
    critical: 10,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description: 'jobs that failed for good in the last hour',
  },
  {
    code: 'job_backlog_s',
    unit: 's',
    warning: 5 * MINUTE,
    critical: 30 * MINUTE,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description: 'seconds the oldest job ready to run has waited',
  },
  {
    code: 'derived_refresh_lag_s',
    unit: 's',
    // Loads, ACWR and alerts wait for it: a quarter of an hour is already late.
    warning: 15 * MINUTE,
    critical: 60 * MINUTE,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description: 'seconds the oldest pending recalculation (outbox) has waited',
  },
  {
    code: 'reports_failed_n',
    unit: 'n',
    warning: 1,
    critical: 10,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description: 'PDF reports (player and category) that failed in the last 24 hours',
  },
  {
    code: 'exports_failed_n',
    unit: 'n',
    warning: 1,
    critical: 5,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description: 'CSV exports of club data that failed in the last 24 hours',
  },
  {
    code: 'notifications_failed_n',
    unit: 'n',
    // A token of an uninstalled app fails now and then; many is a provider problem.
    warning: 5,
    critical: 50,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description: 'notification deliveries (push and email) that failed in the last 24 hours',
  },
  {
    code: 'sync_horizon_stalled_s',
    unit: 's',
    warning: 10 * MINUTE,
    critical: 30 * MINUTE,
    measuredBy: 'worker',
    whenMissing: 'unknown',
    description:
      'seconds the sync pull horizon (snapshot xmin) has not moved while transactions run',
  },
];

const BY_CODE = new Map(OPS_CHECKS.map((d) => [d.code, d]));

export function opsCheckDefinition(code: OpsCheckCode): OpsCheckDefinition {
  const definition = BY_CODE.get(code);
  if (definition === undefined) throw new Error(`Unknown operational check: ${code}`);
  return definition;
}

/** Status of a value against its check: `null` (not measured) gives `whenMissing`. */
export function evaluateOpsCheck(
  definition: OpsCheckDefinition,
  value: number | null,
): OpsCheckStatus {
  if (value === null || !Number.isFinite(value)) return definition.whenMissing;
  if (value >= definition.critical) return 'critical';
  if (value >= definition.warning) return 'warning';
  return 'ok';
}

const SEVERITY: Record<OpsCheckStatus, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 };

/**
 * The worst status of a set: `critical` > `warning` > `unknown` > `ok`. An
 * empty set is `unknown` (nothing was measured).
 */
export function overallOpsStatus(statuses: readonly OpsCheckStatus[]): OpsCheckStatus {
  let worst: OpsCheckStatus | null = null;
  for (const status of statuses) {
    if (worst === null || SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst ?? 'unknown';
}

/** `true` when an uptime monitor must see a failure (`503`): something is critical. */
export function opsStatusFails(status: OpsCheckStatus): boolean {
  return status === 'critical';
}

/** Seconds since the worker's last pass; `null` when it never reported. */
export function workerHeartbeatAgeS(lastCheckedAt: Date | null, now: Date): number | null {
  if (lastCheckedAt === null) return null;
  return Math.max(0, (now.getTime() - lastCheckedAt.getTime()) / 1000);
}

/**
 * The sync pull horizon (ADR 0050): a pull only serves changes below the
 * `xmin` of its snapshot, so one transaction left open holds every device's
 * pull at that point. Tracked across passes of the monitor: the horizon is
 * stalled when `xmin` stays the same while newer transactions exist
 * (`xmax > xmin`). Ids are the decimal text of `xid8`.
 */
export interface SyncHorizonSample {
  readonly xmin: string;
  readonly xmax: string;
  readonly at: Date;
}

export interface SyncHorizonState {
  /** `xmin` seen at `since`, when it was first seen holding back newer transactions. */
  readonly xmin: string;
  readonly since: Date;
}

/**
 * Next state and how long the horizon has been stalled (seconds). The first
 * sample of a stall counts from that sample: a worker that just started
 * under-reports, never over-reports.
 */
export function trackSyncHorizon(
  previous: SyncHorizonState | null,
  sample: SyncHorizonSample,
): { readonly state: SyncHorizonState | null; readonly stalledS: number } {
  if (BigInt(sample.xmax) <= BigInt(sample.xmin)) return { state: null, stalledS: 0 };
  if (previous?.xmin !== sample.xmin) {
    return { state: { xmin: sample.xmin, since: sample.at }, stalledS: 0 };
  }
  return {
    state: previous,
    stalledS: Math.max(0, (sample.at.getTime() - previous.since.getTime()) / 1000),
  };
}
