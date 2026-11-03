import { afterEach } from 'vitest';

// Testing Library only auto-cleans with globals enabled; the shared preset does not enable them.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
