import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

export class AppDashboardPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Welcome to the App' });
  }

  get viewProfileButton(): Locator {
    return this.page.getByRole('link', { name: 'View Profile' });
  }

  override async navigate(path = '/app'): Promise<void> {
    await this.page.goto(path);
    await expect(this.heading).toBeVisible();
  }
}
