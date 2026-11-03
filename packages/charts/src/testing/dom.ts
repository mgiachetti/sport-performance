import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, expect } from 'vitest';

/** Unmounts after every test (Vitest runs without globals, so RTL cannot hook it itself). */
export function setupDomTests(): void {
  afterEach(() => {
    cleanup();
  });
}

/**
 * Runs axe-core on a rendered chart. `color-contrast` needs real layout and CSS (the tokens
 * guarantee contrast, tested in packages/ui-tokens) and `region` is about whole pages.
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.html).join(' | ')})`,
    ),
  ).toEqual([]);
}
