import { expect, test } from '@playwright/test';

import { HomePage } from '../../pages/home.page';
import { TAG_NAV, TAG_UPSTREAM } from '../../support/tags';
import { UPSTREAM_FLOWS } from '../../support/upstream-flows';

test.describe('Home Page', { tag: [TAG_UPSTREAM, TAG_NAV] }, () => {
  test(`covers upstream flow: ${UPSTREAM_FLOWS.home.path}`, async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    const title = await homePage.getTitle();
    expect(title).toBe('Next Convex App');

    await expect(homePage.brandLink).toBeVisible();
    await expect(homePage.brandLink).toHaveText('Next Convex');

    await expect(homePage.heading).toBeVisible();
    const headingText = await homePage.getHeadingText();
    expect(headingText).toContain('Convex + Next Starter App');

    await expect(homePage.footer).toBeVisible();
    const footerText = (await homePage.footer.textContent()) ?? '';
    expect(footerText).toMatch(/App Version:/);
  });
});
