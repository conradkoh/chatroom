import { expect, test, type Locator } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/**
 * Reads a locator's bounding box with retries. The root layout re-mounts shortly after
 * `load`, so a one-shot read can hit a detached node (null) or a pre-mount layout.
 * `assert` runs inside the retry so geometry checks settle together with the read.
 */
async function readBox(locator: Locator, assert: (box: Box) => void = () => {}): Promise<Box> {
  const read: { box: Box | null } = { box: null };
  await expect(async () => {
    const box = await locator.boundingBox();
    expect(box, 'element should be laid out').not.toBeNull();
    assert(box!);
    read.box = box;
  }).toPass({ timeout: 5_000 });
  if (!read.box) throw new Error('readBox: no bounding box after retries');
  return read.box;
}

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

    await expect(row).toBeVisible();
    await readBox(row, (box) => expect(box.height).toBeLessThanOrEqual(96));

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

    await expect(header).toBeVisible();
    await expect(chevron).toBeVisible();
    const headerY = (await readBox(header)).y;
    const chevronY = (await readBox(chevron)).y;

    await toggle.focus();
    await page.keyboard.press('Enter');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await expect(fixture.getByTestId('timeline-message-footer')).toBeVisible();
    await readBox(header, (box) => expect(Math.abs(box.y - headerY)).toBeLessThanOrEqual(1));
    await readBox(chevron, (box) => expect(Math.abs(box.y - chevronY)).toBeLessThanOrEqual(1));

    await page.keyboard.press('Space');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(fixture.getByTestId('timeline-message-footer')).toHaveCount(0);
    await readBox(header, (box) => expect(Math.abs(box.y - headerY)).toBeLessThanOrEqual(1));
    await readBox(chevron, (box) => expect(Math.abs(box.y - chevronY)).toBeLessThanOrEqual(1));
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

    await expect(preview).toBeVisible();
    await readBox(preview, (box) => expect(box.height).toBeLessThanOrEqual(41));
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
