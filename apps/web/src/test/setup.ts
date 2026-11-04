import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetTestEnvironment } from './reset';

/**
 * How long `findBy*` and `waitFor` wait for the screen to get where the test
 * expects. Testing Library's 1 s is wall-clock time, and `pnpm test` runs
 * every package at once on a CI runner: with the cold start already paid by
 * the warm-up in `render-app.tsx`, a screen that takes several steps (type,
 * check, save) still went past it under heavy contention. 5 s keeps a missing
 * element a fast failure and stays far below the shared `testTimeout` (30 s,
 * issue #147), which is what catches a hang.
 */
configure({ asyncUtilTimeout: 5000 });

/** jsdom has no `matchMedia`: a static one that matches nothing (tests override it). */
function installMatchMedia(): void {
  if (typeof window.matchMedia === 'function') return;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// Also before any `beforeAll` (the app's warm-up in `render-app.tsx`).
installMatchMedia();

beforeEach(() => {
  installMatchMedia();
});

afterEach(() => {
  resetTestEnvironment();
});
