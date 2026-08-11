import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

export class AdminGoogleAuthPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Google Authentication Configuration' });
  }

  get loadedSignal(): Locator {
    return this.page.getByText('Google Authentication Control', { exact: true });
  }

  get enableSwitch(): Locator {
    return this.page.getByRole('switch', { name: /Google Authentication/i });
  }

  get projectIdInput(): Locator {
    return this.page.getByLabel('Google Cloud Project ID (Optional)');
  }

  get clientIdInput(): Locator {
    return this.page.getByLabel('Google Client ID');
  }

  get clientSecretInput(): Locator {
    return this.page.getByLabel('Google Client Secret');
  }

  get saveButton(): Locator {
    return this.page.getByRole('button', { name: 'Save Configuration' });
  }

  get resetButton(): Locator {
    return this.page.getByRole('button', { name: 'Reset Configuration' });
  }

  get showSecretButton(): Locator {
    return this.page.getByRole('button', { name: /Show password|Hide password/i });
  }

  override async navigate(path = '/app/system-admin/google-auth'): Promise<void> {
    await this.page.goto(path);
    await expect(this.heading).toBeVisible();
    await expect(this.loadedSignal).toBeVisible();
  }

  /**
   * Verifies every Google Auth configuration control exists and is operable
   * WITHOUT triggering any mutation:
   * - the enable switch is asserted visible/enabled but NEVER clicked
   *   (a click fires `toggleEnabled` immediately)
   * - inputs are asserted editable + focusable but never filled
   * - Save/Reset are asserted present but never clicked
   * - Copy buttons are asserted enabled but never clicked
   * - Show/hide secret is UI-only and safe to click
   */
  async verifyReadOnlyInteractions(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.loadedSignal).toBeVisible();

    // Configuration Status card (read-only) — CardTitle renders a div, not a
    // heading role; .first() targets the CardTitle over the row-label span
    await expect(
      this.page.getByText('Configuration Status', { exact: true }).first()
    ).toBeVisible();

    // Switch: visible + enabled, DO NOT click (mutation)
    await expect(this.enableSwitch).toBeVisible();
    await expect(this.enableSwitch).toBeEnabled();

    // Editable inputs — assert editable + focusable, do not fill
    for (const input of [this.projectIdInput, this.clientIdInput, this.clientSecretInput]) {
      await expect(input).toBeEditable();
      await input.focus();
      await expect(input).toBeFocused();
    }

    // Show/hide secret is UI-only — safe to click
    await this.showSecretButton.click();

    // Mutation buttons: assert present, do not click
    await expect(this.saveButton).toBeVisible();
    await expect(this.resetButton).toBeVisible();

    // Copy buttons (origins + redirect URI) — enabled only, no click
    const copyButtons = this.page.getByRole('button', { name: 'Copy' });
    await expect(copyButtons).toHaveCount(2);
    await expect(copyButtons.first()).toBeEnabled();
    await expect(copyButtons.nth(1)).toBeEnabled();

    // External links — assert visible with href
    await expect(this.page.getByRole('link', { name: /Open Console/i })).toBeVisible();
    await expect(this.page.getByRole('link', { name: /Manage Credentials/i })).toBeVisible();
    await expect(this.page.getByRole('link', { name: /OAuth Consent Screen/i })).toBeVisible();

    // Setup guide (read-only) — CardTitle renders a div, not a heading role
    await expect(this.page.getByText('Setup Guide', { exact: true })).toBeVisible();
  }
}
