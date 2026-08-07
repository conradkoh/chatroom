import { expect } from '@playwright/test';

import { test } from '../../fixtures/auth.fixture';
import { AppDashboardPage } from '../../pages/app-dashboard.page';
import { TAG_NAV, TAG_UPSTREAM } from '../../support/tags';

test.describe('App Dashboard', { tag: [TAG_UPSTREAM, TAG_NAV] }, () => {
  test('shows dashboard content when authenticated', async ({ authenticatedPage }) => {
    const dashboard = new AppDashboardPage(authenticatedPage);
    await expect(dashboard.heading).toBeVisible();
    await expect(dashboard.viewProfileButton).toBeVisible();
  });
});
