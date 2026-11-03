// @ts-check
import { createConfig } from '@sport-performance/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  createConfig({ tsconfigRootDir: import.meta.dirname }),
  { ignores: ['android/**', 'ios/**', '.expo/**', 'metro.config.cjs'] },
  {
    files: ['**/*.tsx', '**/*.ts'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
);
