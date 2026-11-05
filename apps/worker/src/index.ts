/**
 * @sport-performance/worker: background jobs on pg-boss (ADR 0011, ADR 0046).
 * The process entry point is `main.ts`; this module exposes the pieces for
 * tests and for the jobs of later issues (alerts, notifications), which plug
 * into the same queues and the same per-club transactions.
 */
export const appName = '@sport-performance/worker' as const;

export { ConfigError, configSummary, loadConfig, type WorkerConfig } from './config.js';
export { inClubTransaction, type ClubTransaction } from './database.js';
export {
  ClubRefreshError,
  REFRESH_BATCH_SIZE,
  WHOLE_SERIES_FROM,
  refreshClub,
  refreshPlayer,
  type ClubRefreshReport,
  type PlayerRefresh,
  type RefreshDependencies,
} from './derived/refresh.js';
export {
  planLoadDaily,
  type ExternalLoadEntry,
  type LoadDailyPlan,
  type ParticipationLoad,
} from './derived/load-rows.js';
export { purgeClubFiles, type PurgeDependencies } from './files.js';
export { DERIVED_REFRESH_CHANNEL, startRefreshListener } from './listener.js';
export {
  createLogger,
  disabledErrorReporter,
  type CronCheckIn,
  type ErrorReporter,
  type ErrorReportContext,
  type OpsNotice,
} from './observability.js';
export {
  OPS_MONITOR_SLUG,
  createOpsMonitor,
  type MeasuredCheck,
  type OpsMonitor,
  type OpsMonitorDependencies,
} from './ops/monitor.js';
export {
  QUEUES,
  DEAD_LETTER_QUEUES,
  FILE_SCHEDULES,
  OPS_MONITOR_SCHEDULE,
  QUEUE_DEFINITIONS,
  SCHEDULES,
  enqueueClubJob,
  enqueueClubRefresh,
  listClubs,
  listReportClubs,
  parseRefreshClubJob,
  setUpQueues,
} from './queues.js';
export {
  REPORTS_PER_JOB,
  runClubReports,
  type ClubReportsReport,
  type ReportDependencies,
} from './reports/job.js';
export { startWorker, type RunningWorker, type StartWorkerOptions } from './worker.js';
