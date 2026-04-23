/**
 * Tests for recordCustomAgentRegistered — verifies the allowTypeChange invariant
 * that prevents silent un-binding of a remote machine config via custom
 * registration (which would otherwise launder around assertMachineBelongsToChatroom
 * on a subsequent remote re-registration).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
}

/**
 * Bind a role to a machine via the start-agent command path. This writes to
 * `chatroom_teamAgentConfigs` with `machineId` set, mirroring the production
 * flow. (`recordRemoteAgentRegistered` only emits an event and does not bind.)
 */
async function bindRoleToMachine(
  sessionId: SessionId,
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  await t.mutation(api.machines.sendCommand, {
    sessionId,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId,
      role,
      model: 'anthropic/claude-sonnet-4',
      agentHarness: 'opencode',
      workingDir: '/tmp/test',
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recordCustomAgentRegistered — allowTypeChange invariant', () => {
  test('fresh registration (no existing config) succeeds without allowTypeChange', async () => {
    const { sessionId } = await createTestSession('rcar-fresh');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.machines.recordCustomAgentRegistered, {
        sessionId,
        chatroomId,
        role: 'builder',
      })
    ).resolves.toEqual({ success: true });
  });

  test('custom -> custom re-registration succeeds without allowTypeChange', async () => {
    const { sessionId } = await createTestSession('rcar-custom-to-custom');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.machines.recordCustomAgentRegistered, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    await expect(
      t.mutation(api.machines.recordCustomAgentRegistered, {
        sessionId,
        chatroomId,
        role: 'builder',
      })
    ).resolves.toEqual({ success: true });
  });

  test('rejects when existing config is bound to a machine and allowTypeChange is omitted', async () => {
    const { sessionId } = await createTestSession('rcar-block-launder');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'rcar-bound-machine';

    await registerMachine(sessionId, machineId);
    await bindRoleToMachine(sessionId, machineId, chatroomId, 'builder');

    await expect(
      t.mutation(api.machines.recordCustomAgentRegistered, {
        sessionId,
        chatroomId,
        role: 'builder',
      })
    ).rejects.toThrow(/allowTypeChange: true/);
  });

  test('rejects when existing config is bound and allowTypeChange is false', async () => {
    const { sessionId } = await createTestSession('rcar-explicit-false');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'rcar-explicit-false-machine';

    await registerMachine(sessionId, machineId);
    await bindRoleToMachine(sessionId, machineId, chatroomId, 'builder');

    await expect(
      t.mutation(api.machines.recordCustomAgentRegistered, {
        sessionId,
        chatroomId,
        role: 'builder',
        allowTypeChange: false,
      })
    ).rejects.toThrow(/allowTypeChange: true/);
  });

  test('succeeds when existing config is bound and allowTypeChange is true (and clears machineId)', async () => {
    const { sessionId } = await createTestSession('rcar-explicit-true');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'rcar-explicit-true-machine';

    await registerMachine(sessionId, machineId);
    await bindRoleToMachine(sessionId, machineId, chatroomId, 'builder');

    await expect(
      t.mutation(api.machines.recordCustomAgentRegistered, {
        sessionId,
        chatroomId,
        role: 'builder',
        allowTypeChange: true,
      })
    ).resolves.toEqual({ success: true });

    // Verify the config has been switched to custom with machineId cleared.
    const config = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get(chatroomId);
      if (!chatroom?.teamId) throw new Error('chatroom missing teamId');
      const teamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, 'builder');
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
        .first();
    });
    expect(config?.type).toBe('custom');
    expect(config?.machineId).toBeUndefined();
  });

  test('deprecated shim recordAgentRegistered (custom) honors allowTypeChange', async () => {
    const { sessionId } = await createTestSession('rcar-shim');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'rcar-shim-machine';

    await registerMachine(sessionId, machineId);
    await bindRoleToMachine(sessionId, machineId, chatroomId, 'builder');

    // Without allowTypeChange — rejected.
    await expect(
      t.mutation(api.machines.recordAgentRegistered, {
        sessionId,
        chatroomId,
        role: 'builder',
        agentType: 'custom',
      })
    ).rejects.toThrow(/allowTypeChange: true/);

    // With allowTypeChange — succeeds.
    await expect(
      t.mutation(api.machines.recordAgentRegistered, {
        sessionId,
        chatroomId,
        role: 'builder',
        agentType: 'custom',
        allowTypeChange: true,
      })
    ).resolves.toEqual({ success: true });
  });
});
