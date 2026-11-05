import type pg from 'pg';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { CronCheckIn, ErrorReporter, OpsNotice } from '../observability.js';
import { QUEUES } from '../queues.js';
import { OPS_MONITOR_SLUG, createOpsMonitor, evaluateMeasurements } from './monitor.js';

const logger = pino({ level: 'silent' });

function recordingReporter() {
  const notices: OpsNotice[] = [];
  const checkIns: CronCheckIn[] = [];
  const reporter: ErrorReporter = {
    enabled: true,
    capture() {
      // Not used by these tests.
    },
    notice: (notice) => notices.push(notice),
    checkIn: (checkIn) => checkIns.push(checkIn),
    flush: () => Promise.resolve(true),
  };
  return { reporter, notices, checkIns };
}

interface FakeState {
  jobs: { name: string; failed_recent: string; queued: string; ready_oldest_s: number | null }[];
  backlog: Record<string, unknown> | Error;
  horizon: { xmin: string; xmax: string };
  /** What `worker_record_ops_checks` answers for the checks it receives. */
  record: (checks: { code: string; status: string }[]) => Record<string, unknown>[];
  recorded: { code: string; status: string; value: number | null }[][];
}

/** A pool that answers the monitor's three reads and its write by their SQL. */
function fakePool(state: FakeState): pg.Pool {
  const query = (text: string, values: unknown[] = []) => {
    if (text.includes('pgboss')) return Promise.resolve({ rows: state.jobs });
    if (text.includes('worker_ops_backlog')) {
      return state.backlog instanceof Error
        ? Promise.reject(state.backlog)
        : Promise.resolve({ rows: [state.backlog] });
    }
    if (text.includes('pg_current_snapshot')) return Promise.resolve({ rows: [state.horizon] });
    if (text.includes('worker_record_ops_checks')) {
      const checks = JSON.parse(String(values[0])) as {
        code: string;
        status: string;
        value: number | null;
      }[];
      state.recorded.push(checks);
      return Promise.resolve({ rows: state.record(checks) });
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };
  return { query } as unknown as pg.Pool;
}

const healthyBacklog = {
  derived_refresh_pending_n: '0',
  derived_refresh_oldest_s: null,
  reports_failed_n: '0',
  exports_failed_n: '0',
  notifications_failed_n: '0',
};

function state(overrides: Partial<FakeState> = {}): FakeState {
  return {
    jobs: [],
    backlog: healthyBacklog,
    horizon: { xmin: '1000', xmax: '1000' },
    record: (checks) =>
      checks.map((c) => ({
        code: c.code,
        status: c.status,
        previous_status: 'ok',
        status_since: new Date('2026-11-04T12:00:00Z'),
        notify: c.status === 'warning' || c.status === 'critical',
      })),
    recorded: [],
    ...overrides,
  };
}

describe('evaluateMeasurements', () => {
  it('evaluates every check the worker measures and keeps the per-queue detail', () => {
    const checks = evaluateMeasurements({
      job_dead_letter_n: 2,
      job_failed_recent_n: 0,
      job_backlog_s: 2400,
      derived_refresh_lag_s: 0,
      reports_failed_n: null,
      exports_failed_n: 0,
      notifications_failed_n: 60,
      sync_horizon_stalled_s: 0,
      details: { job_dead_letter_n: { [QUEUES.refreshClubDead]: 2 } },
    });
    expect(checks.map((c) => c.code)).not.toContain('worker_heartbeat_s');
    const byCode = Object.fromEntries(checks.map((c) => [c.code, c]));
    expect(byCode.job_dead_letter_n).toEqual({
      code: 'job_dead_letter_n',
      status: 'warning',
      value: 2,
      detail: { [QUEUES.refreshClubDead]: 2 },
    });
    expect(byCode.job_backlog_s?.status).toBe('critical');
    expect(byCode.reports_failed_n).toMatchObject({ status: 'unknown', value: null });
    expect(byCode.notifications_failed_n?.status).toBe('critical');
    expect(byCode.exports_failed_n).toMatchObject({ status: 'ok', detail: {} });
  });
});

describe('ops monitor', () => {
  it('splits the job queue into dead letters, recent failures and backlog of our own queues', async () => {
    const s = state({
      jobs: [
        { name: QUEUES.refreshClubDead, failed_recent: '0', queued: '3', ready_oldest_s: 9000 },
        { name: QUEUES.sweep, failed_recent: '2', queued: '0', ready_oldest_s: null },
        { name: QUEUES.refreshClub, failed_recent: '0', queued: '4', ready_oldest_s: 420.4 },
        { name: 'someone-elses-queue', failed_recent: '50', queued: '50', ready_oldest_s: 1e6 },
      ],
    });
    const { reporter } = recordingReporter();
    const checks = await createOpsMonitor({
      pool: fakePool(s),
      logger,
      reporter,
      renotifyMinutes: 60,
    }).run();
    const byCode = Object.fromEntries(checks.map((c) => [c.code, c]));
    expect(byCode.job_dead_letter_n).toMatchObject({
      value: 3,
      status: 'warning',
      detail: { [QUEUES.refreshClubDead]: 3 },
    });
    expect(byCode.job_failed_recent_n).toMatchObject({
      value: 2,
      status: 'warning',
      detail: { [QUEUES.sweep]: 2 },
    });
    // The dead letter queue is never worked: its age is not backlog.
    expect(byCode.job_backlog_s).toMatchObject({
      value: 420.4,
      status: 'warning',
      detail: { [QUEUES.refreshClub]: 420 },
    });
  });

  it('announces only what the database says to announce, one Sentry issue per check, and checks in', async () => {
    const s = state({
      jobs: [{ name: QUEUES.refreshClubDead, failed_recent: '0', queued: '12', ready_oldest_s: 1 }],
      backlog: { ...healthyBacklog, derived_refresh_oldest_s: 1000 },
      record: (checks) =>
        checks.map((c) => ({
          code: c.code,
          status: c.status,
          previous_status: c.code === 'derived_refresh_lag_s' ? 'warning' : 'ok',
          status_since: new Date('2026-11-04T12:00:00Z'),
          // The lag was already announced within the renotify interval.
          notify: c.code === 'job_dead_letter_n',
        })),
    });
    const { reporter, notices, checkIns } = recordingReporter();
    await createOpsMonitor({ pool: fakePool(s), logger, reporter, renotifyMinutes: 60 }).run();
    expect(notices).toEqual([
      {
        message: 'Operational check job_dead_letter_n is critical',
        level: 'error',
        fingerprint: ['ops-check', 'job_dead_letter_n'],
        tags: { ops_check: 'job_dead_letter_n', ops_status: 'critical' },
      },
    ]);
    expect(checkIns).toEqual([
      {
        monitorSlug: OPS_MONITOR_SLUG,
        status: 'ok',
        crontab: '* * * * *',
        marginMinutes: 3,
        maxRuntimeMinutes: 2,
        failureIssueThreshold: 2,
      },
    ]);
    // Nothing personal goes to the database or to Sentry: codes, statuses, numbers.
    expect(JSON.stringify(s.recorded)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('a source that fails is unknown and the pass still records the rest', async () => {
    const s = state({ backlog: new Error('statement timeout') });
    const { reporter, checkIns } = recordingReporter();
    const checks = await createOpsMonitor({
      pool: fakePool(s),
      logger,
      reporter,
      renotifyMinutes: 60,
    }).run();
    const byCode = Object.fromEntries(checks.map((c) => [c.code, c]));
    expect(byCode.derived_refresh_lag_s).toMatchObject({ status: 'unknown', value: null });
    expect(byCode.job_dead_letter_n).toMatchObject({ status: 'ok', value: 0 });
    expect(checkIns.map((c) => c.status)).toEqual(['ok']);
  });

  it('tracks the sync horizon across passes', async () => {
    let minute = 0;
    const s = state({ horizon: { xmin: '500', xmax: '520' } });
    const { reporter } = recordingReporter();
    const monitor = createOpsMonitor({
      pool: fakePool(s),
      logger,
      reporter,
      renotifyMinutes: 60,
      now: () => new Date(Date.UTC(2026, 10, 4, 12, minute)),
    });
    const horizon = async () =>
      (await monitor.run()).find((c) => c.code === 'sync_horizon_stalled_s');
    expect(await horizon()).toMatchObject({ value: 0, status: 'ok' });
    minute = 11;
    expect(await horizon()).toMatchObject({ value: 660, status: 'warning' });
    minute = 40;
    expect(await horizon()).toMatchObject({ value: 2400, status: 'critical' });
    s.horizon = { xmin: '530', xmax: '530' };
    minute = 41;
    expect(await horizon()).toMatchObject({ value: 0, status: 'ok' });
  });

  it('a pass that cannot record checks in as an error and throws', async () => {
    const s = state({
      record: () => {
        throw new Error('database down');
      },
    });
    const { reporter, checkIns } = recordingReporter();
    await expect(
      createOpsMonitor({ pool: fakePool(s), logger, reporter, renotifyMinutes: 60 }).run(),
    ).rejects.toThrow('database down');
    expect(checkIns.map((c) => c.status)).toEqual(['error']);
  });
});
