// @ts-check
import { defineConfig } from 'vitest/config';

/** Shared Vitest preset: unit tests live next to the code as `*.test.ts`. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
