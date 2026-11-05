import shared from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Unit tests of the harness (`src/**` next to the code). The end-to-end
 * scenarios (`tests/`) run with Playwright (`pnpm e2e`), never with Vitest.
 */
export default mergeConfig(shared, defineConfig({}));
