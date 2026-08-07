import { test as base, expect, type Page } from '@playwright/test';

import { AppDashboardPage } from '../pages/app-dashboard.page';
import { LoginPage } from '../pages/login.page';

type AuthFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await loginAnonymously(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use` is not a React hook
    await use(page);
  },
});

export { expect } from '@playwright/test';

export async function loginAnonymously(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.loginAnonymously();
  const dashboard = new AppDashboardPage(page);
  await expect(dashboard.heading).toBeVisible();
}
