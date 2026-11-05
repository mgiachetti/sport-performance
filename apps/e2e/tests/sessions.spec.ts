import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { mainNav, pageTitle, sessionFile, t } from './support.ts';

/**
 * A write from the web through the API to Postgres and back (B-407): the
 * coach creates a session in one of their categories; it is there after a
 * reload and in the list of sessions.
 */
test.use({ storageState: sessionFile('coachHockeySenior') });

test('the coach creates a training session and finds it again', async ({ page }) => {
  const title = `E2E ${randomUUID().slice(0, 8)}`;
  await page.goto('/');
  await mainNav(page)
    .getByRole('link', { name: t('training.nav') })
    .click();
  await expect(pageTitle(page, t('training.list.title'))).toBeVisible();
  await page.getByRole('link', { name: t('training.list.new') }).click();
  await expect(pageTitle(page, t('training.new.title'))).toBeVisible();

  const form = page.getByRole('form', { name: t('training.new.title') });
  const category = form.getByLabel(t('training.form.category'));
  // The first category the coach manages (the placeholder is disabled).
  const firstCategory = await category
    .locator('option:not([disabled])')
    .first()
    .getAttribute('value');
  expect(firstCategory).not.toBeNull();
  await category.selectOption(firstCategory ?? '');
  await form.getByLabel(t('training.form.time')).fill('10:15');
  await form.getByLabel(t('training.form.duration')).fill('75');
  await form.getByLabel(t('training.form.title')).fill(title);
  await form.getByRole('button', { name: t('training.new.submit') }).click();

  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}/);
  await expect(pageTitle(page, title)).toBeVisible();
  await page.reload();
  await expect(pageTitle(page, title)).toBeVisible();

  await page.getByRole('link', { name: t('training.detail.back') }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});
