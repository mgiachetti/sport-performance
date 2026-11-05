import type { Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import { createTranslator } from '@sport-performance/i18n';
import type { DemoDataset } from '@sport-performance/db/seeds';
import {
  DEMO_ACCOUNTS,
  demoDataset,
  demoEmail,
  readRunState,
  stackEndpoints,
  type DemoAccount,
  type RunState,
} from '../src/harness/index.ts';

/** Where the stack is (the same environment variables as the stack itself). */
export const endpoints = stackEndpoints();

/** The es-AR catalog of the apps: tests find what the user reads, never copied strings. */
export const { t } = createTranslator();

let cachedState: RunState | undefined;
let cachedDataset: DemoDataset | undefined;

/** State of the running stack (`state.json`), read once per worker. */
export function runState(): RunState {
  cachedState ??= readRunState(endpoints.runDir);
  return cachedState;
}

/** The demo dataset the stack seeded, recomputed once per worker. */
export function dataset(): DemoDataset {
  cachedDataset ??= demoDataset(runState());
  return cachedDataset;
}

export function accountEmail(account: DemoAccount): string {
  return demoEmail(runState(), DEMO_ACCOUNTS[account]);
}

/** Saved session (storage state) of an account, written by `sessions.setup.ts`. */
export function sessionFile(account: DemoAccount): string {
  return join(endpoints.runDir, 'sessions', `${account}.json`);
}

/** The page's `<h1>` (`<Page title>` of the web), by its exact text. */
export function pageTitle(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 1, name: title, exact: true });
}

/** The main navigation of the club shell. */
export function mainNav(page: Page): Locator {
  return page.getByRole('navigation', { name: t('nav.label') });
}
