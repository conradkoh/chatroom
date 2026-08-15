import { expect, test, devices } from '@playwright/test';
import { TAG_DOWNSTREAM } from '../../support/tags';

const HARNESS_PATH = '/dev/mobile-picker-harness';

test.use({ ...devices['Desktop Chrome'] });
test.describe('Mobile picker harness (desktop)', { tag: [TAG_DOWNSTREAM] }, () => {

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

test('nested fixed modal opens picker popover inside modal', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await page.getByTestId('open-nested-modal').click();
  await expect(page.locator('[data-slot="fixed-modal-content"]')).toBeVisible();
  await page.getByTestId('open-nested-picker').click();
  await expect(page.locator('[data-slot="chatroom-popover-content"]')).toBeVisible();
});

test('escape closes nested picker before modal', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await page.getByTestId('open-nested-modal').click();
  await page.getByTestId('open-nested-picker').click();
  await expect(page.locator('[data-slot="chatroom-popover-content"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="chatroom-popover-content"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="fixed-modal-content"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="fixed-modal-content"]')).toHaveCount(0);
});
});
