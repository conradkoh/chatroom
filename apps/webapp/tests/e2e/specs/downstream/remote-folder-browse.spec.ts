import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import { openWorkspaceStep, readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

const HOME = '/home/e2e';
const PROJECT = '/home/e2e/alpha';
const POLL_TIMEOUT_MS = 15_000;

/** Polls the daemon-side pending subscription until a browse request for `path` appears. */
async function claimPendingBrowse(
  client: ConvexHttpClient,
  sessionId: SessionId,
  machineId: string,
  path: string | null
) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pending = await client.query(api.folderBrowse.daemonPending, { sessionId, machineId });
    const match = pending.find((row) => row.path === path);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No pending folder browse for ${String(path)} within ${POLL_TIMEOUT_MS} ms`);
}

function listing(path: string, parentPath: string, entries: { name: string }[]) {
  return {
    kind: 'listing' as const,
    path,
    parentPath,
    entries,
    dirCount: entries.length,
    fileCount: 0,
    hiddenCount: 0,
    complete: true,
  };
}

test.describe('Remote folder browse', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('browses the daemon filesystem inline and selects a folder', async ({
    authenticatedPage: page,
  }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const machineId = await seedConnectedMachine(client, sessionId);
    await openWorkspaceStep(page);
    await page.getByRole('tab', { name: 'Existing folder' }).click();

    const panel = page.locator('[data-slot="remote-folder-browser"]');
    const browse = page.getByRole('button', { name: 'Browse' });

    // Browse opens the panel immediately; no native dialog and no pickFolder command.
    await browse.click();
    await expect(browse).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();

    // The test stands in for the daemon: answer the first (home) request.
    const opened = await claimPendingBrowse(client, sessionId, machineId, null);
    expect(
      await client.mutation(api.folderBrowse.reportListing, {
        sessionId,
        machineId,
        browseId: opened.browseId,
        navSeq: opened.navSeq,
        result: listing(HOME, '/home', [{ name: 'alpha' }, { name: 'beta' }]),
      })
    ).toEqual({ outcome: 'applied' });

    await expect(panel.getByRole('button', { name: 'alpha' })).toBeVisible();

    // Navigate into a folder; the previous list stays while the request is pending.
    await panel.getByRole('button', { name: 'alpha' }).click();
    const navigated = await claimPendingBrowse(client, sessionId, machineId, PROJECT);
    expect(navigated.navSeq).toBe(opened.navSeq + 1);
    expect(
      await client.mutation(api.folderBrowse.reportListing, {
        sessionId,
        machineId,
        browseId: navigated.browseId,
        navSeq: navigated.navSeq,
        result: listing(PROJECT, HOME, [{ name: 'nested' }]),
      })
    ).toEqual({ outcome: 'applied' });

    // Select the current folder; the input holds it and the session is gone.
    await expect(panel.getByRole('button', { name: 'Select' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Select' }).click();
    await expect(page.getByLabel('Folder path')).toHaveValue(PROJECT);
    await expect(panel).toHaveCount(0);
    await expect
      .poll(() => client.query(api.folderBrowse.get, { sessionId, browseId: opened.browseId }), {
        timeout: POLL_TIMEOUT_MS,
      })
      .toBeNull();

    // No native picker was requested: drain the inbox and assert no pickFolder command was queued.
    const claimedTypes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claimed = await client.mutation(api.daemon.machineCommandInbox.claimNext, {
        sessionId,
        machineId,
      });
      if (!claimed) break;
      claimedTypes.push(claimed.type);
      await client.mutation(api.daemon.machineCommandInbox.acknowledge, {
        sessionId,
        commandId: claimed.commandId,
      });
    }
    expect(claimedTypes).not.toContain('daemon.pickFolder');
  });
});
