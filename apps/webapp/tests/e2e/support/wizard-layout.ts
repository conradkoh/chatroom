import type { Locator, Page } from '@playwright/test';

import { expect } from '../fixtures/auth.fixture';

/**
 * Viewports where the footer used to fall below the fold: a phone, and a short desktop window
 * where the wizard's viewport-based height was larger than the space `<main>` actually gets.
 */
export const WIZARD_VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'short desktop', width: 1280, height: 700 },
] as const;

export type WizardViewport = (typeof WIZARD_VIEWPORTS)[number];

export interface FooterPinnedMetrics {
  /** Bottom edge of each footer action, in CSS pixels from the viewport top. */
  footerBottoms: number[];
  /** `main[data-scroll-region]` vertical overflow: `scrollHeight - clientHeight`. */
  mainOverflow: number;
  /** True when the active step body needs scrolling to show all of its content. */
  bodyScrolls: boolean;
  bodyScrollHeight: number;
  bodyClientHeight: number;
}

/**
 * Asserts the shared setup-step contract at a viewport: the footer actions are fully on screen, the
 * page scroll region does not overflow in either direction, and the app header stays above the
 * wizard. The step body may or may not overflow; the numbers are returned so a long-content test
 * can require `bodyScrolls` where it is expected.
 *
 * `step` only labels the one-line measurement log; it is not an assertion target.
 */
export async function expectFooterPinned(
  page: Page,
  viewport: WizardViewport,
  step: string,
  buttons: Locator[]
): Promise<FooterPinnedMetrics> {
  expect(buttons.length, 'a step must pass at least one footer action').toBeGreaterThan(0);

  const footerBottoms: number[] = [];
  for (const button of buttons) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box, `${step}: footer action should have a bounding box`).not.toBeNull();
    expect(box!.y, `${step}: footer action starts below the viewport top`).toBeGreaterThanOrEqual(
      0
    );
    expect(
      box!.y + box!.height,
      `${step}: footer action bottom should be inside the viewport`
    ).toBeLessThanOrEqual(viewport.height);
    footerBottoms.push(box!.y + box!.height);
  }

  // The page scroll region must not overflow: no scrolling is needed to reach the footer, and no
  // long token may widen the page.
  const main = page.locator('main[data-scroll-region]');
  const { mainOverflow, mainHorizontalOverflow, documentHorizontalOverflow } = await main.evaluate(
    (el) => ({
      mainOverflow: el.scrollHeight - el.clientHeight,
      mainHorizontalOverflow: el.scrollWidth - el.clientWidth,
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })
  );
  expect(mainOverflow, `${step}: main scroll region should not scroll vertically`).toBe(0);
  expect(
    mainHorizontalOverflow,
    `${step}: main scroll region should not scroll horizontally`
  ).toBeLessThanOrEqual(0);
  expect(
    documentHorizontalOverflow,
    `${step}: the document should not scroll horizontally`
  ).toBeLessThanOrEqual(0);

  // The global header still shows, and the wizard starts below it (not overlapped).
  const header = page.locator('header[data-app-navigation]');
  await expect(header).toBeVisible();
  const headerBox = await header.boundingBox();
  expect(headerBox, 'app header should have a bounding box').not.toBeNull();
  expect(headerBox!.y).toBeGreaterThanOrEqual(0);
  expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(viewport.height);

  const wizardHeading = page.getByRole('heading', { name: 'New Chatroom' });
  const headingBox = await wizardHeading.boundingBox();
  expect(headingBox, 'wizard heading should have a bounding box').not.toBeNull();
  expect(
    headingBox!.y,
    'wizard heading should start at or below the app header'
  ).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);

  // Only the active tab panel's body is rendered visibly; the inactive panel is `display: none`.
  const body = page.locator('[data-slot="setup-step-body"]:visible');
  await expect(body).toHaveCount(1);
  const { bodyScrollHeight, bodyClientHeight, bodyHorizontalOverflow } = await body.evaluate(
    (el) => ({
      bodyScrollHeight: el.scrollHeight,
      bodyClientHeight: el.clientHeight,
      bodyHorizontalOverflow: el.scrollWidth - el.clientWidth,
    })
  );
  expect(
    bodyHorizontalOverflow,
    `${step}: the step body should not scroll horizontally`
  ).toBeLessThanOrEqual(0);

  const footerBottom = Math.max(...footerBottoms);
  // One line per measurement so the numbers can be copied into the PR table.
  console.log(
    `[wizard-layout] ${step} ${viewport.name}: footerBottom=${footerBottom}/${viewport.height}, ` +
      `mainOverflow=${mainOverflow}, body scrollHeight/clientHeight=${bodyScrollHeight}/${bodyClientHeight}`
  );

  return {
    footerBottoms,
    mainOverflow,
    bodyScrolls: bodyScrollHeight > bodyClientHeight,
    bodyScrollHeight,
    bodyClientHeight,
  };
}
