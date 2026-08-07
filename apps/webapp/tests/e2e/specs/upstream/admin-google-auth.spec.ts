import { expect, test } from '../../fixtures/admin.fixture';
import { AdminGoogleAuthPage } from '../../pages/admin-google-auth.page';
import { TAG_ADMIN, TAG_UPSTREAM } from '../../support/tags';

test.describe('Admin Google Auth', { tag: [TAG_ADMIN, TAG_UPSTREAM] }, () => {
  test('covers upstream flow: /app/admin/google-auth', async ({ systemAdminPage }) => {
    const googleAuthPage = new AdminGoogleAuthPage(systemAdminPage);
    await googleAuthPage.navigate();
    await expect(googleAuthPage.loadedSignal).toBeVisible();
  });
});
