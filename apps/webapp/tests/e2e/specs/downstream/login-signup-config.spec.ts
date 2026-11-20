import { expect, test } from '@playwright/test';

import { LoginPage } from '../../pages/login.page';
import { TAG_AUTH, TAG_DOWNSTREAM } from '../../support/tags';

test.describe(
  'Login signup options from backend config',
  { tag: [TAG_DOWNSTREAM, TAG_AUTH] },
  () => {
    test('shows the anonymous login button once backend signup config loads', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // CI sets E2E_SEEDING_ENABLED=true on the self-hosted backend, so the backend allows self-signup.
      // The browser must render that decision within the 15 s bound the auth fixture uses.
      await expect(loginPage.anonymousLoginButton).toBeVisible({ timeout: 15_000 });
      await expect(loginPage.signupOptionsLoading).toBeHidden();
    });
  }
);
