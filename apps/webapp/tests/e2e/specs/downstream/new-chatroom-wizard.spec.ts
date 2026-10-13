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

test.describe('New chatroom wizard, existing folder', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('creates a chatroom with its workspace from an existing folder', async ({
    authenticatedPage: page,
  }) => {
    const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
    expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
    const sessionId = rawSessionId as SessionId;
    const client = new ConvexHttpClient(getConvexUrl());

    // Seed a connected machine. The wizard only lists machines whose daemon is connected.
    const machineId = `e2e-wizard-${crypto.randomUUID()}`;
    await client.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'e2e-host',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });
    await client.mutation(api.machines.daemonHeartbeat, { sessionId, machineId });

    await page.goto('/app?create=true');
    await expect(page.getByRole('heading', { name: 'New Chatroom' })).toBeVisible({
      timeout: 15_000,
    });

    // The machine row is enabled once the heartbeat registers as connected.
    const machineRow = page.getByRole('button', { name: /e2e-host/ });
    await expect(machineRow).toBeEnabled({ timeout: 30_000 });
    await machineRow.click();
    await page.getByRole('button', { name: 'Continue' }).click();

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
});
