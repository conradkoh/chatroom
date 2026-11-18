import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import { expectFooterPinned, WIZARD_VIEWPORTS } from '../../support/wizard-layout';
import {
  claimGitCloneCommand,
  openWorkspaceStep,
  readSessionId,
  seedConnectedMachine,
} from '../../support/wizard-seed';

/** One unbroken token, wide enough to exceed the step at 390 px. */
function longToken(prefix: string, length = 200): string {
  return `${prefix}${'x'.repeat(length)}`;
}

const LONG_REPO_URL = `https://github.com/example/${longToken('repo-')}.git`;
const LONG_CLONE_PATH = `/tmp/e2e-wizard/${longToken('clone-')}`;
const LONG_FOLDER_PATH = `/tmp/${longToken('folder-')}`;
const LONG_CLONE_ERROR = `${longToken('fatal-')}\nremotes/origin/main ${'error output '.repeat(20)}`;

const AGENTS_FOLDER = '/tmp/e2e-wizard-agents-layout';
/** Over the backend's 1024-character guard, so `createWithWorkspace` fails and sets `createError`. */
const OVERLONG_FOLDER_PATH = `/tmp/${'x'.repeat(1100)}`;

/**
 * The workspace step's top block (offline notice, create error, tabs) is unbounded and sits above
 * the tab panel, so these tests use content long enough to expose any squeeze.
 */
test.describe('New chatroom wizard steps layout', { tag: [TAG_DOWNSTREAM] }, () => {
  for (const viewport of WIZARD_VIEWPORTS) {
    const label = `${viewport.name} (${viewport.width}x${viewport.height})`;

    test(`clone tab keeps the footer pinned with a long repository URL at ${label}`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      await seedConnectedMachine(new ConvexHttpClient(getConvexUrl()), sessionId);
      await openWorkspaceStep(page);

      await page.getByRole('textbox', { name: 'Repository URL' }).fill(LONG_REPO_URL);
      await page.getByRole('textbox', { name: 'Clone to' }).fill(LONG_CLONE_PATH);

      await expectFooterPinned(page, viewport, 'clone idle (long URL)', [
        page.getByRole('button', { name: 'Clone' }),
        page.getByRole('button', { name: 'Back' }),
      ]);
    });

    test(`clone tab keeps the footer pinned after a failure with a long detail at ${label}`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      const client = new ConvexHttpClient(getConvexUrl());
      const machineId = await seedConnectedMachine(client, sessionId);
      await openWorkspaceStep(page);

      await page.getByRole('textbox', { name: 'Repository URL' }).fill(LONG_REPO_URL);
      await page.getByRole('textbox', { name: 'Clone to' }).fill(LONG_CLONE_PATH);
      await page.getByRole('button', { name: 'Clone' }).click();

      const command = await claimGitCloneCommand(client, sessionId, machineId);
      await client.mutation(api.gitCloneRequests.reportResult, {
        sessionId,
        machineId,
        requestId: command.requestId,
        status: 'failed',
        errorCode: 'auth',
        errorMessage: LONG_CLONE_ERROR,
      });

      await expect(
        page.getByText(/Authentication failed\. Check that this machine has access/)
      ).toBeVisible({ timeout: 15_000 });
      // Render the long `<pre>` detail, which is collapsed by default.
      await page.locator('[data-slot="setup-step-body"] summary').click();

      await expectFooterPinned(page, viewport, 'clone failed (long detail)', [
        page.getByRole('button', { name: 'Try again' }),
        page.getByRole('button', { name: 'Back' }),
      ]);
    });

    test(`existing-folder tab keeps the footer pinned with a long path at ${label}`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      await seedConnectedMachine(new ConvexHttpClient(getConvexUrl()), sessionId);
      await openWorkspaceStep(page);

      await page.getByRole('tab', { name: 'Existing folder' }).click();
      await page.getByLabel('Folder path').fill(LONG_FOLDER_PATH);

      await expectFooterPinned(page, viewport, 'existing folder (long path)', [
        page.getByRole('button', { name: 'Create chatroom' }),
        page.getByRole('button', { name: 'Back' }),
      ]);
    });

    test(`agents step keeps the footer pinned at ${label}`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      await seedConnectedMachine(new ConvexHttpClient(getConvexUrl()), sessionId);
      await openWorkspaceStep(page);

      await page.getByRole('tab', { name: 'Existing folder' }).click();
      await page.getByLabel('Folder path').fill(AGENTS_FOLDER);
      await page.getByRole('button', { name: 'Create chatroom' }).click();

      // The chatroom exists from here on; the team and agent rows load into the step body.
      const openChatroom = page.getByRole('button', { name: 'Open chatroom' });
      await expect(openChatroom).toBeVisible({ timeout: 30_000 });

      await expectFooterPinned(page, viewport, 'agents', [
        openChatroom,
        page.getByRole('button', { name: 'Start Agents' }),
      ]);
    });

    test(`workspace step keeps the footer pinned when creating fails at ${label}`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      await seedConnectedMachine(new ConvexHttpClient(getConvexUrl()), sessionId);
      await openWorkspaceStep(page);

      await page.getByRole('tab', { name: 'Existing folder' }).click();
      await page.getByLabel('Folder path').fill(OVERLONG_FOLDER_PATH);
      await page.getByRole('button', { name: 'Create chatroom' }).click();

      // The wizard stays on the step and shows the create error above the tabs.
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });

      await expectFooterPinned(page, viewport, 'workspace (create error)', [
        page.getByRole('button', { name: 'Create chatroom' }),
        page.getByRole('button', { name: 'Back' }),
      ]);
    });

    test(`workspace step keeps the footer pinned when the machine goes offline at ${label}`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const sessionId = await readSessionId(page);
      const client = new ConvexHttpClient(getConvexUrl());
      const machineId = await seedConnectedMachine(client, sessionId);
      await openWorkspaceStep(page);

      // A graceful daemon shutdown flips the connection state the workspace step reports.
      await client.mutation(api.machines.markDaemonOffline, { sessionId, machineId });
      await expect(page.getByText(/is offline/)).toBeVisible({ timeout: 15_000 });

      await expectFooterPinned(page, viewport, 'workspace (offline notice)', [
        page.getByRole('button', { name: 'Clone' }),
        page.getByRole('button', { name: 'Back' }),
      ]);
    });
  }
});
