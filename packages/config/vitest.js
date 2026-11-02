// @ts-check
import { defineConfig } from 'vitest/config';

/** Shared Vitest preset: unit tests live next to the code as `*.test.ts`. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    passWithNoTests: false,
    // `pnpm test` runs every package at once, so a CPU-bound unit test (the
    // OpenAPI validation of `contracts`) can take several times what it takes
    // alone; Vitest's 5 s / 10 s defaults then fail green code (issue #147).
    // Still low enough to catch a test that hangs.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
