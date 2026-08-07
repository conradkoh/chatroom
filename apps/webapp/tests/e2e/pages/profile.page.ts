import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

export class ProfilePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Profile', exact: true });
  }

  get accountInformationHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Account Information' });
  }

  override async navigate(path = '/app/profile'): Promise<void> {
    await this.page.goto(path);
    await expect(this.heading).toBeVisible();
  }
}
