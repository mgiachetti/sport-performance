import shared from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * The Postgres suites (`*.pg.test.ts`) create a database, run every
 * migration and sign users in during setup. With every package testing at
 * once (CI, `pnpm test`) that takes far longer than the 10 s default (issue
 * #147), so this package gets the same timeouts as the integration tests of
 * `packages/db`.
 */
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
  }),
);
