import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` only: it diffs the schema against the snapshots in
 * `drizzle/meta` and writes a new SQL migration to review and commit
 * (ADR 0004). Hand-written SQL (triggers, RLS, grants) goes in a custom
 * migration: `pnpm --filter @sport-performance/db db:generate:custom --name=<name>`.
 *
 * Never `drizzle-kit push` or `drizzle-kit migrate` against a shared database:
 * migrations run through `runMigrations()` / `db:migrate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
