import shared from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * The Postgres suites (`*.pg.test.ts`) copy the migrated template database and
 * run pg-boss against it. With every package testing at once (CI, `pnpm
 * test`) that takes far longer than the 10 s default (issue #147), so this
 * package gets the hook timeout of the integration tests of `packages/db`.
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
