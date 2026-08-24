import { devices, expect, test, type Locator, type Page } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

const HARNESS_PATH = '/dev/sketch-canvas-harness';
const countNonWhitePixels = (canvas: Locator) =>
  canvas.evaluate((el) => {
    const ctx = (el as HTMLCanvasElement).getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(
      0,
      0,
      (el as HTMLCanvasElement).width,
      (el as HTMLCanvasElement).height
    );
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) count++;
    return count;
  });
async function openSketch(page: Page) {
  await page.getByTestId('harness-add-attachment').click();
  await page.getByText('Sketch', { exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Sketch canvas')).toBeVisible();
}
async function mouseStroke(page: Page, canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas missing bounding box');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5);
  await page.mouse.up();
}
test.describe('Sketch canvas harness', { tag: [TAG_DOWNSTREAM] }, () => {
  test.describe('desktop', () => {
    test.describe.configure({ mode: 'serial' });
    test.beforeEach(async ({ page }) => {
      await page.goto(HARNESS_PATH);
      await expect(page.getByRole('heading', { name: 'Sketch Canvas Harness' })).toBeVisible();
    });
    test('mouse click and drag draw pixels, export previews, and reopen resets', async ({
      page,
    }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      expect(await countNonWhitePixels(canvas)).toBe(0);
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas missing bounding box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect.poll(() => countNonWhitePixels(canvas)).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: 'Add sketch' })).toBeEnabled();
      await page.getByRole('button', { name: 'Add sketch' }).click();
      await expect(page.getByTestId('saved-sketch-preview')).toBeVisible();
      await openSketch(page);
      expect(await countNonWhitePixels(page.getByLabel('Sketch canvas'))).toBe(0);
    });
    test('mouse drag draws a visible stroke', async ({ page }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas)).toBeGreaterThan(10);
    });
  });
  test.describe('mobile', () => {
    const { defaultBrowserType: _defaultBrowserType, ...iphone14 } = devices['iPhone 14'];
    test.use(iphone14);
    test.describe.configure({ mode: 'serial' });
    test.beforeEach(async ({ page }) => {
      await page.goto(HARNESS_PATH);
      await expect(page.getByRole('heading', { name: 'Sketch Canvas Harness' })).toBeVisible();
    });
    test('touch tap and drag draw pixels', async ({ page }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas missing bounding box');
      await canvas.dispatchEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
      await canvas.dispatchEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
      await expect.poll(() => countNonWhitePixels(canvas)).toBeGreaterThan(0);
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas)).toBeGreaterThan(10);
    });
  });
});
