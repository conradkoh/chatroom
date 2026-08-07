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
});
