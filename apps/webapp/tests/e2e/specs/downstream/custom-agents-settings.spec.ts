import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { computeCustomAgentContentHash } from '@workspace/shared/domain/custom-agent';
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

const WORKING_DIR = '/tmp/e2e-custom-agents';
const AGENT_NAME = 'e2e-reviewer';
const CLAIM_TIMEOUT_MS = 20_000;
/** How long to wait for the setup modal before deciding it is not shown. */
const SETUP_MODAL_WAIT_MS = 3_000;

async function readSessionId(page: Page): Promise<SessionId> {
  const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
  expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
  return rawSessionId as SessionId;
}

async function seedConnectedMachine(
  client: ConvexHttpClient,
  sessionId: SessionId
): Promise<string> {
  const machineId = `e2e-custom-agents-${crypto.randomUUID()}`;
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

interface AgentSeed {
  disabled: boolean;
  sourceHash: string;
}

function agentPayload(seed: AgentSeed) {
  const content = {
    name: AGENT_NAME,
    description: 'Reviews release notes before publishing.',
    systemPrompt: 'You are the release reviewer.',
  };
  return {
    ...content,
    contentHash: computeCustomAgentContentHash(content),
    disabled: seed.disabled,
  };
}

/** One source push, exactly as the daemon would send it. */
async function pushAgentSource(
  client: ConvexHttpClient,
  args: {
    sessionId: SessionId;
    machineId: string;
    seed: AgentSeed;
  }
): Promise<void> {
  await client.mutation(api.customAgents.syncDefinitions, {
    sessionId: args.sessionId,
    machineId: args.machineId,
    scope: 'workspace',
    workingDir: WORKING_DIR,
    contentHash: args.seed.sourceHash,
    agents: [agentPayload(args.seed)],
    issues: [{ path: 'broken/AGENT.md', reason: 'name-mismatch' }],
  });
}

async function seedChatroom(
  client: ConvexHttpClient,
  sessionId: SessionId,
  machineId: string
): Promise<{ chatroomId: Id<'chatroom_rooms'>; workspaceId: Id<'chatroom_workspaces'> }> {
  const chatroomId = await client.mutation(api.chatrooms.create, {
    sessionId,
    teamStructureId: 'duo@1',
  });
  const workspaceId = await client.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: WORKING_DIR,
    hostname: 'e2e-host',
    registeredBy: 'e2e',
  });
  await client.mutation(api.workspaces.setPrimaryWorkspaceForChatroom, {
    sessionId,
    chatroomId,
    workspaceId,
  });
  return { chatroomId, workspaceId };
}

/**
 * Closes the setup modal when it opens. It is not always shown: setup mode ends
 * once every role has joined, and when a workspace is already registered the
 * modal opens on the "Agent Team" step rather than "Setup Workspace", so the
 * heading is not a reliable anchor either.
 */
async function dismissSetupModal(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  const appeared = await dialog
    .waitFor({ state: 'visible', timeout: SETUP_MODAL_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
}

async function openCustomAgentsTab(page: Page, chatroomId: string): Promise<void> {
  await page.goto(`/app/chatroom?id=${chatroomId}`);
  await dismissSetupModal(page);
  await page.getByRole('button', { name: /Open menu$/ }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Custom Agents' }).first().click();
}

/**
 * Stands in for the machine's daemon: waits for `daemon.customAgentsSetDisabled`,
 * acknowledges it, and pushes the new snapshot. Other command types are
 * acknowledged so they cannot block the queue.
 */
async function applyDisableCommand(
  client: ConvexHttpClient,
  args: { sessionId: SessionId; machineId: string }
): Promise<void> {
  const deadline = Date.now() + CLAIM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const claimed = await client.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId: args.sessionId,
      machineId: args.machineId,
    });
    if (claimed === null) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    await client.mutation(api.daemon.machineCommandInbox.acknowledge, {
      sessionId: args.sessionId,
      commandId: claimed.commandId,
    });
    if (claimed.type !== 'daemon.customAgentsSetDisabled') continue;

    expect(claimed.name).toBe(AGENT_NAME);
    expect(claimed.disabled).toBe(true);
    await pushAgentSource(client, {
      sessionId: args.sessionId,
      machineId: args.machineId,
      seed: { disabled: true, sourceHash: 'e2e-source-after-disable' },
    });
    return;
  }
  throw new Error(
    `No daemon.customAgentsSetDisabled command arrived within ${CLAIM_TIMEOUT_MS} ms`
  );
}

test.describe('Custom agents settings tab', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('toggles an agent through the daemon loop and shows the Off chip', async ({
    authenticatedPage: page,
  }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const machineId = await seedConnectedMachine(client, sessionId);
    const { chatroomId } = await seedChatroom(client, sessionId, machineId);
    await pushAgentSource(client, {
      sessionId,
      machineId,
      seed: { disabled: false, sourceHash: 'e2e-source-initial' },
    });

    await openCustomAgentsTab(page, chatroomId);

    const row = page.getByTestId(`custom-agent-row-${AGENT_NAME}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Name does not match the folder')).toBeVisible();

    await page.getByTestId(`custom-agent-switch-${AGENT_NAME}`).click();
    await expect(row.getByText('Turning off…')).toBeVisible();

    await applyDisableCommand(client, { sessionId, machineId });

    await expect(row.getByText('Off', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Turning off…')).toHaveCount(0);
  });
});
