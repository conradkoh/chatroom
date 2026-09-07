import { expect, test } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

/**
 * macOS Ctrl+Left/Right browser-history navigation.
 * Stubs the platform as macOS, then proves back/forward URL transitions
 * and that a focused editable field is not hijacked.
 */
test.describe('Mac page navigation', { tag: [TAG_DOWNSTREAM] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });
      Object.defineProperty(window.navigator, 'userAgent', {
        value:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });
    });
  });

  test('Ctrl+Left goes back and Ctrl+Right goes forward; editable field is not hijacked', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    // Home hero typewriter starts empty in SSR and types client-side,
    // so visible text proves hydration (and the keydown listener) is ready.
    await expect(page.locator('h1')).toContainText('chatroom');
    await page.goto('/login/code');
    await expect(page).toHaveURL('/login/code');

    const codeInput = page.getByLabel('Enter login code');
    await expect(codeInput).toBeVisible();
    // The code input autofocuses in a client effect, which proves hydration
    // (and the keydown listener) is ready before pressing the shortcut.
    await expect(codeInput).toBeFocused();
    // Move focus out of the input: the first shortcut must navigate, not edit.
    await page.locator('h1').click();

    await page.keyboard.press('Control+ArrowLeft');
    await expect(page).toHaveURL('/');

    // Wait for hydration again after the history navigation reloads home.
    await expect(page.locator('h1')).toContainText('chatroom');
    await page.keyboard.press('Control+ArrowRight');
    await expect(page).toHaveURL('/login/code');

    // Focused editable field must not trigger history navigation.
    await expect(codeInput).toBeVisible();
    await codeInput.focus();
    await page.keyboard.press('Control+ArrowLeft');
    await expect(page).toHaveURL('/login/code');
  });
});
