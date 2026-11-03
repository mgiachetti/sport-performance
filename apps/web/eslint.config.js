import { createConfig } from '@sport-performance/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname, browser: true }),
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TanStack Router redirects and not-founds are thrown by design (`throw redirect(...)`).
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [{ from: 'package', package: '@tanstack/router-core', name: 'Redirect' }],
          allowRethrowing: true,
        },
      ],
    },
  },
];
