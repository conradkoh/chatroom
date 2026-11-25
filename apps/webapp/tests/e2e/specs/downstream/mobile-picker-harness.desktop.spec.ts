import { expect, test, devices, type Locator, type Page } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

const HARNESS_PATH = '/dev/mobile-picker-harness';

/**
 * Popover and modal surfaces animate in (zoom/fade). Interacting while the surface is still
 * moving is the race the mobile harness covers for drawers, so settle every running animation in
 * its subtree before the test interacts with it.
 */
async function waitForOverlaySettled(surface: Locator): Promise<void> {
  await expect(surface).toBeVisible();
  await expect
    .poll(() =>
      surface.evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running').length
      )
    )
    .toBe(0);
}

/** Opens a harness picker trigger and waits for its popover to finish animating in. */
async function openHarnessPopover(page: Page, triggerTestId: string): Promise<void> {
  await page.getByTestId(triggerTestId).click();
  await waitForOverlaySettled(page.locator('[data-slot="popover-content"]'));
}

/** ResponsivePickerShell renders trigger-only until client hydration. */
async function waitForHarnessDesktopPickersHydrated(page: Page): Promise<void> {
  await expect(
    page.locator('[data-testid="open-flat-picker"][data-slot="popover-trigger"]')
  ).toBeAttached();
  await expect(
    page.locator('[data-testid="open-standing-instructions-bar"][data-slot="popover-trigger"]')
  ).toBeAttached();
}

test.use({ ...devices['Desktop Chrome'] });
test.describe('Mobile picker harness (desktop)', { tag: [TAG_DOWNSTREAM] }, () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS_PATH);
    await expect(page.getByRole('heading', { name: 'Mobile Picker Harness' })).toBeVisible();
    await waitForHarnessDesktopPickersHydrated(page);
  });
  test('flat picker uses popover on desktop viewport', async ({ page }) => {
    await openHarnessPopover(page, 'open-flat-picker');
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    await expect(page.locator('[data-slot="drawer-content"]')).toHaveCount(0);
  });

  test('standing instructions bar opens popover on desktop', async ({ page }) => {
    await openHarnessPopover(page, 'open-standing-instructions-bar');
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    await expect(page.locator('[data-slot="drawer-content"]')).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Edit' })).toBeVisible();
    await page.getByRole('option', { name: 'Edit' }).click();
    await expect(page.getByTestId('standing-instructions-last-action')).toHaveText('edit');
  });

  test('nested fixed modal opens picker popover inside modal', async ({ page }) => {
    await page.getByTestId('open-nested-modal').click();
    await waitForOverlaySettled(page.locator('[data-slot="fixed-modal-content"]'));
    await openHarnessPopover(page, 'open-nested-picker');
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
  });

  test('escape closes nested picker before modal', async ({ page }) => {
    await page.getByTestId('open-nested-modal').click();
    await waitForOverlaySettled(page.locator('[data-slot="fixed-modal-content"]'));
    await openHarnessPopover(page, 'open-nested-picker');
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="fixed-modal-content"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="fixed-modal-content"]')).toHaveCount(0);
  });
});
