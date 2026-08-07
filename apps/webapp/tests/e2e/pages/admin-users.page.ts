import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

export class AdminUsersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'User Roles' });
  }

  get allUsersCard(): Locator {
    return this.page.getByText('All Users', { exact: true });
  }

  get firstUserRow(): Locator {
    return this.page.locator('.rounded-lg.border.p-3').first();
  }

  get userRows(): Locator {
    return this.page.locator('.rounded-lg.border.p-3');
  }

  override async navigate(path = '/app/admin/users'): Promise<void> {
    await this.page.goto(path);
    await expect(this.heading).toBeVisible();
    await expect(this.allUsersCard).toBeVisible();
    await expect(this.firstUserRow).toBeVisible();
  }

  /**
   * Verifies every user-row role select is present and operable WITHOUT changing
   * any role: open the combobox, assert the role options are visible, then
   * Escape to close. No option is ever selected (that would fire the
   * `updateUserRoles` mutation).
   */
  async verifyReadOnlyInteractions(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.allUsersCard).toBeVisible();

    const rows = this.userRows;
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const trigger = rows.nth(i).getByRole('combobox');
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeEnabled();

      await trigger.click();
      await expect(this.page.getByRole('option', { name: 'Standard User' })).toBeVisible();
      await expect(this.page.getByRole('option', { name: 'System Administrator' })).toBeVisible();
      await this.page.keyboard.press('Escape');
      await expect(this.page.getByRole('option', { name: 'Standard User' })).toBeHidden();
    }
  }
}
