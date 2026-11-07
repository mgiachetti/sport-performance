/**
 * `pnpm --filter @sport-performance/mobile gallery:shots [outDir] [scene…]`:
 * serves the gallery with Vite, opens each scene in Chromium at a phone size
 * (390 × 844, device scale 2) in the dark variant and the light high-contrast
 * one, presses what the scene asks and saves a full-page PNG per scene and
 * variant in `outDir` (default `.gallery-shots/`), with an `index.html`.
 * Not a test and not run in CI; the screenshots are not committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { SCENES, type SceneSpec } from './scene-list.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const [outArg, ...only] = process.argv.slice(2);
const outDir = resolve(outArg ?? join(here, '..', '.gallery-shots'));
const VARIANTS = ['dark', 'light-hc'] as const;
const VIEWPORT = { width: 390, height: 844 };

async function press(page: Page, name: string): Promise<void> {
  const target = page
    .getByRole('radio', { name, exact: true })
    .or(page.getByRole('button', { name, exact: true }))
    .or(page.getByRole('tab', { name, exact: true }))
    .first();
  await target.click();
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const server = await createServer({
    configFile: join(here, 'vite.config.ts'),
    server: { port: Number(process.env.GALLERY_PORT ?? 4310), strictPort: true },
    logLevel: 'warn',
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://localhost:4310/';
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const scenes: readonly SceneSpec[] =
    only.length === 0 ? SCENES : SCENES.filter((scene) => only.includes(scene.name));
  const shots: string[] = [];
  try {
    for (const scene of scenes) {
      for (const variant of VARIANTS) {
        await page.goto(`${base}?scene=${scene.name}&variant=${variant}&full=1`);
        await page.waitForSelector('body[data-gallery-ready="true"]', {
          state: 'attached',
          timeout: 60_000,
        });
        await page.evaluate(() => document.fonts.ready);
        for (const name of scene.press ?? []) await press(page, name);
        // Images (the crest) and the effects that follow a press.
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(150);
        const file = `${scene.name}--${variant}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true });
        shots.push(file);
        process.stdout.write(`${file}\n`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(
    join(outDir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Galería</title><body style="background:#333;font-family:system-ui;color:#eee">${shots
      .map(
        (file) =>
          `<figure style="display:inline-block;margin:8px;vertical-align:top"><img src="${file}" width="390"><figcaption>${file}</figcaption></figure>`,
      )
      .join('')}</body>`,
  );
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
  }
}

await main();
