import type { Page } from '@playwright/test';

/**
 * Base Page Object Model providing common page interactions.
 * All page objects should extend this class.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Navigate to the given path relative to baseURL. */
  async navigate(path = '/'): Promise<void> {
    await this.page.goto(path);
  }

  /** Wait for the page to be fully loaded and ready. */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /** Get the page title from the document. */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }
}
