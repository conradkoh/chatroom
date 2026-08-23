import { expect, test, devices, type Page } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

const HARNESS_PATH = '/dev/mobile-picker-harness';

/** Playwright fill() does not reliably fire React onChange on controlled range inputs. */
async function setHarnessKeyboardInset(page: Page, insetPx: number): Promise<void> {
  await expect(page.getByTestId('keyboard-controls')).toBeVisible();
  const slider = page.getByTestId('keyboard-inset-slider');
  await slider.evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, insetPx);
  await expect
    .poll(async () => page.getByText(`Keyboard inset: ${insetPx}px`).isVisible())
    .toBe(true);
}

/** ResponsivePickerShell renders trigger-only until client hydration; clicks are no-ops before then. */
async function waitForHarnessMobilePickersHydrated(page: Page): Promise<void> {
  await expect(
    page.locator('[data-testid="open-flat-picker"][data-slot="drawer-trigger"]')
  ).toBeAttached();
  await expect(
    page.locator('[data-testid="open-filter-picker"][data-slot="drawer-trigger"]')
  ).toBeAttached();
  await expect(
    page.locator('[data-testid="open-standing-instructions-bar"][data-slot="drawer-trigger"]')
  ).toBeAttached();
}

test.use({ ...devices['iPhone 14'] });
test.describe('Mobile picker harness', { tag: [TAG_DOWNSTREAM] }, () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS_PATH);
    await expect(page.getByRole('heading', { name: 'Mobile Picker Harness' })).toBeVisible();
    await expect(page.getByTestId('keyboard-controls')).toBeVisible();
    await waitForHarnessMobilePickersHydrated(page);
  });

  test('flat picker opens drawer on mobile viewport', async ({ page }) => {
    await page.getByTestId('open-flat-picker').click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
    await expect(page.locator('[data-slot="chatroom-popover-content"]')).toHaveCount(0);
  });

  test('search input is focusable by click in drawer on mobile', async ({ page }) => {
    await page.getByTestId('open-flat-picker').click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
    const searchInput = page.getByPlaceholder('Search models…');
    await searchInput.click();
    await expect(searchInput).toBeFocused();
    await searchInput.fill('test');
    await expect(searchInput).toHaveValue('test');
  });

  test('drawer applies safe-area inline padding when keyboard closed', async ({ page }) => {
    await page.getByTestId('open-flat-picker').click();
    const drawer = page.locator('[data-slot="drawer-content"]');
    await expect(drawer).toBeVisible();

    const style = await drawer.evaluate((el) => ({
      paddingLeft: el.style.paddingLeft,
      paddingRight: el.style.paddingRight,
      paddingBottom: el.style.paddingBottom,
      maxHeight: el.style.maxHeight,
    }));

    expect(style.paddingLeft).toContain('safe-area-inset-left');
    expect(style.paddingRight).toContain('safe-area-inset-right');
    expect(style.paddingBottom).toContain('safe-area-inset-bottom');
    expect(style.maxHeight).toBe('');
  });

  test('last option is horizontally inside drawer bounds when keyboard closed', async ({
    page,
  }) => {
    await page.getByTestId('open-flat-picker').click();
    await expect(page.getByTestId('picker-last-option')).toBeVisible();

    const visible = await page.evaluate(() => {
      const drawer = document.querySelector('[data-slot="drawer-content"]') as HTMLElement | null;
      const last = document.querySelector(
        '[data-testid="picker-last-option"]'
      ) as HTMLElement | null;
      if (!drawer || !last) return false;
      const d = drawer.getBoundingClientRect();
      const l = last.getBoundingClientRect();
      return l.left >= d.left - 1 && l.right <= d.right + 1;
    });

    expect(visible).toBe(true);
  });

  test('simulated keyboard inset sets maxHeight and keeps scroll body usable', async ({ page }) => {
    await setHarnessKeyboardInset(page, 300);
    await page.getByTestId('open-flat-picker').click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();

    const drawer = page.locator('[data-slot="drawer-content"]');
    const popup = page.locator('[data-slot="drawer-popup"]');
    await expect.poll(async () => popup.evaluate((el) => el.style.top)).not.toBe('');
    await expect.poll(async () => popup.evaluate((el) => el.style.bottom)).toBe('auto');
    await expect.poll(async () => popup.evaluate((el) => el.style.maxHeight)).toContain('300px');
    const style = await drawer.evaluate((el) => ({
      paddingBottom: el.style.paddingBottom,
    }));

    expect(style.paddingBottom).toContain('safe-area-inset-bottom');

    await expect
      .poll(async () =>
        drawer.evaluate((el) => {
          const body = el.querySelector('[data-picker-scroll-body]') as HTMLElement | null;
          return body?.clientHeight ?? 0;
        })
      )
      .toBeGreaterThan(0);

    const scrollMetrics = await drawer.evaluate((el) => {
      const body = el.querySelector('[data-picker-scroll-body]') as HTMLElement | null;
      return {
        clientHeight: body?.clientHeight ?? 0,
        scrollHeight: body?.scrollHeight ?? 0,
      };
    });
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

    await page.getByPlaceholder('Search models…').focus();
    await page.getByTestId('drawer-metrics').waitFor();

    const metricsText = await page.getByTestId('drawer-metrics').textContent();
    expect(metricsText).toContain('"scrollBodyScrollHeight"');
  });

  test('nested FixedModal picker search focuses after tap', async ({ page }) => {
    await page.getByTestId('open-nested-modal').click();
    await page.getByTestId('open-nested-picker').click();
    const search = page.getByPlaceholder('Search harnesses…');
    await search.click();
    await expect(search).toBeFocused();
    await search.fill('Claude');
    await expect(search).toHaveValue('Claude');
  });

  test('standing instructions bar opens drawer on mobile', async ({ page }) => {
    await page.getByTestId('open-standing-instructions-bar').click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
    await expect(page.locator('[data-slot="chatroom-popover-content"]')).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Edit' })).toBeVisible();
  });

  test('filter panel picker uses scroll body inside drawer', async ({ page }) => {
    await page.getByTestId('open-filter-picker').click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
    await expect(page.locator('[data-picker-scroll-body]')).toBeVisible();
    await expect(page.getByText('Reset All')).toBeVisible();
  });

  test('filter picker hides chrome and keeps filtered rows visible with keyboard inset', async ({
    page,
  }) => {
    await setHarnessKeyboardInset(page, 300);
    await page.getByTestId('open-filter-picker').click();
    const drawer = page.locator('[data-slot="drawer-content"]');
    await expect(drawer).toBeVisible();
    // Wait for harness keyboard inset + picker keyboard-open state (chrome hides asynchronously).
    await expect(drawer.getByText('Reset All')).not.toBeVisible({ timeout: 10_000 });
    const search = page.getByPlaceholder('Search models...');
    await expect(search).toBeVisible();
    await search.fill('model-01');
    await expect(page.getByText('provider/model-01')).toBeVisible();
    await expect(page.getByText('provider/model-02')).toHaveCount(0);
    await expect
      .poll(async () =>
        drawer.evaluate(
          (el) =>
            (el.querySelector('[data-picker-scroll-body]') as HTMLElement | null)?.clientHeight ?? 0
        )
      )
      .toBeGreaterThan(0);
  });
});
