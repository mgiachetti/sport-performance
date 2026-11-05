import { createConfig } from '@sport-performance/config/eslint';

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  { ignores: ['.e2e-run/**', 'playwright-report/**', 'test-results/**', 'blob-report/**'] },
];
