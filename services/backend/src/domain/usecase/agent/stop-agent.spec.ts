/**
 * Tests for stop-agent use case — verifies that desiredState is set correctly.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { stopAgent } from './stop-agent';
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

describe('stopAgent use case — eager cleanup', () => {
  test('eagerly clears spawnedAgentPid and spawnedAt on team config', async () => {
    const { sessionId, userId } = await createTestSession('stop-agent-eager-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stop-machine-eager-1';

    await registerMachine(sessionId, machineId);
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    // Set a PID on the config to simulate a running agent
    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
      if (config) {
        await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
          spawnedAgentPid: 99999,
          spawnedAt: Date.now(),
        });
      }
    });

    // Call stopAgent directly
    await t.run(async (ctx) => {
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId,
        reason: 'user.stop',
      });
    });

    const config = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
    });

    expect(config?.spawnedAgentPid).toBeUndefined();
    expect(config?.spawnedAt).toBeUndefined();
    expect(config?.desiredState).toBe('stopped');
  });

  test('includes pid in the agent.requestStop event', async () => {
    const { sessionId, userId } = await createTestSession('stop-agent-pid-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stop-machine-pid-1';

    await registerMachine(sessionId, machineId);
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    // Set a PID on the config
    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
      if (config) {
        await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
          spawnedAgentPid: 54321,
          spawnedAt: Date.now(),
        });
      }
    });

    await t.run(async (ctx) => {
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId,
        reason: 'user.stop',
      });
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'agent.requestStop')
        )
        .collect();
    });

    const stopEvent = events.find(
      (e) => e.type === 'agent.requestStop' && e.role === 'builder'
    );
    expect(stopEvent).toBeDefined();
    if (stopEvent && stopEvent.type === 'agent.requestStop') {
      expect(stopEvent.pid).toBe(54321);
    }
  });

  test('transitions participant to agent.exited (not agent.requestStop)', async () => {
    const { sessionId, userId } = await createTestSession('stop-agent-transition-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stop-machine-transition-1';

    await registerMachine(sessionId, machineId);
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    // Join as participant
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await t.run(async (ctx) => {
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId,
        reason: 'user.stop',
      });
    });

    const participant = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });

    // Should be 'agent.exited' (not 'agent.requestStop') for immediate OFFLINE
    expect(participant?.lastStatus).toBe('agent.exited');
    expect(participant?.lastDesiredState).toBe('stopped');
  });
});
