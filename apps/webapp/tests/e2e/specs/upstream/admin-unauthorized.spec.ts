import { expect, test } from '../../fixtures/auth.fixture';
import { TAG_ADMIN, TAG_UPSTREAM } from '../../support/tags';

test.describe('Admin Unauthorized', { tag: [TAG_ADMIN, TAG_UPSTREAM] }, () => {
  test('covers upstream flow: /app/admin for non-admin users', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/app/admin');
    await expect(authenticatedPage.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
  });
});
