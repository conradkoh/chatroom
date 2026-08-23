import { expect, test } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

const HARNESS_PATH = '/dev/mermaid-harness';

test.describe('Mermaid harness', { tag: [TAG_DOWNSTREAM] }, () => {
  test('renders inline SVG via classic script loader (not pre fallback)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(HARNESS_PATH);
    await expect(page.getByTestId('mermaid-harness')).toBeVisible();

    const scroll = page.getByTestId('mermaid-inline-scroll');
    await expect(scroll).toBeVisible({ timeout: 30_000 });
    await expect(scroll.locator('svg')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('pre code')).toHaveCount(0);
    await expect(page.locator('script[data-mermaid-loader]')).toHaveCount(1);

    const mermaidErrors = consoleErrors.filter(
      (message) => message.includes('Mermaid failed') || message.toLowerCase().includes('mermaid')
    );
    expect(mermaidErrors).toEqual([]);
  });
});
