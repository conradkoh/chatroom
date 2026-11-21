import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import type { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect } from '../fixtures/auth.fixture';

/** Bounded wait for the daemon-stand-in to claim a queued clone command. */
export const CLAIM_TIMEOUT_MS = 15_000;

/** Reads the session the anonymous login persisted. The backend calls are made as that user. */
export async function readSessionId(page: Page): Promise<SessionId> {
  const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
  expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
  return rawSessionId as SessionId;
}

export interface SeedConnectedMachineOptions {
  /** Hostname shown on the machine row. Defaults to the shared `e2e-host`. */
  hostname?: string;
  /** Prefix for the generated machineId, so parallel specs cannot collide. */
  idPrefix?: string;
}

/**
 * Registers a machine with a connected daemon. The wizard only lists machines whose daemon is
 * connected, so the heartbeat is what makes the row selectable.
 */
export async function seedConnectedMachine(
  client: ConvexHttpClient,
  sessionId: SessionId,
  { hostname = 'e2e-host', idPrefix = 'e2e-wizard' }: SeedConnectedMachineOptions = {}
): Promise<string> {
  const machineId = `${idPrefix}-${crypto.randomUUID()}`;
  await client.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname,
    os: 'linux',
    availableHarnesses: ['opencode-sdk'],
  });
  await client.mutation(api.machines.daemonHeartbeat, { sessionId, machineId });
  return machineId;
}

/**
 * Opens the wizard, picks a connected machine and moves to the workspace step. `hostname` selects
 * the row; when several seeds share a hostname prefix the first matching row is used.
 */
export async function openWorkspaceStep(page: Page, hostname = 'e2e-host'): Promise<void> {
  await page.goto('/app?create=true');
  await expect(page.getByRole('heading', { name: 'New Chatroom' })).toBeVisible({
    timeout: 15_000,
  });

  // The machine row is enabled once the heartbeat registers as connected.
  const machineRow = page.getByRole('button', { name: new RegExp(hostname) }).first();
  await expect(machineRow).toBeEnabled({ timeout: 30_000 });
  await machineRow.click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/**
 * Stands in for the machine's daemon. Polls the inbox until a `daemon.gitClone` command is
 * delivered and claims it. Any other command type is acknowledged so it cannot block the queue.
 */
export async function claimGitCloneCommand(
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
