import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';
import unit from './vitest.config.ts';

const merged: ViteUserConfig = mergeConfig(
  unit,
  defineConfig({
    test: {
      testTimeout: 120_000,
      hookTimeout: 120_000,
      // One device at a time: the scenarios share the demo club of the stack.
      fileParallelism: false,
    },
  }),
);

/**
 * End-to-end tests of the app without a device (B-108, ADR 0096): the app's
 * client and sync engine against the running end-to-end stack
 * (`pnpm --filter @sport-performance/e2e e2e:stack`). Never part of `pnpm
 * test`. `include` replaces the unit tests' (`mergeConfig` would append).
 */
export default defineConfig({
  ...merged,
  test: { ...merged.test, include: ['e2e/**/*.e2e.test.ts'] },
});
