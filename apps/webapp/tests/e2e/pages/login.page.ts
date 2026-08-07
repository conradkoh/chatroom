import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Welcome Back' });
  }

  get enterLoginCodeLink(): Locator {
    return this.page.getByRole('link', { name: 'Enter Login Code' });
  }

  get recoveryLink(): Locator {
    return this.page.getByRole('link', { name: /lost access/i });
  }

  get anonymousLoginButton(): Locator {
    return this.page.getByRole('button', { name: /continue anonymously/i });
  }

  override async navigate(path = '/login'): Promise<void> {
    await this.page.goto(path);
    await expect(this.heading).toBeVisible();
  }

  async loginAnonymously(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.anonymousLoginButton).toBeVisible();
    await this.anonymousLoginButton.click();
    await this.page.waitForURL('**/app');
  }
}
