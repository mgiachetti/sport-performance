import shared from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Unit tests run in Node; component tests (`*.test.tsx`, with
 * `@vitest-environment jsdom`) render the screens through `react-native-web`
 * and Testing Library, so they run without a simulator (ADR 0058). Native
 * modules (`expo-*`) stay behind interfaces and are never imported by tested code.
 */
export default mergeConfig(
  shared,
  defineConfig({
    resolve: {
      alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
    },
    define: { __DEV__: 'true' },
    test: {
      setupFiles: ['./vitest.setup.ts'],
    },
  }),
);
