import shared from '@sport-performance/config/vitest';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

/** Shared preset + jsdom and Testing Library (`src/test/setup.ts`). */
export default mergeConfig(
  shared,
  defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }),
);
