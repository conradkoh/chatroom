import { expect } from '@playwright/test';

import { test } from '../../fixtures/auth.fixture';
import { ProfilePage } from '../../pages/profile.page';
import { TAG_NAV, TAG_UPSTREAM } from '../../support/tags';

test.describe('Profile Page', { tag: [TAG_UPSTREAM, TAG_NAV] }, () => {
  test('shows profile sections when authenticated', async ({ authenticatedPage }) => {
    const profilePage = new ProfilePage(authenticatedPage);
    await profilePage.navigate();

    await expect(profilePage.heading).toBeVisible();
    await expect(profilePage.accountInformationHeading).toBeVisible();
  });
});
