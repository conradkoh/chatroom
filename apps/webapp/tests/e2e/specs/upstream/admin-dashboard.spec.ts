import { expect, test } from '../../fixtures/admin.fixture';
import { AdminDashboardPage } from '../../pages/admin-dashboard.page';
import { TAG_ADMIN, TAG_UPSTREAM } from '../../support/tags';

test.describe('Admin Dashboard', { tag: [TAG_UPSTREAM, TAG_ADMIN] }, () => {
  test('covers upstream flow: /app/system-admin', async ({ systemAdminPage }) => {
    const adminPage = new AdminDashboardPage(systemAdminPage);
    await adminPage.navigate();
    await expect(adminPage.systemInformationHeading).toBeVisible();
  });
});
