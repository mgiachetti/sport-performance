import { defineConfig, devices } from '@playwright/test';
import { stackEndpoints } from './src/stack/config.ts';

const endpoints = stackEndpoints();
const ci = process.env.CI !== undefined && process.env.CI !== '';

/**
 * Playwright on the staff web (B-108, ADR 0096). The `setup` project opens
 * one session per demo account through the API and saves it (storage
 * state); the `web` project runs the scenarios with those sessions. The
 * stack (`src/stack/main.ts`) is started here, or reused when it is already
 * running (CI starts it once for the web and the mobile end-to-end tests).
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // Each scenario signs in with its own account and writes only rows of its own.
  fullyParallel: true,
  ...(ci && { workers: 2 }),
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: endpoints.webUrl,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'web',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node src/stack/main.ts',
    url: endpoints.webUrl,
    // A stack already running (`pnpm e2e:stack`, or the CI step) is used as it is.
    reuseExistingServer: true,
    // Migrations and the demo seed of a fresh database.
    timeout: 10 * 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // The stack stops its children (15 s at most) and then drops the run's database.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
  },
});
