import { expect, test } from '@playwright/test';
import { mailboxMark, waitForSignInCode } from '../src/harness/index.ts';
import { accountEmail, dataset, endpoints, mainNav, pageTitle, runState, t } from './support.ts';

/**
 * The login page against the real API (ADR 0010, 0028): the code arrives by
 * "email" (the API's log, read by the stack), a wrong code is refused, the
 * right one opens the club, and signing out closes the session.
 */
test('sign in with the emailed code, refuse a wrong one, sign out', async ({ page }) => {
  const email = accountEmail('scRugby');
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(pageTitle(page, t('auth.signIn.title', { appName: t('app.name') }))).toBeVisible();

  await page.getByLabel(t('auth.email.label')).fill(email);
  const mark = await mailboxMark(endpoints.runDir);
  await page.getByRole('button', { name: t('auth.email.submit') }).click();
  await expect(page.getByText(t('auth.otp.sent', { email }))).toBeVisible();
  const code = await waitForSignInCode(endpoints.runDir, email, mark);

  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel(t('auth.otp.label')).fill(wrong);
  await page.getByRole('button', { name: t('auth.signIn'), exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(t('auth.otp.invalid'));

  await page.getByLabel(t('auth.otp.label')).fill(code);
  await page.getByRole('button', { name: t('auth.signIn'), exact: true }).click();
  await expect(pageTitle(page, t('home.title'))).toBeVisible();
  await expect(mainNav(page).getByRole('link', { name: t('nav.players') })).toBeVisible();
  if (runState().files) {
    // The club's crest, served from the bucket by the theme (ADR 0097), not a monogram.
    const crest = page.getByRole('img', {
      name: t('club.logoAlt', { clubName: dataset().club.name }),
    });
    await expect(crest).toBeVisible();
    // Loaded from the bucket's signed URL, not a broken image.
    const width = await crest.evaluate(
      (image) => (image as unknown as { naturalWidth: number }).naturalWidth,
    );
    expect(width).toBeGreaterThan(0);
  }

  // Sign-out lives in the user menu of the sidebar footer.
  await page.getByRole('button', { name: new RegExp(t('account.menu')) }).click();
  await page.getByRole('button', { name: t('auth.signOut') }).click();
  await expect(page).toHaveURL(/\/login/);
  // The session is gone: a club page sends back to the login, and the API refuses the cookie.
  await page.goto('/players');
  await expect(page).toHaveURL(/\/login/);
  const me = await page.request.get(`${endpoints.apiUrl}/v1/me`);
  expect(me.status()).toBe(401);
});
