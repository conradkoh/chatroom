import type { Locator, Page } from '@playwright/test';

import { BasePage } from './base.page';

/**
 * Page Object Model for the Home page ("/").
 */
export class HomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** The main heading text on the home page. */
  get heading(): Locator {
    return this.page.getByText('Convex + Next Starter App');
  }

  /** The app logo/brand text in the navigation header. */
  get brandLink(): Locator {
    return this.page.getByRole('link', { name: 'Next Convex' });
  }

  /** The footer containing the app version. */
  get footer(): Locator {
    return this.page.locator('footer').filter({ hasText: 'App Version' });
  }

  /** The login button, visible when the user is not authenticated. */
  get loginButton(): Locator {
    return this.page.getByRole('link', { name: 'Login' });
  }

  /** Navigate to the home page and wait for it to load. */
  override async navigate(path = '/'): Promise<void> {
    await super.navigate(path);
    await this.waitForLoad();
  }

  /** Get the main heading text content. */
  async getHeadingText(): Promise<string> {
    return (await this.heading.textContent()) ?? '';
  }

  /** Check if the login button is visible. */
  async isLoginButtonVisible(): Promise<boolean> {
    return await this.loginButton.isVisible();
  }
}
