/**
 * @sport-performance/db: PostgreSQL schema (Drizzle ORM), versioned SQL
 * migrations and the migration runner (ADR 0004, ADR 0023).
 *
 * - `@sport-performance/db/schema`: tables, enums and column helpers.
 * - `@sport-performance/db/migrate`: `runMigrations()` without the ORM client.
 * - `@sport-performance/db/roles`: connection roles, login provisioning and
 *   the startup check of the login (ADR 0026).
 */
export * as schema from './schema/index.js';
export { createDatabase, createPool, type CreatePoolOptions, type Database } from './client.js';
export {
  MIGRATIONS_FOLDER,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  MIGRATION_LOCK_KEY,
  MigrationOrderError,
  migrationsConnectionString,
  runMigrations,
  type MigrationReport,
  type RunMigrationsOptions,
} from './migrate.js';
export { JOB_QUEUE_SCHEMA, installJobQueue, type InstallJobQueueOptions } from './job-queue.js';
export {
  DATABASE_ROLES,
  DATABASE_ROLE_KINDS,
  DatabaseRoleError,
  TENANT_SETTING_NAMES,
  assertConnectionRole,
  isDatabaseRoleKind,
  provisionLoginRole,
  scramSha256Verifier,
  type DatabaseRoleKind,
  type ProvisionLoginRoleOptions,
} from './roles.js';
export {
  RELEASE_LOGIN_VARIABLES,
  ReleaseConfigError,
  describeRelease,
  releaseDatabase,
  releasePlanFromEnv,
  type ReleaseEnvironment,
  type ReleaseLogin,
  type ReleasePlan,
  type ReleaseReport,
} from './release.js';
export type * from './types.js';
export {
  CHANGE_HISTORY_PAGE_LIMIT_DEFAULT,
  CHANGE_HISTORY_PAGE_LIMIT_MAX,
  CHANGE_SETTING_NAMES,
  ChangeContextError,
  listPlayerChangeHistory,
  listRecordChangeHistory,
  setChangeContext,
  type ChangeContext,
  type ChangeHistoryEntry,
  type ChangeHistoryPage,
  type ChangeHistoryPageOptions,
  type ChangedValue,
} from './history.js';
export {
  RESTORE_CHECK_NAMES,
  RESTORE_CLOCK_SKEW_MS_DEFAULT,
  RESTORE_DATA_SCHEMAS,
  RESTORE_KINDS,
  RESTORE_LABEL_MAX_LENGTH,
  RESTORE_REASON_MAX_LENGTH,
  RestoreToolError,
  evaluateRestore,
  isRestoreKind,
  readRestoreFacts,
  recordRestoreEvent,
  verifyRestoredDatabase,
  writeRestoreDrillMarker,
  type RecordRestoreEventOptions,
  type RestoreCheck,
  type RestoreCheckName,
  type RestoreCheckStatus,
  type RestoreDrillMarker,
  type RestoreEvent,
  type RestoreFacts,
  type RestoreKind,
  type RestoreVerificationReport,
  type VerifyRestoreOptions,
  type WriteRestoreDrillMarkerOptions,
} from './restore.js';
