import { expect, test } from '@playwright/test';

import { TAG_AUTH, TAG_UPSTREAM } from '../../support/tags';

test.describe('App Unauthorized', { tag: [TAG_UPSTREAM, TAG_AUTH] }, () => {
  test('shows authentication required when visiting /app unauthenticated', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Authentication Required' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible();
  });
});
