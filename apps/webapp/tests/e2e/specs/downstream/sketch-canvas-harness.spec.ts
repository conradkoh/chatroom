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
  const trigger = page.getByTestId('harness-add-attachment');
  const sketchOption = page.getByRole('option', { name: 'Sketch', exact: true });
  await expect(async () => {
    await trigger.click();
    await expect(sketchOption).toBeVisible();
  }).toPass();
  await sketchOption.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Sketch canvas')).toBeVisible();
  await waitForCanvasReady(page.getByLabel('Sketch canvas'));
}
async function mouseStroke(page: Page, canvas: Locator) {
  await waitForCanvasReady(canvas);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas missing bounding box');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 15 });
  await page.mouse.up();
}
async function waitForCanvasReady(canvas: Locator) {
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? box.width * box.height : 0;
    })
    .toBeGreaterThan(0);
}
const countColorPixels = (canvas: Locator, color: 'red' | 'blue') =>
  canvas.evaluate((el, wanted) => {
    const ctx = (el as HTMLCanvasElement).getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(
      0,
      0,
      (el as HTMLCanvasElement).width,
      (el as HTMLCanvasElement).height
    );
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const match = wanted === 'red' ? r > 200 && g < 60 && b < 60 : b > 200 && r < 60 && g < 60;
      if (match && data[i + 3] > 0) count++;
    }
    return count;
  }, color);
const countRedPixels = (canvas: Locator) => countColorPixels(canvas, 'red');
const countBluePixels = (canvas: Locator) => countColorPixels(canvas, 'blue');
const countWhitePixels = (canvas: Locator) =>
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
      if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255)
        count++;
    return count;
  });
