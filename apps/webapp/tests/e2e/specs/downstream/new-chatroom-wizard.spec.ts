import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';
import {
  claimGitCloneCommand,
  openWorkspaceStep,
  readSessionId,
  seedConnectedMachine,
} from '../../support/wizard-seed';

const FOLDER = '/tmp/e2e-wizard-existing';
const CHATROOM_NAME = 'e2e-wizard-existing';
const CLONE_URL = 'https://github.com/example/hello-world.git';
const CLONE_PATH = '/tmp/e2e-wizard/hello-world';

test.describe('New chatroom wizard', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('creates a chatroom with its workspace from an existing folder', async ({
    authenticatedPage: page,
  }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    await seedConnectedMachine(client, sessionId);
    await openWorkspaceStep(page);
    // The workspace step opens on the clone tab. This test covers the existing-folder path.
    await page.getByRole('tab', { name: 'Existing folder' }).click();

    await page.getByLabel('Folder path').fill(FOLDER);
    await page.getByRole('button', { name: 'Create chatroom' }).click();

    // The agents step shows the chosen path. The chatroom exists from this point on.
    await expect(page.getByText(FOLDER).first()).toBeVisible({ timeout: 15_000 });

    // Backend checks: the room, its workspace and the primary workspace all exist.
    const rooms = await client.query(api.chatrooms.listByUser, { sessionId });
    const room = rooms.find((candidate) => candidate.name === CHATROOM_NAME);
    expect(room, 'a chatroom named after the folder should exist').toBeDefined();
    const chatroomId = room!._id;

    const workspaces = await client.query(api.workspaces.listWorkspacesForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(workspaces.map((workspace) => workspace.workingDir)).toContain(FOLDER);

    const primary = await client.query(api.workspaces.getPrimaryWorkspaceForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(primary, 'the new chatroom should have a primary workspace').not.toBeNull();

    await page.getByRole('button', { name: 'Open chatroom' }).click();
    await page.waitForURL('**/app/chatroom**', { timeout: 15_000 });
  });

  test('clones a repository through the daemon and continues with the cloned path', async ({
    authenticatedPage: page,
  }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const machineId = await seedConnectedMachine(client, sessionId);
    await openWorkspaceStep(page);

    await page.getByRole('textbox', { name: 'Repository URL' }).fill(CLONE_URL);
    await page.getByRole('textbox', { name: 'Clone to' }).fill(CLONE_PATH);
    await page.getByRole('button', { name: 'Clone' }).click();

    const command = await claimGitCloneCommand(client, sessionId, machineId);
    expect(command.repoUrl).toBe(CLONE_URL);
    expect(command.targetPath).toBe(CLONE_PATH);

    await client.mutation(api.gitCloneRequests.reportProgress, {
      sessionId,
      machineId,
      requestId: command.requestId,
      phase: 'Receiving objects',
      percent: 42,
    });
    await expect(page.getByText('42%')).toBeVisible({ timeout: 15_000 });

    await client.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId: command.requestId,
      status: 'completed',
      clonedPath: CLONE_PATH,
    });

    // The wizard creates the chatroom from the cloned folder and moves to the agents step.
    await expect(page.getByText(CLONE_PATH).first()).toBeVisible({ timeout: 15_000 });
  });

  test('shows the auth failure with a retry and keeps the repository URL', async ({
    authenticatedPage: page,
  }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const machineId = await seedConnectedMachine(client, sessionId);
    await openWorkspaceStep(page);

    await page.getByRole('textbox', { name: 'Repository URL' }).fill(CLONE_URL);
    await page.getByRole('textbox', { name: 'Clone to' }).fill(CLONE_PATH);
    await page.getByRole('button', { name: 'Clone' }).click();

    const command = await claimGitCloneCommand(client, sessionId, machineId);
    await client.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId: command.requestId,
      status: 'failed',
      errorCode: 'auth',
      errorMessage: 'fatal: Authentication failed',
    });

    // The shared copy continues with "(SSH key or credential helper)"; match its stable prefix.
    await expect(
      page.getByText(/Authentication failed\. Check that this machine has access/)
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Repository URL' })).toHaveValue(CLONE_URL);
  });
});
