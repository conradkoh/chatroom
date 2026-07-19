import { expect, test, devices } from '@playwright/test';

const HARNESS_PATH = '/dev/si-release-harness';

test.use({ ...devices['Desktop Chrome'] });

test('click near right of SI bar anchors popover near click X', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  const bar = page.getByTestId('si-harness-active-bar');
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box).toBeTruthy();
  const clickX = box!.x + box!.width * 0.9;
  await bar.click({
    position: { x: box!.width * 0.9, y: box!.height / 2 },
  });
  await expect(page.locator('[data-slot="chatroom-popover-content"]')).toBeVisible();
  const anchor = page.getByTestId('picker-pointer-anchor');
  await expect(anchor).toBeVisible();
  const anchorBox = await anchor.boundingBox();
  expect(anchorBox).toBeTruthy();
  expect(Math.abs(anchorBox!.x - clickX)).toBeLessThan(40);
});

test('Add → View more opens history picker', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await page.getByTestId('si-harness-add').click();
  await expect(page.getByText('From history')).toBeVisible();
  await page.getByTestId('si-harness-view-more').click();
  await expect(page.getByPlaceholder('Search history…')).toBeVisible();
});

test('Edit mode has no history list', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await page.getByTestId('si-harness-edit').click();
  await expect(page.getByPlaceholder('Enter standing instructions…')).toBeVisible();
  await expect(page.getByText('From history')).toHaveCount(0);
});
