import type { Page } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import { openWorkspaceStep, readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

/**
 * Import runs entirely in the browser: the dialog reads the exported file locally, validates it and
 * writes through `chatroomImport.*`. This spec proves the whole loop — export a chatroom, re-import
 * that file onto the seeded machine from the sidebar header, and land on a new chatroom link.
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

  return { chatroomName: folder.slice(folder.lastIndexOf('/') + 1), machineId, hostname };
}

test.describe('Chatroom import', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('imports an exported chatroom from the sidebar dialog', async ({
    authenticatedPage: page,
  }) => {
    // A full export + import loop: create, export, import, assert.
    test.setTimeout(120_000);
    const { chatroomName, hostname } = await createChatroom(page);

    // Export the chatroom from its sidebar menu; the file is the import fixture.
    const row = page.getByRole('button', { name: new RegExp(chatroomName) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click({ button: 'right' });

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('chatroom-action-export').click();
    const download = await downloadPromise;
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // Import it back through the sidebar header entry point. The sidebar mounts
    // once the chatroom route has compiled and rendered.
    const importButton = page.getByTestId('import-open-sidebar');
    await expect(importButton).toBeVisible({ timeout: 60_000 });
    await importButton.click();
    const dialog = page.getByTestId('import-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('import-file-input').setInputFiles(filePath as string);

    await expect(page.getByTestId('import-entry-list')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: /Select all/ }).click();
    await dialog.getByRole('radio', { name: new RegExp(hostname) }).click();
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
