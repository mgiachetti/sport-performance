/**
 * @sport-performance/db: PostgreSQL schema (Drizzle ORM), versioned SQL
 * migrations and the migration runner (ADR 0004, ADR 0023).
 *
 * - `@sport-performance/db/schema`: tables, enums and column helpers.
 * - `@sport-performance/db/migrate`: `runMigrations()` without the ORM client.
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
export type * from './types.js';
