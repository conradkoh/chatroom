import { expect, test, devices } from '@playwright/test';

const HARNESS_PATH = '/dev/standing-instructions-release-harness';

test.use({ ...devices['Desktop Chrome'] });

test('click near right of standing instructions bar anchors popover near click X', async ({
  page,
}) => {
  await page.goto(HARNESS_PATH);
  const bar = page.getByTestId('standing-instructions-harness-active-bar');
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
  await page.getByTestId('standing-instructions-harness-add').click();
  await expect(page.getByText('Standing Instructions')).toBeVisible();
  await expect(page.getByText('Create new')).toBeVisible();
  await page.getByTestId('standing-instructions-harness-view-more').click();
  await expect(page.getByPlaceholder('Search history…')).toBeVisible();
});

test('Edit mode has no history list', async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await page.getByTestId('standing-instructions-harness-edit').click();
  await expect(page.getByPlaceholder('Enter standing instructions…')).toBeVisible();
  await expect(page.getByText('Create new')).toHaveCount(0);
});
