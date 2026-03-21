/**
 * Tests for stop-agent use case — verifies that desiredState is set correctly.
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
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stopAgent use case — desiredState', () => {
  test('sets desiredState: stopped on team config when it exists', async () => {
    const { sessionId } = await createTestSession('stop-agent-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stop-machine-1';

    await registerMachine(sessionId, machineId);

    // Register a remote team config
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    // Dispatch a stop-agent command via sendCommand
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'stop-agent',
      payload: { chatroomId, role: 'builder' },
    });

    // Verify the team config now has desiredState: 'stopped'
    const teamConfig = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
    });

    expect(teamConfig?.desiredState).toBe('stopped');
  });

  test('does not throw when no team config exists for the role', async () => {
    const { sessionId } = await createTestSession('stop-agent-2');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stop-machine-2';

    await registerMachine(sessionId, machineId);

    // Stop without any team config in the DB — must not throw
    await expect(
      t.mutation(api.machines.sendCommand, {
        sessionId,
        machineId,
        type: 'stop-agent',
        payload: { chatroomId, role: 'builder' },
      })
    ).resolves.not.toThrow();
  });
});
