import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import { CLAIM_TIMEOUT_MS, readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

const BACKUP_FILENAME = 'backup-20260301-141502.zip';
const BACKUP_BYTES = new TextEncoder().encode('e2e machine backup bytes');
const BACKUP_CONTENT_TYPE = 'application/x-chatroom-machine-backup';

async function claimBackupCommand(
  client: ConvexHttpClient,
  sessionId: SessionId,
  machineId: string,
  type: 'daemon.reportMachineBackups' | 'daemon.uploadMachineBackup'
) {
  const deadline = Date.now() + CLAIM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const claimed = await client.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId,
      machineId,
    });
    if (claimed?.type === type) return claimed;
    if (claimed) {
      await client.mutation(api.daemon.machineCommandInbox.acknowledge, {
        sessionId,
        commandId: claimed.commandId,
      });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No ${type} command reached machine ${machineId} within ${CLAIM_TIMEOUT_MS} ms`);
}

function hexSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function expandCard(page: Page, machineId: string) {
  const card = page.locator(`[data-testid="machine-card"][data-machine-id="${machineId}"]`);
  await expect(card.getByTestId('machine-status')).toHaveText('Online', { timeout: 15_000 });
  await card.getByTestId('machine-expander').click();
  await expect(card.getByTestId('machine-backups')).toBeVisible();
  return card;
}

/**
 * Stands in for the machine daemon: reports one inventory snapshot, uploads the archive when the
 * user confirms the warning, and then proves the temporary copy stops being servable.
 */
test.describe('Machine backups', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('lists, warns, downloads and deletes the temporary copy', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(120_000);
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const suffix = crypto.randomUUID();
    const machineId = await seedConnectedMachine(client, sessionId, {
      hostname: `e2e-backup-${suffix}`,
      idPrefix: 'e2e-backup',
    });
    const modifiedAt = Date.now() - 3600_000;

    await page.goto('/app/machines');
    const card = await expandCard(page, machineId);
    await card.getByTestId('backups-check').click();

    const inventoryCommand = await claimBackupCommand(
      client,
      sessionId,
      machineId,
      'daemon.reportMachineBackups'
    );
    await client.mutation(api.machineBackups.reportInventory, {
      sessionId,
      machineId,
      requestId: inventoryCommand.requestId,
      status: 'completed',
      inventoryDir: '/e2e/backups',
      stackFound: true,
      backups: [{ filename: BACKUP_FILENAME, sizeBytes: BACKUP_BYTES.length, modifiedAt }],
      totalCount: 1,
      totalBytes: BACKUP_BYTES.length,
      newestAt: modifiedAt,
      truncated: false,
    });

    const row = card.locator(`[data-testid="backup-row"][data-filename="${BACKUP_FILENAME}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByTestId('backup-download').click();
    const dialog = page.getByTestId('backup-warning-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByText(/bot tokens/)).toBeVisible();
    await dialog.getByTestId('backup-warning-confirm').click();

    const uploadCommand = await claimBackupCommand(
      client,
      sessionId,
      machineId,
      'daemon.uploadMachineBackup'
    );
    const upload = await client.mutation(api.machineBackups.createUploadUrl, {
      sessionId,
      machineId,
      requestId: uploadCommand.requestId,
      sizeBytes: BACKUP_BYTES.length,
    });
    expect(upload.ok).toBe(true);
    if (!upload.ok) throw new Error(`No upload URL: ${upload.reason}`);

    const response = await fetch(upload.uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': BACKUP_CONTENT_TYPE },
      body: BACKUP_BYTES,
    });
    expect(response.ok).toBe(true);
    const { storageId } = (await response.json()) as { storageId: string };
    const reported = await client.mutation(api.machineBackups.reportUploaded, {
      sessionId,
      machineId,
      requestId: uploadCommand.requestId,
      storageId: storageId as Id<'_storage'>,
      sizeBytes: BACKUP_BYTES.length,
      sha256: hexSha256(BACKUP_BYTES),
      stable: true,
    });
    expect(reported).toEqual({ ok: true });

    const saveButton = card.getByRole('button', { name: 'Save file' });
    await expect(saveButton).toBeVisible({ timeout: 15_000 });

    // The minted URL is a bearer capability; capture the exact one this save used.
    const storageRequest = page.waitForRequest(
      (request) => request.method() === 'GET' && request.url().includes('/api/storage/')
    );
    const downloadPromise = page.waitForEvent('download');
    await saveButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(BACKUP_FILENAME);
    const storageUrl = (await storageRequest).url();

    await expect(card.getByTestId('backup-download-status')).toHaveAttribute('data-state', 'done', {
      timeout: 15_000,
    });
    await expect(card.getByText(/The temporary copy was deleted/)).toBeVisible();

    // The status check alone would still say not_found if the blob survived, so fetch the old URL.
    const afterDelete = await page.request.get(storageUrl, { failOnStatusCode: false });
    expect(afterDelete.status()).toBe(404);

    const again = await client.mutation(api.machineBackups.createDownloadAccess, {
      sessionId,
      requestId: uploadCommand.requestId,
    });
    expect(again).toEqual({ ok: false, reason: 'not_found' });
  });
});
