import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

export class AdminDashboardPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'System Admin', level: 1 });
  }

  get systemInformationHeading(): Locator {
    return this.page.getByRole('heading', { name: 'System Information' });
  }

  override async navigate(path = '/app/system-admin'): Promise<void> {
    await this.page.goto(path);
    await expect(this.heading).toBeVisible();
  }

  /** Verifies all dashboard status cards and the system information section render. */
  async verifyReadOnlyInteractions(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.page.getByText('App Version', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Google Auth', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Your Access', { exact: true })).toBeVisible();
    await expect(this.systemInformationHeading).toBeVisible();
    await expect(this.page.getByText('Google Authentication:', { exact: true })).toBeVisible();
  }
}
