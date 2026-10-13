import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { test as authenticatedTest, expect } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

const test = authenticatedTest.extend({
  // The shared fixture's dashboard heading is stale; keep its authenticatedPage contract while
  // checking the current dashboard heading, as agent-sidebar.spec.ts does.
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /continue anonymously/i }).click();
    await page.waitForURL('**/app');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    // Playwright fixture `use` is not a React hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

const FOLDER = '/tmp/e2e-wizard-existing';
const CHATROOM_NAME = 'e2e-wizard-existing';
const CLONE_URL = 'https://github.com/example/hello-world.git';
const CLONE_PATH = '/tmp/e2e-wizard/hello-world';
const CLAIM_TIMEOUT_MS = 15_000;

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
  const machineId = `e2e-wizard-${crypto.randomUUID()}`;
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

/** Opens the wizard, picks the connected machine and moves to the workspace step. */
async function openWorkspaceStep(page: Page): Promise<void> {
  await page.goto('/app?create=true');
  await expect(page.getByRole('heading', { name: 'New Chatroom' })).toBeVisible({
    timeout: 15_000,
  });

  // The machine row is enabled once the heartbeat registers as connected.
  const machineRow = page.getByRole('button', { name: /e2e-host/ });
  await expect(machineRow).toBeEnabled({ timeout: 30_000 });
  await machineRow.click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/**
 * Stands in for the machine's daemon. Polls the inbox until a `daemon.gitClone` command is
 * delivered and claims it. Any other command type is acknowledged so it cannot block the queue.
 */
async function claimGitCloneCommand(
  client: ConvexHttpClient,
  sessionId: SessionId,
  machineId: string
) {
  const deadline = Date.now() + CLAIM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const claimed = await client.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId,
      machineId,
    });
    if (claimed?.type === 'daemon.gitClone') return claimed;
    if (claimed) {
      await client.mutation(api.daemon.machineCommandInbox.acknowledge, {
        sessionId,
        commandId: claimed.commandId,
      });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No daemon.gitClone command reached machine ${machineId} within ${CLAIM_TIMEOUT_MS} ms`
  );
}

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
