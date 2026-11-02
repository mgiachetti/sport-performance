import shared from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Integration tests (`*.integration.test.ts`) create a database and run every
 * migration, so they get longer timeouts than the unit-test preset.
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
