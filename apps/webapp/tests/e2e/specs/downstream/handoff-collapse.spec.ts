import { expect, test, type Locator, type Page } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/** Fixture literals: exactly 64 characters is the longest harness segment the normalizer keeps. */
const LONG_HARNESS = 'harness-'.repeat(8);
const LONG_MODEL = 'claude-sonnet-5-5-long-model-name';

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

type FocusZone = { zone: 'inside' | 'guard' | 'escaped'; stop: string };

/**
 * Where focus sits right now relative to the details dialog. 'guard' is Base UI's
 * visually hidden focus guard: the trap moves focus off it on the next animation frame,
 * so it is a transient, sanctioned state. 'escaped' is any other element and is a real
 * trap failure.
 */
const readFocusZone = (page: Page): Promise<FocusZone> =>
  page.evaluate((): FocusZone => {
    const popup = document.querySelector('[data-testid="timeline-handoff-dialog"]');
    const active = document.activeElement as HTMLElement | null;
    if (!popup || !active) return { zone: 'escaped', stop: 'no popup or no focused element' };
    if (popup.contains(active)) {
      const stop = [
        active.tagName,
        active.getAttribute('data-testid'),
        active.getAttribute('aria-label'),
        active.textContent?.trim().slice(0, 24),
      ]
        .filter(Boolean)
        .join(' ');
      return { zone: 'inside', stop };
    }
    if (active.hasAttribute('data-base-ui-focus-guard')) return { zone: 'guard', stop: 'guard' };
    return { zone: 'escaped', stop: active.tagName };
  });

