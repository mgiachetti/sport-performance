import shared from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Integration tests (`*.integration.test.ts`) create a database and run every
 * migration, so they get longer timeouts than the unit-test preset. Some
 * tests run the migrations in their body (`migrate`, `migrations`, schema in
 * sync): 15–25 s each when every package tests at once, so 30 s was too
 * tight (issue #147).
 */
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
