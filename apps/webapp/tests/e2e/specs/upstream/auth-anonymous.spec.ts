import { expect, test } from '@playwright/test';

import { AppDashboardPage } from '../../pages/app-dashboard.page';
import { LoginPage } from '../../pages/login.page';
import { TAG_AUTH, TAG_UPSTREAM } from '../../support/tags';

test.describe('Anonymous Authentication', { tag: [TAG_UPSTREAM, TAG_AUTH] }, () => {
  test('anonymous login navigates to app dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginAnonymously();

    const dashboard = new AppDashboardPage(page);
    await expect(dashboard.heading).toBeVisible();
    expect(page.url()).toContain('/app');
  });
});