test.describe('Timeline handoff collapse', { tag: [TAG_DOWNSTREAM] }, () => {
  // The fixtures render a fixed 15th November 2023 date; pin the browser timezone so
  // the assertion does not depend on the CI host.
  // Reduced motion is the spec default: the dialog has no animation, so geometry reads
  // need no animation wait. The motion path is covered in the nested describe below.
  // `contextOptions` carries the emulation: Playwright 1.62 has no top-level
  // `reducedMotion` test option.
  test.use({ timezoneId: 'UTC', contextOptions: { reducedMotion: 'reduce' } });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/test/timeline-handoff-collapse');
  });

  const triggerFor = (page: Page, fixtureId: string) =>
    page.getByTestId(fixtureId).getByTestId('timeline-handoff-trigger');

  test('collapses agent-to-agent handoffs to a compact summary bar', async ({ page }) => {
    const fixture = page.getByTestId('collapse-normal');
    const row = fixture.getByTestId('timeline-team-message');
    const trigger = fixture.getByTestId('timeline-handoff-trigger');

    await expect(row).toBeVisible();
    await readBox(row, (box) => expect(box.height).toBeLessThanOrEqual(96));

    // A dialog trigger, not a disclosure: no toggle state, no controlled region.
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(trigger).not.toHaveAttribute('aria-expanded');
    await expect(trigger).not.toHaveAttribute('data-state');
    await expect(fixture.getByTestId('timeline-message-footer')).toHaveCount(0);
    await expect(fixture.locator('.prose')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toContainText('15th November 2023');
  });

  test('keeps the row layout and scroll position stable while the dialog is open', async ({
    page,
  }) => {
    const row = page.getByTestId('collapse-normal').getByTestId('timeline-team-message');
    const belowRow = page.getByTestId('collapse-empty').getByTestId('timeline-team-message');
    const trigger = triggerFor(page, 'collapse-normal');

    const rowBox = await readBox(row);
    const belowBox = await readBox(belowRow);
    const scrollTop = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);

    const assertLayoutStable = async () => {
      await readBox(row, (box) => {
        expect(Math.abs(box.y - rowBox.y)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(box.height - rowBox.height)).toBeLessThanOrEqual(0.5);
      });
      await readBox(belowRow, (box) => {
        expect(Math.abs(box.y - belowBox.y)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(box.height - belowBox.height)).toBeLessThanOrEqual(0.5);
      });
      expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(scrollTop);
    };

    await trigger.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('timeline-handoff-dialog-body')).toBeFocused();
    await assertLayoutStable();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await assertLayoutStable();

    await trigger.focus();
    await page.keyboard.press(' ');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('timeline-handoff-dialog-body')).toBeFocused();
    await assertLayoutStable();
  });

  test('keeps the inner feed scroller, the row and the row below still while the dialog opens and closes', async ({
    page,
  }) => {
    const feed = page.getByTestId('collapse-feed-scroller');
    const row = page.getByTestId('collapse-feed-row').getByTestId('timeline-team-message');
    const belowRow = page.getByTestId('collapse-feed-below').getByTestId('timeline-team-message');
    const trigger = page.getByTestId('collapse-feed-row').getByTestId('timeline-handoff-trigger');

    // Real overflow: the feed is taller than its scroll container, so a scroll would be observable.
    // Polled: on a cold dev compile the page can be laid out before the stylesheet lands.
    await expect.poll(() => feed.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    // Park the feed mid-scroll so the check is not trivially at rest at scrollTop 0.
    await feed.evaluate((el) => {
      el.scrollTop = 400;
    });
    await expect.poll(() => feed.evaluate((el) => el.scrollTop)).toBe(400);

    // Focus before the baseline so any focus-driven scroll is not counted as a dialog effect.
    await trigger.focus();
    const feedScrollTop = await feed.evaluate((el) => el.scrollTop);
    const rowBox = await readBox(row);
    const belowBox = await readBox(belowRow);

    const assertFeedStable = async () => {
      await readBox(row, (box) => {
        expect(Math.abs(box.y - rowBox.y)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(box.height - rowBox.height)).toBeLessThanOrEqual(0.5);
      });
      await readBox(belowRow, (box) => {
        expect(Math.abs(box.y - belowBox.y)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(box.height - belowBox.height)).toBeLessThanOrEqual(0.5);
      });
      expect(await feed.evaluate((el) => el.scrollTop)).toBe(feedScrollTop);
    };

    // Open with a mouse click, the path most readers use.
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertFeedStable();

    await page.getByTestId('timeline-handoff-dialog-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await assertFeedStable();

    // Reopen with the keyboard; the feed must stay still on that path too.
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertFeedStable();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await assertFeedStable();
  });

  test('closes the dialog from the header button, Escape and the backdrop', async ({ page }) => {
    const trigger = triggerFor(page, 'collapse-normal');

    const open = async () => {
      await trigger.click();
      await expect(page.getByRole('dialog')).toBeVisible();
    };
    const expectClosed = async () => {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByTestId('timeline-handoff-dialog-body')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    };

    await open();
    await page.getByTestId('timeline-handoff-dialog-close').click();
    await expectClosed();

    await open();
    await page.keyboard.press('Escape');
    await expectClosed();

    await open();
    await page.mouse.click(4, 4);
    await expectClosed();
  });

  test('suppresses the dialog enter and exit animation under reduced motion', async ({ page }) => {
    await triggerFor(page, 'collapse-normal').click();

    const popup = page.getByTestId('timeline-handoff-dialog');
    await expect(popup).toBeVisible();
    // Popup only: the backdrop fade is a documented residual of the shared primitive.
    await expect(popup).toHaveCSS('animation-name', 'none');
    expect(await popup.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('traps Tab focus inside the dialog', async ({ page }) => {
    await triggerFor(page, 'collapse-normal').click();
    await expect(page.getByTestId('timeline-handoff-dialog')).toBeVisible();

    const stops = new Set<string>();
    for (let press = 1; press <= 25; press += 1) {
      await page.keyboard.press('Tab');
      // Settle before the next press. A press that lands on the guard is bounced back
      // inside one animation frame; a second Tab sent before that frame would leave the
      // guard and read as an escape. Polling retries until focus is inside or the
      // default expect timeout runs out, so a persistent escape still fails here.
      await expect
        .poll(() => readFocusZone(page), { message: `focus after Tab press ${press}` })
        .toMatchObject({ zone: 'inside' });
      stops.add((await readFocusZone(page)).stop);
    }
    // The loop must cycle through the dialog's tab stops, not pin focus on one element.
    expect(stops.size).toBeGreaterThanOrEqual(3);
  });

  test('sizes the dialog to the viewport and pins header and footer', async ({ page }) => {
    const trigger = triggerFor(page, 'collapse-normal');

    await trigger.click();
    const popup = page.getByTestId('timeline-handoff-dialog');
    await expect(popup).toBeVisible();

    // Desktop 1280x800: max-w-3xl (768px) and max-h 80vh (640px).
    await readBox(popup, (box) => {
      expect(box.width).toBeLessThanOrEqual(768);
      expect(box.height).toBeLessThanOrEqual(640);
    });
    await expect(popup).toHaveCSS('display', 'flex');
    await expect(popup).toHaveCSS('padding', '0px');
    await expect(page.getByTestId('timeline-handoff-dialog-body')).toBeVisible();
    await expect(popup.getByTestId('timeline-message-footer')).toBeVisible();

    // Mobile 375x667: width minus 1rem, max-h 85dvh (567px).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 667 });
    await trigger.click();
    await expect(popup).toBeVisible();

    await readBox(popup, (box) => {
      expect(box.width).toBeGreaterThanOrEqual(359);
      expect(box.height).toBeLessThanOrEqual(567);
    });
    await expect(popup).toHaveCSS('display', 'flex');
    await expect(popup).toHaveCSS('padding', '0px');
    await expect(page.getByTestId('timeline-handoff-dialog-body')).toBeVisible();
    await expect(popup.getByTestId('timeline-message-footer')).toBeVisible();
  });

  for (const viewport of [
    { width: 375, height: 667 },
    { width: 1280, height: 800 },
  ]) {
    test(`contains a tall handoff with a scrolling body at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await triggerFor(page, 'collapse-tall').click();

      const dialog = page.getByRole('dialog');
      const body = page.getByTestId('timeline-handoff-dialog-body');
      const header = page.getByTestId('timeline-handoff-dialog-header');
      const footer = dialog.getByTestId('timeline-message-footer');

      await expect(body).toBeVisible();
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

      const footerBox = await readBox(footer);
      const headerBox = await readBox(header);

      await body.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

      // Pinned chrome: scrolling the body must not move the header or the footer.
      await readBox(footer, (box) => expect(Math.abs(box.y - footerBox.y)).toBeLessThanOrEqual(1));
      await readBox(header, (box) => expect(Math.abs(box.y - headerBox.y)).toBeLessThanOrEqual(1));

      // No horizontal scroll on the dialog body itself.
      expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      // The table scrolls inside its own overflow container instead.
      const tableScroll = await body.evaluate((el) => {
        const table = el.querySelector('table');
        if (!table) return { found: false, scrolls: false };
        let node: HTMLElement | null = table;
        while (node && node !== el) {
          if (getComputedStyle(node).overflowX === 'auto') {
            return { found: true, scrolls: node.scrollWidth > node.clientWidth };
          }
          node = node.parentElement;
        }
        return { found: false, scrolls: false };
      });
      expect(tableScroll.found).toBe(true);
      expect(tableScroll.scrolls).toBe(true);
    });
  }

  test.describe('dialog footer', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('shows footer actions, duration and full timestamp, and copies without a toast', async ({
      page,
    }) => {
      await triggerFor(page, 'collapse-long-duration').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const footer = dialog.getByTestId('timeline-message-footer');

      const copyButton = footer.getByTitle('Copy as markdown');
      await expect(copyButton).toBeVisible();
      await expect(footer.getByTitle('Add to context')).toBeVisible();
      await expect(footer.getByTitle('Download message')).toBeVisible();

      await expect(footer.getByTestId('timeline-handoff-duration')).toHaveText('1h 5m');
      await expect(footer).toContainText('15th November 2023');
      await expect(footer).toContainText('12:14pm');

      await copyButton.click();
      await expect(copyButton.locator('svg.lucide-check')).toBeVisible();
      // Copy feedback is the inline check icon only.
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(0);
    });
  });

  test('keeps empty and code-only handoffs readable in the dialog', async ({ page }) => {
    const emptyTrigger = triggerFor(page, 'collapse-empty');
    await expect(emptyTrigger).toContainText('Show full handoff');
    await emptyTrigger.click();
    await expect(page.getByTestId('timeline-handoff-dialog-empty')).toHaveText(
      'No text content in this handoff.'
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const codeFixture = page.getByTestId('collapse-code');
    await expect(codeFixture.getByTestId('timeline-handoff-preview')).toHaveText('(code block)');
    await triggerFor(page, 'collapse-code').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('pre')).toContainText('const a = 1;');
  });

  test('clamps a long preview on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });

    const longFixture = page.getByTestId('collapse-long');
    const preview = longFixture.getByTestId('timeline-handoff-preview');
    const trigger = longFixture.getByTestId('timeline-handoff-trigger');

    await expect(preview).toBeVisible();
    await readBox(preview, (box) => expect(box.height).toBeLessThanOrEqual(41));
    expect(await trigger.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    const normalTrigger = page
      .getByTestId('collapse-normal')
      .getByTestId('timeline-handoff-trigger');
    await expect(normalTrigger.getByTestId('timeline-handoff-duration')).toBeVisible();
    await expect(normalTrigger.getByTestId('timeline-handoff-duration')).toHaveText('4m 12s');
    await expect(normalTrigger.getByText(/^\d{1,2}:\d{2}(am|pm)$/).first()).toBeVisible();
  });

  for (const width of [375, 320]) {
    test(`keeps the duration and time on one line in the summary bar at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });

      const fixture = page.getByTestId('collapse-long-duration');
      const trigger = fixture.getByTestId('timeline-handoff-trigger');
      const preview = fixture.getByTestId('timeline-handoff-preview');
      const duration = fixture.getByTestId('timeline-handoff-duration');
      const timeOfDay = trigger.getByText(/^\d{1,2}:\d{2}(am|pm)$/).first();

      await expect(duration).toHaveText('1h 5m');
      await expect(timeOfDay).toBeVisible();
      const triggerBox = await readBox(trigger);
      const durationBox = await readBox(duration);
      const timeBox = await readBox(timeOfDay);
      // The duration and the time of day are inline text inside their own boxes. Comparing the
      // vertical centres proves they share one line; stacking would separate them by a full line.
      const centreY = (box: Box) => box.y + box.height / 2;
      expect(Math.abs(centreY(durationBox) - centreY(timeBox))).toBeLessThanOrEqual(1);
      // A centre check alone cannot see overlap or reordering: the duration slot must start at or
      // after the time's right edge, and both must sit inside the trigger's right edge. The cross-row
      // right-edge and slot checks live in the alignment tests below.
      const timeRight = timeBox.x + timeBox.width;
      const triggerRight = triggerBox.x + triggerBox.width;
      expect(durationBox.x).toBeGreaterThanOrEqual(timeRight - 1);
      expect(durationBox.x + durationBox.width).toBeLessThanOrEqual(triggerRight + 1);
      expect(timeRight).toBeLessThanOrEqual(triggerRight + 1);

      await readBox(preview, (box) => expect(box.width).toBeGreaterThanOrEqual(120));
      await readBox(preview, (box) => expect(box.height).toBeLessThanOrEqual(41));
      expect(await trigger.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
  }

  test('shows the duration and the full date in the summary bar on desktop', async ({ page }) => {
    const trigger = page.getByTestId('collapse-normal').getByTestId('timeline-handoff-trigger');
    await expect(trigger.getByTestId('timeline-handoff-duration')).toBeVisible();
    await expect(trigger.getByTestId('timeline-handoff-duration')).toHaveText('4m 12s');
    await expect(trigger).toContainText('15th November 2023');
  });

  test('uses the theme hover and text tokens', async ({ page }) => {
    const fixture = page.getByTestId('collapse-normal');
    const trigger = fixture.getByTestId('timeline-handoff-trigger');
    const preview = fixture.getByTestId('timeline-handoff-preview');

    // Light, not hovered: preview uses the secondary text token.
    await expect(preview).toHaveCSS('color', 'rgb(82, 82, 82)');
    await trigger.hover();
    await expect(trigger).toHaveCSS('background-color', 'rgb(229, 229, 229)');

    await page.getByTestId('theme-dark-toggle').click();
    await page.mouse.move(0, 0);
    await expect(preview).toHaveCSS('color', 'rgb(161, 161, 170)');
    await trigger.hover();
    await expect(trigger).toHaveCSS('background-color', 'rgb(39, 39, 42)');

    // Dark popup surface is the dark --chatroom-bg-primary token (#09090b).
    await trigger.click();
    await expect(page.getByTestId('timeline-handoff-dialog')).toHaveCSS(
      'background-color',
      'rgb(9, 9, 11)'
    );
  });

  test('leaves the eager control expanded', async ({ page }) => {
    const fixture = page.getByTestId('eager-control');

    await expect(fixture.getByTestId('timeline-handoff-trigger')).toHaveCount(0);
    await expect(fixture.getByTestId('timeline-message-footer')).toBeVisible();
  });

  test.describe('with motion allowed', () => {
    test.use({ contextOptions: { reducedMotion: 'no-preference' } });

    test('animates the dialog in and closes it', async ({ page }) => {
      await triggerFor(page, 'collapse-normal').click();

      const popup = page.getByTestId('timeline-handoff-dialog');
      await expect(popup).toBeVisible();
      await expect(popup).not.toHaveCSS('animation-name', 'none');

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  });

  const rightEdge = (box: Box) => box.x + box.width;

  for (const width of [320, 1280]) {
    test(`aligns the timestamp right edge and duration slot across bars at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const withDuration = page
        .getByTestId('collapse-normal')
        .getByTestId('timeline-handoff-trigger');
      const withoutDuration = page
        .getByTestId('collapse-empty')
        .getByTestId('timeline-handoff-trigger');
      await expect(withDuration.getByTestId('timeline-handoff-duration')).toHaveText('4m 12s');
      await expect(withoutDuration.getByTestId('timeline-handoff-duration')).toHaveCount(0);

      const timeA = await readBox(withDuration.getByTestId('timeline-handoff-timestamp'));
      const timeB = await readBox(withoutDuration.getByTestId('timeline-handoff-timestamp'));
      const slotA = await readBox(withDuration.getByTestId('timeline-handoff-duration-slot'));
      const slotB = await readBox(withoutDuration.getByTestId('timeline-handoff-duration-slot'));
      expect(Math.abs(rightEdge(timeA) - rightEdge(timeB))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(slotA.x - slotB.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(slotA.width - slotB.width)).toBeLessThanOrEqual(0.5);
    });

    test(`aligns the eager footer timestamp with and without a duration at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const plain = page.getByTestId('eager-control').getByTestId('timeline-handoff-timestamp');
      const withDuration = page
        .getByTestId('eager-long-harness')
        .getByTestId('timeline-handoff-timestamp');
      await expect(
        page.getByTestId('eager-long-harness').getByTestId('timeline-handoff-duration')
      ).toHaveText('1m 2s');

      expect(
        Math.abs(rightEdge(await readBox(plain)) - rightEdge(await readBox(withDuration)))
      ).toBeLessThanOrEqual(0.5);
    });

    test(`keeps a 100h duration inside its slot at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const huge = page
        .getByTestId('collapse-huge-duration')
        .getByTestId('timeline-handoff-trigger');
      const normal = page.getByTestId('collapse-empty').getByTestId('timeline-handoff-trigger');
      await expect(huge.getByTestId('timeline-handoff-duration')).toHaveText('100h 10m');
      await expect(huge.getByTestId('timeline-handoff-duration')).toHaveAttribute(
        'title',
        'Time since previous message: 100h 10m'
      );
      // The slot clips an over-wide value instead of growing: the ellipsis rule is computed
      // style, so this fails if the slot loses `truncate` even when the width stays 7ch.
      const durationSlot = huge.getByTestId('timeline-handoff-duration-slot');
      await expect(durationSlot).toHaveCSS('text-overflow', 'ellipsis');
      await expect(durationSlot).toHaveCSS('overflow-x', 'hidden');

      const slotHuge = await readBox(huge.getByTestId('timeline-handoff-duration-slot'));
      const slotNormal = await readBox(normal.getByTestId('timeline-handoff-duration-slot'));
      expect(Math.abs(slotHuge.width - slotNormal.width)).toBeLessThanOrEqual(0.5);
      const timeHuge = await readBox(huge.getByTestId('timeline-handoff-timestamp'));
      const timeNormal = await readBox(normal.getByTestId('timeline-handoff-timestamp'));
      expect(Math.abs(rightEdge(timeHuge) - rightEdge(timeNormal))).toBeLessThanOrEqual(0.5);
      expect(await huge.evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5)).toBe(true);
    });

    test(`keeps the model visible beside a 64-character harness in the eager footer at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const agentRow = page
        .getByTestId('eager-long-harness')
        .getByTestId('timeline-footer-agent-row');
      await expect(agentRow.getByTestId('timeline-sender-agent-harness')).toHaveText(LONG_HARNESS);
      const model = agentRow.getByTestId('timeline-sender-agent-model');
      await expect(model).toHaveText(LONG_MODEL);

      const modelBox = await readBox(model);
      const rowBox = await readBox(agentRow);
      expect(modelBox.width).toBeGreaterThanOrEqual(60);
      expect(rightEdge(modelBox)).toBeLessThanOrEqual(rightEdge(rowBox) + 0.5);
      expect(await agentRow.evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5)).toBe(true);
    });
  }

  test('keeps the model visible beside a 64-character harness in the summary bar on desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const trigger = page
      .getByTestId('collapse-long-harness')
      .getByTestId('timeline-handoff-trigger');
    const model = trigger.getByTestId('timeline-sender-agent-model');
    await expect(model).toHaveText(LONG_MODEL);

    const modelBox = await readBox(model);
    const triggerBox = await readBox(trigger);
    expect(modelBox.width).toBeGreaterThanOrEqual(60);
    expect(rightEdge(modelBox)).toBeLessThanOrEqual(rightEdge(triggerBox) + 0.5);
    expect(await trigger.evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5)).toBe(true);
  });

  test('hides the agent line in the summary bar below sm', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const trigger = page
      .getByTestId('collapse-long-harness')
      .getByTestId('timeline-handoff-trigger');
    await expect(trigger.getByTestId('timeline-sender-agent')).toBeHidden();
  });
});
