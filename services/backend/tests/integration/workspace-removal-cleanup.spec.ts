/**
 * Workspace Removal Cleanup — Integration Tests
 *
 * Verifies that when a workspace is removed from a chatroom, related
 * `chatroom_teamAgentConfigs` entries are purged to prevent "ghost machines".
 *
 * Three cases:
 * 1. Removing the only workspace purges configs for that machine+chatroom
 * 2. Removing one workspace does NOT purge configs if the machine has another active workspace
 * 3. Removing a workspace does NOT affect configs for other machines
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Register a workspace in a chatroom for a machine.
 * Returns the workspaceId.
 */
async function registerWorkspace(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId: sessionId as any,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

/**
 * Query all teamAgentConfigs for a chatroom.
 */
async function getTeamAgentConfigs(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('workspace removal cleanup', () => {
  test('removing the only workspace purges teamAgentConfigs for that machine+chatroom', async () => {
    const sessionId = 'test-wrc-1';
    const { sessionId: sid } = await createTestSession(sessionId);
    const chatroomId = await createPairTeamChatroom(sid);
    const machineId = 'machine-wrc-1';
    await registerMachineWithDaemon(sid, machineId);

    // Register a workspace
    const workspaceId = await registerWorkspace(sid, chatroomId, machineId, '/test/workspace');

    // Create a teamAgentConfig for this machine+chatroom
    await setupRemoteAgentConfig(sid, chatroomId, machineId, 'builder');

    // Verify config exists before removal
    const configsBefore = await getTeamAgentConfigs(chatroomId);
    const machineConfigsBefore = configsBefore.filter((c) => c.machineId === machineId);
    expect(machineConfigsBefore.length).toBeGreaterThan(0);

    // Remove the workspace
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId: sid,
      workspaceId,
    });

    // Config should be purged
    const configsAfter = await getTeamAgentConfigs(chatroomId);
    const machineConfigsAfter = configsAfter.filter((c) => c.machineId === machineId);
    expect(machineConfigsAfter.length).toBe(0);
  });

  test('removing one workspace does NOT purge configs when the machine has another active workspace', async () => {
    const sessionId = 'test-wrc-2';
    const { sessionId: sid } = await createTestSession(sessionId);
    const chatroomId = await createPairTeamChatroom(sid);
    const machineId = 'machine-wrc-2';
    await registerMachineWithDaemon(sid, machineId);

    // Register TWO workspaces for the same machine in the same chatroom
    const workspaceId1 = await registerWorkspace(sid, chatroomId, machineId, '/test/workspace-a');
    await registerWorkspace(sid, chatroomId, machineId, '/test/workspace-b');

    // Create a teamAgentConfig for this machine+chatroom
    await setupRemoteAgentConfig(sid, chatroomId, machineId, 'builder');

    // Verify config exists before removal
    const configsBefore = await getTeamAgentConfigs(chatroomId);
    const machineConfigsBefore = configsBefore.filter((c) => c.machineId === machineId);
    expect(machineConfigsBefore.length).toBeGreaterThan(0);

    // Remove only ONE workspace — the other remains active
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId: sid,
      workspaceId: workspaceId1,
    });

    // Config should still exist (other workspace is active)
    const configsAfter = await getTeamAgentConfigs(chatroomId);
    const machineConfigsAfter = configsAfter.filter((c) => c.machineId === machineId);
    expect(machineConfigsAfter.length).toBeGreaterThan(0);
  });

  test('removing a workspace does NOT affect configs for other machines in the same chatroom', async () => {
    const sessionId = 'test-wrc-3';
    const { sessionId: sid } = await createTestSession(sessionId);
    const chatroomId = await createPairTeamChatroom(sid);

    const machineIdA = 'machine-wrc-3a';
    const machineIdB = 'machine-wrc-3b';
    await registerMachineWithDaemon(sid, machineIdA);
    await registerMachineWithDaemon(sid, machineIdB);

    // Register a workspace for each machine
    const workspaceIdA = await registerWorkspace(sid, chatroomId, machineIdA, '/workspace-a');
    await registerWorkspace(sid, chatroomId, machineIdB, '/workspace-b');

    // Create configs for both machines
    await setupRemoteAgentConfig(sid, chatroomId, machineIdA, 'builder');
    await setupRemoteAgentConfig(sid, chatroomId, machineIdB, 'reviewer');

    // Verify configs for both machines exist
    const configsBefore = await getTeamAgentConfigs(chatroomId);
    expect(configsBefore.filter((c) => c.machineId === machineIdA).length).toBeGreaterThan(0);
    expect(configsBefore.filter((c) => c.machineId === machineIdB).length).toBeGreaterThan(0);

    // Remove machine A's workspace
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId: sid,
      workspaceId: workspaceIdA,
    });

    // Machine A's config should be purged, machine B's config should be untouched
    const configsAfter = await getTeamAgentConfigs(chatroomId);
    expect(configsAfter.filter((c) => c.machineId === machineIdA).length).toBe(0);
    expect(configsAfter.filter((c) => c.machineId === machineIdB).length).toBeGreaterThan(0);
  });
});
