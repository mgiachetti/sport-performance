#!/usr/bin/env node
/**
 * `pnpm screenshots [playwright args]`: runs the capture with the arguments given (`--grep`
 * picks the accounts and views) and then writes the index (`index.ts`), so the arguments reach
 * Playwright and not the index step.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// pnpm may forward a leading `--` separator: Playwright does not need it.
const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));

const capture = spawnSync(
  'playwright',
  ['test', '--config', join(here, 'playwright.config.ts'), ...args],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (capture.status !== 0) process.exit(capture.status ?? 1);

const index = spawnSync(process.execPath, [join(here, 'index.ts')], { stdio: 'inherit' });
process.exit(index.status ?? 1);
