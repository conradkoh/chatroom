import { ConvexHttpClient } from 'convex/browser';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import { expectFooterPinned, WIZARD_VIEWPORTS } from '../../support/wizard-layout';
import { readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

const MANY_MACHINE_COUNT = 12;

test.describe('New chatroom wizard layout', { tag: [TAG_DOWNSTREAM] }, () => {
  for (const viewport of WIZARD_VIEWPORTS) {
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

      await expectFooterPinned(page, viewport, 'machine (1 machine)', [
        page.getByRole('button', { name: 'Continue' }),
        page.getByRole('button', { name: 'Cancel' }),
      ]);
    });

    test(`machine step keeps the footer pinned with many machines at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      const client = new ConvexHttpClient(getConvexUrl());
      await Promise.all(
        Array.from({ length: MANY_MACHINE_COUNT }, (_, index) =>
          seedConnectedMachine(client, sessionId, {
            hostname: `e2e-host-${String(index + 1).padStart(2, '0')}`,
            idPrefix: 'e2e-wizard-many',
          })
        )
      );

      await page.goto('/app?create=true');
      await expect(page.getByRole('heading', { name: 'New Chatroom' })).toBeVisible({
        timeout: 15_000,
      });
      // All rows render together; waiting for one enabled row means the list has loaded.
      await expect(page.getByRole('button', { name: /e2e-host-01/ })).toBeEnabled({
        timeout: 30_000,
      });

      const metrics = await expectFooterPinned(page, viewport, 'machine (12 machines)', [
        page.getByRole('button', { name: 'Continue' }),
        page.getByRole('button', { name: 'Cancel' }),
      ]);

      // On both viewports the 12 rows cannot fit, so the step body (not the page) must scroll.
      expect(metrics.bodyScrolls, 'the step body should scroll with many machines').toBe(true);
    });
  }
});
