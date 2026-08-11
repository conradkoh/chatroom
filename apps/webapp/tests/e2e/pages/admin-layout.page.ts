import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

/**
 * Page object for the shared system-admin layout (sidebar + header).
 * The layout wraps every /app/system-admin page, so nav/back-link assertions live here.
 */
export class AdminLayoutPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * The desktop sidebar "Back to App" link. The mobile header renders a second
   * Back link, so filter to the visible one to avoid a strict-mode duplicate.
   */
  get backToAppLink(): Locator {
    return this.page.getByRole('link', { name: /Back to App/i }).filter({ visible: true });
  }

  get dashboardNavLink(): Locator {
    return this.page.getByRole('link', { name: 'Dashboard' });
  }

  get userRolesNavLink(): Locator {
    return this.page.getByRole('link', { name: 'User Roles' });
  }

  get googleAuthNavLink(): Locator {
    return this.page.getByRole('link', { name: 'Google Auth Config' });
  }

  async verifyBackToAppLink(): Promise<void> {
    await expect(this.backToAppLink).toBeVisible();
    await expect(this.backToAppLink).toHaveAttribute('href', '/app');
  }

  async verifySidebarNavigation(): Promise<void> {
    await expect(this.dashboardNavLink).toBeVisible();
    await expect(this.googleAuthNavLink).toBeVisible();
    await expect(this.userRolesNavLink).toBeHidden();

    await this.googleAuthNavLink.click();
    await expect(
      this.page.getByText('Google Authentication Control', { exact: true })
    ).toBeVisible();

    await this.dashboardNavLink.click();
    await expect(this.page.getByRole('heading', { name: 'System Admin', level: 1 })).toBeVisible();
  }
}
