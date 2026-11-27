import type { Page } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import { openWorkspaceStep, readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

/**
 * Import runs entirely in the browser: the dialog reads the exported file locally, validates it and
 * writes through `chatroomImport.*`. This spec proves the whole loop — export the machine's
 * chatrooms from its card, re-import that file onto the same machine from the machine card's Import
 * chatrooms… menu item, and land on a new chatroom link.
 */

interface SeededChatroom {
  chatroomName: string;
  machineId: string;
  hostname: string;
}

async function createChatroom(page: Page): Promise<SeededChatroom> {
  const sessionId = await readSessionId(page);
  const client = new ConvexHttpClient(getConvexUrl());
  const suffix = crypto.randomUUID();
  const hostname = `e2e-import-${suffix}`;
  const machineId = await seedConnectedMachine(client, sessionId, {
    hostname,
    idPrefix: 'e2e-import',
  });
  const folder = `/tmp/e2e-import-${suffix}`;

  await openWorkspaceStep(page, hostname);
  await page.getByRole('tab', { name: 'Existing folder' }).click();
  await page.getByLabel('Folder path').fill(folder);
  await page.getByRole('button', { name: 'Create chatroom' }).click();

  await expect(page.getByText(folder).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Open chatroom' }).click();
  await page.waitForURL('**/app/chatroom**', { timeout: 15_000 });
  await dismissSetupChecklist(page);

  return { chatroomName: folder.slice(folder.lastIndexOf('/') + 1), machineId, hostname };
}

/** The first visit auto-opens the setup checklist; close it so the sidebar is interactive. */
async function dismissSetupChecklist(page: Page): Promise<void> {
  const close = page.getByRole('dialog').getByLabel('Close').first();
  await close.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await close.isVisible()) await close.click();
}

test.describe('Chatroom import', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('imports an exported chatroom from the machine card menu', async ({
    authenticatedPage: page,
  }) => {
    // A full export + import loop: create, export, import, assert.
    test.setTimeout(120_000);
    const { chatroomName, machineId, hostname } = await createChatroom(page);

    // The sidebar row is visible on the chatroom page. Keep that check: the absence check below
    // must not pass against a sidebar that never mounted.
    const row = page
      .locator('[data-slot="context-menu-trigger"]')
      .filter({ hasText: chatroomName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('import-open-sidebar')).toHaveCount(0);

    // Export the machine's chatrooms from the machine card: the file is the import fixture.
    await page.goto('/app/machines');
    const exportCard = page.locator(`[data-testid="machine-card"][data-machine-id="${machineId}"]`);
    await expect(exportCard.getByTestId('machine-status')).toHaveText('Online', {
      timeout: 15_000,
    });
    await exportCard.getByTestId('machine-actions-trigger').click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('machine-action-export').click();
    const download = await downloadPromise;
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // The chatroom page has no import entry point: the sidebar header holds only the label.
    // The row is already visible above, so the sidebar has mounted and this is not a false pass.
    await expect(page.getByTestId('import-open-sidebar')).toHaveCount(0);

    // The landing page has no import entry point either. Wait for its heading first, so the
    // count check runs against a rendered header rather than a page that has not loaded yet.
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Chatrooms', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('import-open-header')).toHaveCount(0);

    // Import from the machine that owns the new chatrooms.
    await page.goto('/app/machines');
    const card = page.getByTestId('machine-card').filter({ hasText: hostname });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByTestId('machine-actions-trigger').click();
    await page.getByTestId('machine-action-import').click();

    const dialog = page.getByTestId('import-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('import-target')).toContainText(hostname);
    await page.getByTestId('import-file-input').setInputFiles(filePath as string);

    await expect(page.getByTestId('import-entry-list')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: /Select all/ }).click();
    // No machine radio: the target is the card's machine.
    await page.getByTestId('import-start').click();

    await expect(page.getByTestId('import-summary')).toHaveText(/Imported 1 of 1 selected/, {
      timeout: 60_000,
    });
    const imported = page.getByTestId('import-results-imported');
    await expect(imported.getByRole('link', { name: /Open/ })).toHaveAttribute(
      'href',
      /\/app\/chatroom\?id=/
    );
  });
});
