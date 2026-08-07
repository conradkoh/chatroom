import { test } from '../../fixtures/admin.fixture';
import { AdminDashboardPage } from '../../pages/admin-dashboard.page';
import { AdminGoogleAuthPage } from '../../pages/admin-google-auth.page';
import { AdminLayoutPage } from '../../pages/admin-layout.page';
import { AdminUsersPage } from '../../pages/admin-users.page';
import { TAG_ADMIN, TAG_UPSTREAM } from '../../support/tags';

test.describe('Admin Interactions (read-only)', { tag: [TAG_UPSTREAM, TAG_ADMIN] }, () => {
  // Iterating every user-row role select is inherently slow and the row count
  // grows as the dev DB accumulates anonymous users, so the default 30s is
  // not enough.
  test.setTimeout(120_000);

  test('verifies all admin controls exist and are interactive without mutations', async ({
    systemAdminPage,
  }) => {
    const layout = new AdminLayoutPage(systemAdminPage);
    const dashboard = new AdminDashboardPage(systemAdminPage);
    const users = new AdminUsersPage(systemAdminPage);
    const googleAuth = new AdminGoogleAuthPage(systemAdminPage);

    // Fixture lands on /app/admin
    await dashboard.verifyReadOnlyInteractions();
    await layout.verifyBackToAppLink();
    await layout.verifySidebarNavigation();

    // Deep page-specific interaction checks (sidebar nav already exercised links)
    await users.navigate();
    await users.verifyReadOnlyInteractions();

    await googleAuth.navigate();
    await googleAuth.verifyReadOnlyInteractions();
  });
});
