import { afterEach } from 'vitest';

/**
 * How long `findBy*` and `waitFor` wait in the component tests: Testing
 * Library's 1 s is wall-clock time, and `pnpm test` runs every package at once
 * on a CI runner, where the first test of a file also pays the cold start of
 * its worker. 5 s, as in the web (#220): a missing element is still a fast
 * failure, far below the shared `testTimeout`, which catches a hang.
 */
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5000 });
}

// Testing Library only auto-cleans with globals enabled; the shared preset does not enable them.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
