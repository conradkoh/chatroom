import { expect, test, devices } from '@playwright/test';

const HARNESS_PATH = '/dev/mobile-picker-harness';

test.use({ ...devices['iPhone 14'] });

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_PATH);
  await expect(page.getByRole('heading', { name: 'Mobile Picker Harness' })).toBeVisible();
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

test('last option is horizontally inside drawer bounds when keyboard closed', async ({ page }) => {
  await page.getByTestId('open-flat-picker').click();
  await expect(page.getByTestId('picker-last-option')).toBeVisible();

  const visible = await page.evaluate(() => {
    const drawer = document.querySelector('[data-slot="drawer-content"]') as HTMLElement | null;
    const last = document.querySelector('[data-testid="picker-last-option"]') as HTMLElement | null;
    if (!drawer || !last) return false;
    const d = drawer.getBoundingClientRect();
    const l = last.getBoundingClientRect();
    return l.left >= d.left - 1 && l.right <= d.right + 1;
  });

  expect(visible).toBe(true);
});

test('simulated keyboard inset sets maxHeight and keeps scroll body usable', async ({ page }) => {
  await page.evaluate(() => {
    window.__MOBILE_KEYBOARD_TEST_INSET__ = 300;
  });
  await page.getByTestId('open-flat-picker').click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();

  const drawer = page.locator('[data-slot="drawer-content"]');
  await expect.poll(async () => drawer.evaluate((el) => el.style.maxHeight)).toContain('300px');
  const style = await drawer.evaluate((el) => ({
    paddingBottom: el.style.paddingBottom,
    maxHeight: el.style.maxHeight,
  }));

  expect(style.paddingBottom).toContain('safe-area-inset-bottom');
  expect(style.maxHeight).toContain('300px');

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

test('filter panel picker uses scroll body inside drawer', async ({ page }) => {
  await page.getByTestId('open-filter-picker').click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
  await expect(page.locator('[data-picker-scroll-body]')).toBeVisible();
  await expect(page.getByText('Reset All')).toBeVisible();
});
