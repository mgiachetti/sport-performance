import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { DEMO_ACCOUNTS, type DemoAccount } from '../src/harness/index.ts';
import { endpoints, sessionFile, t } from '../tests/support.ts';

/**
 * Screenshots of every screen a demo account reaches (ADR 0097), for design
 * reviews: not a test, nothing is asserted. `pnpm --filter
 * @sport-performance/e2e screenshots` against a running stack signs in every
 * account (the `setup` sessions), walks the sidebar and, from each section,
 * the first detail page of each kind (`/players/:id`), and saves full-page
 * captures at 1440 and 390 px, dark and light high-contrast, under
 * `<run dir>/screenshots/<width>-<variant>/`; `index.ts` then writes
 * `index.json`, `index.txt` and a contact sheet `index.html`. Never committed:
 * the run directory is ignored.
 */

const WIDTHS = [1440, 390] as const;
const VARIANTS = ['dark', 'light-hc'] as const;
/** Pages per account and viewport: the sidebar sections and a few details. */
const MAX_PAGES = Number(process.env.SCREENSHOTS_MAX_PAGES ?? '40');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const OUT_DIR = join(endpoints.runDir, 'screenshots');

export interface Shot {
  readonly account: DemoAccount;
  readonly width: number;
  readonly variant: (typeof VARIANTS)[number];
  readonly route: string;
  readonly url: string;
  readonly file: string;
}

/** `/players/3f…?tab=x` → `/players/:id`: one capture per kind of page. */
function routeOf(href: string): string {
  const url = new URL(href, endpoints.webUrl);
  return url.pathname.replace(UUID, ':id');
}

function slug(route: string): string {
  const s = route
    .replace(/[^a-z0-9:]+/gi, '_')
    .replace(/:/g, '')
    .replace(/^_|_$/g, '');
  return s === '' ? 'home' : s.slice(0, 60);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  // Fonts and the charts' measured width.
  await page.evaluate('document.fonts.ready.then(() => true)');
  await page.waitForTimeout(400);
}

async function sameOriginLinks(page: Page, selector: string): Promise<string[]> {
  // Hrefs as written (`/players/…`), not resolved; strings: this package has no DOM types.
  const hrefs: string[] = [];
  for (const link of await page.locator(selector).all()) {
    hrefs.push((await link.getAttribute('href')) ?? '');
  }
  return hrefs.filter((href) => href.startsWith('/') && !href.startsWith('//'));
}

test.describe.configure({ mode: 'parallel' });

for (const account of Object.keys(DEMO_ACCOUNTS) as DemoAccount[]) {
  for (const width of WIDTHS) {
    for (const variant of VARIANTS) {
      test(`${account} at ${String(width)} px, ${variant}`, async ({ browser }) => {
        test.setTimeout(10 * 60_000);
        const dir = join(OUT_DIR, `${String(width)}-${variant}`);
        mkdirSync(dir, { recursive: true });
        const context = await browser.newContext({
          storageState: sessionFile(account),
          viewport: { width, height: width < 600 ? 844 : 900 },
          deviceScaleFactor: 1,
          locale: 'es-AR',
          timezoneId: 'America/Argentina/Buenos_Aires',
          reducedMotion: 'reduce',
        });
        // The web remembers the variant per browser (`sp.web.theme`).
        await context.addInitScript({
          content: `window.localStorage.setItem('sp.web.theme', ${JSON.stringify(JSON.stringify(variant))});`,
        });
        const page = await context.newPage();
        const shots: Shot[] = [];
        const seen = new Set<string>();
        const queue: string[] = ['/'];
        await page.goto('/');
        await settle(page);
        // The sidebar is a drawer on narrow screens: its links are in the DOM anyway.
        queue.push(...(await sameOriginLinks(page, `nav[aria-label="${t('nav.label')}"] a`)));
        let count = 0;
        while (queue.length > 0 && count < MAX_PAGES) {
          const href = queue.shift() ?? '/';
          const route = routeOf(href);
          if (seen.has(route)) continue;
          seen.add(route);
          try {
            await page.goto(href);
            await settle(page);
          } catch {
            continue;
          }
          const file = join(dir, `${account}-${String(count).padStart(2, '0')}-${slug(route)}.png`);
          await page.screenshot({ path: file, fullPage: true });
          shots.push({ account, width, variant, route, url: page.url(), file });
          count += 1;
          // One level of detail pages: the first links inside the page's content.
          if (!route.includes(':id')) {
            queue.push(...(await sameOriginLinks(page, 'main a')).slice(0, 8));
          }
        }
        await context.close();
        // One part per account and viewport; `index.ts` merges them after the run.
        mkdirSync(join(OUT_DIR, 'parts'), { recursive: true });
        writeFileSync(
          join(OUT_DIR, 'parts', `${account}-${String(width)}-${variant}.json`),
          `${JSON.stringify(shots, null, 2)}\n`,
        );
      });
    }
  }
}
