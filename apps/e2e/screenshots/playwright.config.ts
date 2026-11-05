import { defineConfig } from '@playwright/test';
import { stackEndpoints } from '../src/stack/config.ts';

const endpoints = stackEndpoints();

/**
 * Screenshots of the staff web for design reviews (ADR 0097), against a stack
 * that is already running (`e2e:stack`, same `E2E_*` variables): the `setup`
 * project opens the sessions of the demo accounts like the scenarios do, then
 * `screens.shots.ts` captures every screen. Not part of `e2e` or CI.
 */
export default defineConfig({
  testDir: '..',
  outputDir: '../test-results/screenshots',
  fullyParallel: true,
  // Chromium pages are heavy; two at a time keep a laptop responsive.
  workers: Number(process.env.SCREENSHOTS_WORKERS ?? '2'),
  timeout: 10 * 60_000,
  reporter: [['list']],
  use: {
    baseURL: endpoints.webUrl,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  projects: [
    { name: 'setup', testMatch: /tests\/sessions\.setup\.ts/ },
    { name: 'screenshots', testMatch: /screenshots\/.*\.shots\.ts/, dependencies: ['setup'] },
  ],
});
