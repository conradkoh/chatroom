import type { Page } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import { openWorkspaceStep, readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

/**
 * Export runs entirely in the browser: the page reads Convex and saves the file with an anchor
 * download. The machine card is the only export entry point. These specs prove that the card saves
 * one machine bundle, and that the sidebar row menu offers no export item.
 */

interface SeededChatroom {
  chatroomName: string;
  machineId: string;
}

/** Creates a chatroom with an active workspace on a freshly seeded, connected machine. */
async function createChatroom(page: Page): Promise<SeededChatroom> {
  const sessionId = await readSessionId(page);
  const client = new ConvexHttpClient(getConvexUrl());
  const suffix = crypto.randomUUID();
  const hostname = `e2e-export-${suffix}`;
  const machineId = await seedConnectedMachine(client, sessionId, {
    hostname,
    idPrefix: 'e2e-export',
  });
  const folder = `/tmp/e2e-export-${suffix}`;

  await openWorkspaceStep(page, hostname);
  await page.getByRole('tab', { name: 'Existing folder' }).click();
  await page.getByLabel('Folder path').fill(folder);
  await page.getByRole('button', { name: 'Create chatroom' }).click();

  await expect(page.getByText(folder).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Open chatroom' }).click();
  await page.waitForURL('**/app/chatroom**', { timeout: 15_000 });
  await dismissSetupChecklist(page);

  return { chatroomName: folder.slice(folder.lastIndexOf('/') + 1), machineId };
}

/** The first visit auto-opens the setup checklist; close it so the sidebar is interactive. */
async function dismissSetupChecklist(page: Page): Promise<void> {
  const close = page.getByRole('dialog').getByLabel('Close').first();
  await close.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await close.isVisible()) await close.click();
}

test.describe('Chatroom export', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('the sidebar context menu has no export item and keeps Archive', async ({
    authenticatedPage: page,
  }) => {
    const { chatroomName } = await createChatroom(page);

    const row = page
      .locator('[data-slot="context-menu-trigger"]')
      .filter({ hasText: chatroomName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click({ button: 'right' });

    // Archive proves the menu is open, so the export count below is not a false pass.
    await expect(page.getByText('Archive Chat')).toBeVisible();
    await expect(page.getByTestId('chatroom-action-export')).toHaveCount(0);
  });

  test('exports every chatroom on a machine from its card menu', async ({
    authenticatedPage: page,
  }) => {
    const { machineId } = await createChatroom(page);

    await page.goto('/app/machines');
    const card = page.locator(`[data-testid="machine-card"][data-machine-id="${machineId}"]`);
    await expect(card.getByTestId('machine-status')).toHaveText('Online', { timeout: 15_000 });
    await card.getByTestId('machine-actions-trigger').click();

    const exportItem = page.getByTestId('machine-action-export');
    await expect(exportItem).toHaveText('Export chatrooms');

    const downloadPromise = page.waitForEvent('download');
    await exportItem.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^chatroom-all-.*\.json$/);
  });
});
