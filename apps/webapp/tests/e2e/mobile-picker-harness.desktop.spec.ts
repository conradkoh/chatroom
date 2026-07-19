import { expect, test, devices } from '@playwright/test';

const HARNESS_PATH = '/dev/mobile-picker-harness';

test.use({ ...devices['Desktop Chrome'] });

test('flat picker uses popover on desktop viewport', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await page.getByTestId('open-flat-picker').click();
  await expect(page.locator('[data-slot="chatroom-popover-content"]')).toBeVisible();
  await expect(page.locator('[data-slot="drawer-content"]')).toHaveCount(0);
});

test('standing instructions bar opens popover on desktop', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await page.getByTestId('open-standing-instructions-bar').click();
  await expect(page.locator('[data-slot="chatroom-popover-content"]')).toBeVisible();
  await expect(page.locator('[data-slot="drawer-content"]')).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Edit' })).toBeVisible();
  await page.getByRole('option', { name: 'Edit' }).click();
  await expect(page.getByTestId('standing-instructions-last-action')).toHaveText('edit');
});
