import { expect, test } from '@playwright/test';

import { HomePage } from './pages/home.page';

test.describe('Home Page', () => {
  let homePage: HomePage;

  test.beforeEach(async ({ page }) => {
    homePage = new HomePage(page);
    await homePage.navigate();
  });

  test('should display the correct page title', async () => {
    const title = await homePage.getTitle();
    expect(title).toBe('Next Convex App');
  });

  test('should display the brand name in the navigation header', async () => {
    await expect(homePage.brandLink).toBeVisible();
    await expect(homePage.brandLink).toHaveText('Next Convex');
  });

  test('should display the main heading text', async () => {
    await expect(homePage.heading).toBeVisible();
    const headingText = await homePage.getHeadingText();
    expect(headingText).toContain('Convex + Next Starter App');
  });

  test('should display the footer with app version', async () => {
    await expect(homePage.footer).toBeVisible();
    const footerText = (await homePage.footer.textContent()) ?? '';
    expect(footerText).toMatch(/App Version:/);
  });

  test('should load the page successfully', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });
});
