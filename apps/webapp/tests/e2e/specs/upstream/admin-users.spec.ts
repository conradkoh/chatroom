import { expect, test } from '../../fixtures/admin.fixture';
import { AdminUsersPage } from '../../pages/admin-users.page';
import { TAG_ADMIN, TAG_UPSTREAM } from '../../support/tags';

test.describe('Admin Users', { tag: [TAG_UPSTREAM, TAG_ADMIN] }, () => {
  test('covers upstream flow: /app/admin/users', async ({ systemAdminPage }) => {
    const usersPage = new AdminUsersPage(systemAdminPage);
    await usersPage.navigate();
    await expect(usersPage.firstUserRow).toBeVisible();
  });
});