const countOpaqueOverlayPixels = (canvas: Locator) =>
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
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  });
async function writePngToClipboard(page: Page, color: string, size = 120) {
  await page.evaluate(
    async ({ fill, width }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = width;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('missing 2d context');
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('toBlob failed'))),
          'image/png'
        )
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    },
    { fill: color, width: size }
  );
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
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(0);
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
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
    });
    test('desktop dialog fills near-viewport workspace with properties panel and drawable canvas', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openSketch(page);
      const dialog = page.getByRole('dialog');
      await expect
        .poll(async () => (await dialog.boundingBox())?.width ?? 0)
        .toBeGreaterThan(1440 * 0.95);
      await expect
        .poll(async () => (await dialog.boundingBox())?.height ?? 0)
        .toBeGreaterThan(900 * 0.95);
      await expect(page.getByRole('group', { name: 'Color' })).toBeVisible();
      await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Brush tool' })).toBeVisible();
      await expect(page.getByLabel('Sketch canvas')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add sketch' })).toBeVisible();
      await mouseStroke(page, page.getByLabel('Sketch canvas'));
      await expect
        .poll(() => countNonWhitePixels(page.getByLabel('Sketch canvas')), { timeout: 5000 })
        .toBeGreaterThan(10);
    });
    test('rectangular selection delete clears pixels inside marquee', async ({ page }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
      const before = await countNonWhitePixels(canvas);
      expect(before).toBeGreaterThan(10);
      await page.getByRole('button', { name: 'Select tool' }).click();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas missing bounding box');
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 10 });
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Delete selection' })).toBeEnabled();
      await page.getByRole('button', { name: 'Delete selection' }).click();
      const after = await countNonWhitePixels(canvas);
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(0);
      await expect(page.getByTestId('sketch-selection-overlay')).toBeVisible();
    });
    test('deleting all painted pixels disables Add sketch', async ({ page }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
      await page.getByRole('button', { name: 'Select tool' }).click();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas missing bounding box');
      await page.mouse.move(box.x + 4, box.y + 4);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 10 });
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Delete selection' })).toBeEnabled();
      await page.getByRole('button', { name: 'Delete selection' }).click();
      await expect(page.getByRole('button', { name: 'Add sketch' })).toBeDisabled();
    });
    test('Cmd+A selects entire canvas and confirmed delete clears sketch', async ({ page }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
      await page.getByRole('button', { name: 'Select tool' }).click();
      await page.keyboard.press('Meta+a');
      await expect(page.getByText('Entire canvas selected.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete selection' })).toBeEnabled();
      await page.getByRole('button', { name: 'Delete selection' }).click();
      await expect(page.getByRole('button', { name: 'Add sketch' })).toBeDisabled();
    });
    test('discard confirm is clickable and closes the sketch', async ({ page }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('button', { name: 'Discard sketch' })).toBeVisible();
      // No `force: true` — the click must actually reach the confirm button. Before the
      // fix, the confirm lives in a `pointer-events-none` portal host, so this is click-through.
      await page.getByRole('button', { name: 'Discard sketch' }).click();
      await expect(canvas).toBeHidden();
    });
    test('keep editing dismisses the confirm and keeps the sketch open', async ({ page }) => {
      await openSketch(page);
      const canvas = page.getByLabel('Sketch canvas');
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('button', { name: 'Keep editing' })).toBeVisible();
      await page.getByRole('button', { name: 'Keep editing' }).click();
      await expect(page.getByRole('button', { name: 'Discard sketch' })).toBeHidden();
      await expect(canvas).toBeVisible();
    });
    test.describe('clipboard paste', () => {
      test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
      test('pasting an image after drawing adds a layer with pixels', async ({ page }) => {
        await openSketch(page);
        const canvas = page.getByLabel('Sketch canvas');
        await mouseStroke(page, canvas);
        await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
        // Drawing a stroke moves focus off the tool rail onto the dialog popup. The paste
        // event dispatches at document.activeElement, so a handler on a descendant never fires.
        expect(await countRedPixels(canvas)).toBe(0);
        await writePngToClipboard(page, '#ff0000');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(page.getByText(/Pasted image 1/)).toBeVisible();
        await expect.poll(() => countRedPixels(canvas), { timeout: 5000 }).toBeGreaterThan(0);
      });
      test('pasting a second image commits the first pending paste', async ({ page }) => {
        await openSketch(page);
        const canvas = page.getByLabel('Sketch canvas');
        await mouseStroke(page, canvas);
        await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
        // First paste stays floating (not yet applied).
        await writePngToClipboard(page, '#ff0000', 160);
        await page.keyboard.press('ControlOrMeta+V');
        await expect(page.getByText(/Pasted image 1/)).toBeVisible();
        await expect.poll(() => countRedPixels(canvas), { timeout: 5000 }).toBeGreaterThan(0);
        // A second paste arrives while the first is still floating. The first must be
        // committed rather than silently dropped, so both survive. The blue image is
        // smaller, so the red border remains visible around it.
        await writePngToClipboard(page, '#0000ff', 80);
        await page.keyboard.press('ControlOrMeta+V');
        await expect(page.getByText(/Pasted image 2/)).toBeVisible();
        await page.getByRole('button', { name: 'Apply' }).click();
        await expect.poll(() => countRedPixels(canvas), { timeout: 5000 }).toBeGreaterThan(0);
        expect(await countBluePixels(canvas)).toBeGreaterThan(0);
      });
      test('applying a pasted image clears the transform overlay', async ({ page }) => {
        await openSketch(page);
        const canvas = page.getByLabel('Sketch canvas');
        await mouseStroke(page, canvas);
        await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
        await writePngToClipboard(page, '#ff0000');
        await page.keyboard.press('ControlOrMeta+V');
        await expect(page.getByText(/Pasted image 1/)).toBeVisible();
        const overlay = page.getByTestId('sketch-selection-overlay');
        await expect
          .poll(() => countOpaqueOverlayPixels(overlay), { timeout: 5000 })
          .toBeGreaterThan(0);
        await page.getByRole('button', { name: 'Apply' }).click();
        // The transform handles must be removed once the paste is committed; otherwise
        // stale handles linger on the overlay canvas.
        await expect.poll(() => countOpaqueOverlayPixels(overlay), { timeout: 5000 }).toBe(0);
      });
      test('eraser shows a live preview while dragging', async ({ page }) => {
        await openSketch(page);
        const canvas = page.getByLabel('Sketch canvas');
        await mouseStroke(page, canvas);
        await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
        const whiteBefore = await countWhitePixels(canvas);
        await page.getByRole('button', { name: 'Eraser tool' }).click();
        const box = await canvas.boundingBox();
        if (!box) throw new Error('canvas missing bounding box');
        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 20 });
        // The pointer is still down: erased pixels must already be visible, not only after
        // pointerup commits the eraser stroke.
        await expect
          .poll(() => countWhitePixels(canvas), { timeout: 5000 })
          .toBeGreaterThan(whiteBefore);
        await page.mouse.up();
      });
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
      await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
      const canvas = page.getByLabel('Sketch canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas missing bounding box');
      await canvas.dispatchEvent('pointerdown', {
        bubbles: true,
        pointerId: 9,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      });
      await canvas.dispatchEvent('pointerup', {
        bubbles: true,
        pointerId: 9,
        pointerType: 'touch',
        isPrimary: true,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      });
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(0);
      await mouseStroke(page, canvas);
      await expect.poll(() => countNonWhitePixels(canvas), { timeout: 5000 }).toBeGreaterThan(10);
    });
  });
});
