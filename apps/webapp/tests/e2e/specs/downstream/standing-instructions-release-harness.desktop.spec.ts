import { expect, test, devices } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

const HARNESS_PATH = '/dev/standing-instructions-release-harness';

test.use({ ...devices['Desktop Chrome'] });
test.describe('Standing instructions release harness (desktop)', { tag: [TAG_DOWNSTREAM] }, () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS_PATH);
    await expect(
      page.getByRole('heading', { name: 'Standing Instructions Release Harness' })
    ).toBeVisible();
  });
  test('click near right of standing instructions bar anchors popover near click X', async ({
    page,
  }) => {
    const bar = page.getByTestId('standing-instructions-harness-active-bar');
    await expect(bar).toBeVisible();
    await expect.poll(async () => (await bar.boundingBox())?.width ?? 0).toBeGreaterThan(0);
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
    await page.getByTestId('standing-instructions-harness-add').click();
    await expect(page.getByTestId('standing-instructions-harness-view-more')).toBeVisible();
    await expect(page.getByText('Create new')).toBeVisible();
    await page.getByTestId('standing-instructions-harness-view-more').click();
    await expect(page.getByPlaceholder('Search history…')).toBeVisible();
  });

  test('Edit mode has no history list', async ({ page }) => {
    await page.getByTestId('standing-instructions-harness-edit').click();
    await expect(page.getByPlaceholder('Enter standing instructions…')).toBeVisible();
    await expect(page.getByText('Create new')).toHaveCount(0);
  });
});
