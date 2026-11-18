import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

/**
 * Viewports where the footer used to fall below the fold: a phone, and a short desktop window
 * where the wizard's viewport-based height was larger than the space `<main>` actually gets.
 */
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'short desktop', width: 1280, height: 700 },
] as const;

async function readSessionId(page: Page): Promise<SessionId> {
  const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
  expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
  return rawSessionId as SessionId;
}

/** Registers a machine with a connected daemon. The wizard only lists machines that are connected. */
async function seedConnectedMachine(
  client: ConvexHttpClient,
  sessionId: SessionId
): Promise<string> {
  const machineId = `e2e-wizard-layout-${crypto.randomUUID()}`;
  await client.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'e2e-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  await client.mutation(api.machines.daemonHeartbeat, { sessionId, machineId });
  return machineId;
}

test.describe('New chatroom wizard layout', { tag: [TAG_DOWNSTREAM] }, () => {
  for (const viewport of VIEWPORTS) {
    test(`machine step footer is visible without scrolling at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      const client = new ConvexHttpClient(getConvexUrl());
      await seedConnectedMachine(client, sessionId);

      await page.goto('/app?create=true');
      const wizardHeading = page.getByRole('heading', { name: 'New Chatroom' });
      await expect(wizardHeading).toBeVisible({ timeout: 15_000 });
      // Wait for the machine row so we measure the loaded step, not a skeleton.
      await expect(page.getByRole('button', { name: /e2e-host/ })).toBeEnabled({ timeout: 30_000 });

      const continueButton = page.getByRole('button', { name: 'Continue' });
      const cancelButton = page.getByRole('button', { name: 'Cancel' });
      await expect(continueButton).toBeVisible();

      // Footer fully inside the viewport: both actions' bottom edges are on screen.
      for (const button of [continueButton, cancelButton]) {
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }

      // The page scroll region must not overflow: no scrolling is needed to reach the footer.
      const overflow = await page
        .locator('main[data-scroll-region]')
        .evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(overflow).toBe(0);

      // The global header still shows, and the wizard starts below it (not overlapped).
      const header = page.locator('header[data-app-navigation]');
      await expect(header).toBeVisible();
      const headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      expect(headerBox!.y).toBeGreaterThanOrEqual(0);
      expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(viewport.height);

      const headingBox = await wizardHeading.boundingBox();
      expect(headingBox).not.toBeNull();
      expect(headingBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    });
  }
});
