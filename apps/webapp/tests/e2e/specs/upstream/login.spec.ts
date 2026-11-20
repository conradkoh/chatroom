import { expect, test } from '@playwright/test';

import { LoginPage } from '../../pages/login.page';
import { TAG_AUTH, TAG_UPSTREAM } from '../../support/tags';

test.describe('Login Page', { tag: [TAG_UPSTREAM, TAG_AUTH] }, () => {
  test('displays login options for unauthenticated users', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await expect(loginPage.heading).toBeVisible();
    await expect(loginPage.enterLoginCodeLink).toBeVisible();
    await expect(loginPage.recoveryLink).toBeVisible();
    await expect(loginPage.anonymousLoginButton).toBeVisible();
  });

  test('shows the anonymous login button once backend signup config loads', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    // Backend decides self-signup (E2E_SEEDING_ENABLED=true in CI). The browser must render that
    // decision, so the button appears within the same 15 s bound the auth fixture uses.
    await expect(loginPage.anonymousLoginButton).toBeVisible({ timeout: 15_000 });
    await expect(loginPage.signupOptionsLoading).toBeHidden();
  });
});
