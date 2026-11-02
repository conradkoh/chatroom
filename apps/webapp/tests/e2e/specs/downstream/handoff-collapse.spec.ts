import { expect, test } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

test.describe('Timeline handoff collapse', { tag: [TAG_DOWNSTREAM] }, () => {
  // The fixtures render a fixed 15th November 2023 date; pin the browser timezone so
  // the assertion does not depend on the CI host.
  test.use({ timezoneId: 'UTC' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/test/timeline-handoff-collapse');
  });

  test('collapses agent-to-agent handoffs to a compact summary bar', async ({ page }) => {
    const fixture = page.getByTestId('collapse-normal');
    const row = fixture.getByTestId('timeline-team-message');
    const toggle = fixture.getByTestId('timeline-handoff-toggle');

    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(96);

    await expect(fixture.getByTestId('timeline-message-footer')).toHaveCount(0);
    await expect(toggle).toContainText('15th November 2023');
  });

  test('keeps the layout and focus stable across expand and collapse', async ({ page }) => {
    // The chevron rotation is a transition; reduced motion settles the geometry instantly
    // so the measurement compares resting positions rather than animation frames.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const fixture = page.getByTestId('collapse-normal');
    const header = fixture.getByTestId('timeline-message-header');
    const toggle = fixture.getByTestId('timeline-handoff-toggle');
    const chevron = toggle.locator('svg');

    const headerY = (await header.boundingBox())!.y;
    const chevronY = (await chevron.boundingBox())!.y;

    await toggle.focus();
    await page.keyboard.press('Enter');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await expect(fixture.getByTestId('timeline-message-footer')).toBeVisible();
    expect(Math.abs((await header.boundingBox())!.y - headerY)).toBeLessThanOrEqual(1);
    expect(Math.abs((await chevron.boundingBox())!.y - chevronY)).toBeLessThanOrEqual(1);

    await page.keyboard.press('Space');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(fixture.getByTestId('timeline-message-footer')).toHaveCount(0);
    expect(Math.abs((await header.boundingBox())!.y - headerY)).toBeLessThanOrEqual(1);
    expect(Math.abs((await chevron.boundingBox())!.y - chevronY)).toBeLessThanOrEqual(1);
  });

  test('labels an empty handoff and previews code-only content', async ({ page }) => {
    await expect(
      page.getByTestId('collapse-empty').getByTestId('timeline-handoff-toggle')
    ).toContainText('Show full handoff');
    await expect(
      page.getByTestId('collapse-code').getByTestId('timeline-handoff-preview')
    ).toHaveText('(code block)');
  });

  test('clamps a long preview and drops the duration on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });

    const longFixture = page.getByTestId('collapse-long');
    const preview = longFixture.getByTestId('timeline-handoff-preview');
    const toggle = longFixture.getByTestId('timeline-handoff-toggle');

    const previewBox = await preview.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(previewBox!.height).toBeLessThanOrEqual(41);
    expect(await toggle.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    const normalToggle = page.getByTestId('collapse-normal').getByTestId('timeline-handoff-toggle');
    await expect(normalToggle.getByTestId('timeline-handoff-duration')).toBeHidden();
    await expect(normalToggle.getByText(/^\d{1,2}:\d{2}(am|pm)$/)).toBeVisible();
  });

  test('uses the theme hover and text tokens', async ({ page }) => {
    const fixture = page.getByTestId('collapse-normal');
    const toggle = fixture.getByTestId('timeline-handoff-toggle');
    const preview = fixture.getByTestId('timeline-handoff-preview');

    // Light, not hovered: preview uses the secondary text token.
    await expect(preview).toHaveCSS('color', 'rgb(82, 82, 82)');
    await toggle.hover();
    await expect(toggle).toHaveCSS('background-color', 'rgb(229, 229, 229)');

    await page.getByTestId('theme-dark-toggle').click();
    await page.mouse.move(0, 0);
    await expect(preview).toHaveCSS('color', 'rgb(161, 161, 170)');
    await toggle.hover();
    await expect(toggle).toHaveCSS('background-color', 'rgb(39, 39, 42)');
  });

  test('leaves the eager control expanded', async ({ page }) => {
    const fixture = page.getByTestId('eager-control');

    await expect(fixture.getByTestId('timeline-handoff-toggle')).toHaveCount(0);
    await expect(fixture.getByTestId('timeline-message-footer')).toBeVisible();
  });
});
