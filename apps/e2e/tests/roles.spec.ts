import { expect, test } from '@playwright/test';
import { childrenOf, userByEmail } from '../src/harness/index.ts';
import { accountEmail, dataset, mainNav, pageTitle, sessionFile, t } from './support.ts';

/**
 * Each role sees its own part of the web (CLAUDE.md, "Usuarios y roles"):
 * the decision is the API's and the permission matrix's, seen end to end.
 */
test.describe('player', () => {
  test.use({ storageState: sessionFile('rugbyPlayer') });

  test('is sent to the app and sees no club data', async ({ page }) => {
    await page.goto('/');
    await expect(pageTitle(page, t('club.staffOnly.title'))).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
    // Any club page: the same notice, no roster.
    await page.goto('/players');
    await expect(pageTitle(page, t('club.staffOnly.title'))).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

test.describe('guardian', () => {
  test.use({ storageState: sessionFile('family') });

  test('lands in the family area with their children, and nothing of the staff', async ({
    page,
  }) => {
    const guardian = userByEmail(dataset(), accountEmail('family'));
    const children = childrenOf(dataset(), guardian.id);
    expect(children.length).toBeGreaterThanOrEqual(2);

    await page.goto('/');
    await expect(page).toHaveURL(/\/family/);
    await expect(pageTitle(page, t('guardian.children.title'))).toBeVisible();
    for (const child of children) {
      await expect(
        page.getByRole('article', { name: `${child.firstName} ${child.lastName}` }),
      ).toBeVisible();
    }
    await expect(mainNav(page).getByRole('link', { name: t('nav.players') })).toHaveCount(0);
    // A staff page sends them back to the family area.
    await page.goto('/players');
    await expect(page).toHaveURL(/\/family/);
  });
});

test.describe('administration', () => {
  test.use({ storageState: sessionFile('admin') });

  test('manages the club users and sees the staff of the demo', async ({ page }) => {
    const coach = userByEmail(dataset(), accountEmail('coachRugbySenior'));
    await page.goto('/');
    await expect(mainNav(page).getByRole('link', { name: t('admin.nav') })).toBeVisible();
    await page.goto('/admin/members');
    await expect(page.getByRole('heading', { name: t('admin.members.title') })).toBeVisible();
    await page.getByLabel(t('admin.members.search')).fill(coach.name);
    await page.getByRole('button', { name: t('common.search') }).click();
    await expect(page.getByRole('table').getByText(coach.name, { exact: true })).toBeVisible();
  });
});

test.describe('coach', () => {
  test.use({ storageState: sessionFile('coachRugbySenior') });

  test('has no administration', async ({ page }) => {
    await page.goto('/');
    await expect(pageTitle(page, t('home.title'))).toBeVisible();
    await expect(mainNav(page).getByRole('link', { name: t('admin.nav') })).toHaveCount(0);
  });
});
