import shared from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * The Postgres suites (`*.pg.test.ts`) create a database, run every
 * migration and sign users in during setup. With every package testing at
 * once (CI, `pnpm test`) that takes far longer than the 10 s default (issue
 * #147), so this package gets the hook timeout of the integration tests of
 * `packages/db` and a test timeout for requests on a loaded runner.
 */
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      testTimeout: 60_000,
      // FULL_MIGRATION_TIMEOUT_MS: the first hook of a run may build the migrated template.
      hookTimeout: 300_000,
    },
  }),
);
