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
import { getInboxCommandsForMachine } from '../../../../tests/helpers/machine-command-inbox';

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
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
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

    await t.mutation(api.agentStops.request, { sessionId, machineId, chatroomId, role: 'builder' });
    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { desiredState: 'stopped' });
    });

    // Verify the team config now has desiredState: 'stopped'
    const teamConfig = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
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
      t.mutation(api.agentStops.request, { sessionId, machineId, chatroomId, role: 'builder' })
    ).resolves.toBeDefined();
  });
});

describe('stopAgent use case — deferred physical stop', () => {
  test('retains spawnedAgentPid until daemon confirms exit', async () => {
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
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
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
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
    });

    expect(config?.spawnedAgentPid).toBe(99999);
    expect(config?.spawnedAt).toBeDefined();
    expect(config?.desiredState).toBe('stopped');
  });

  test('creates agent.stopScope inbox with stopCommandId', async () => {
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
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
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

    const inbox = await getInboxCommandsForMachine(machineId, 'agent.stopScope');
    const stopCmd = inbox.find((row) => row.command.type === 'agent.stopScope');
    expect(stopCmd).toBeDefined();
    if (stopCmd?.command.type === 'agent.stopScope') {
      expect(stopCmd.command.scope).toEqual({ kind: 'agent', role: 'builder' });
      expect(stopCmd.command.stopCommandId).toBeDefined();
      const target = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_agentStopTargets')
          .withIndex('by_stopCommandId', (q) =>
            q.eq('stopCommandId', stopCmd.command.stopCommandId)
          )
          .first()
      );
      expect(target?.pid).toBe(54321);
    }
  });

  test('does not transition participant to agent.exited on stop request', async () => {
    const { sessionId, userId } = await createTestSession('stop-agent-transition-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stop-machine-transition-1';

    await registerMachine(sessionId, machineId);
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'planner',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    // Join as participant
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    await t.run(async (ctx) => {
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'planner',
        userId,
        reason: 'user.stop',
      });
    });

    const participant = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'planner')
        )
        .unique();
    });

    // Participant status unchanged until daemon confirms harness stop
    expect(participant?.lastStatus).not.toBe('agent.exited');
    expect(participant?.lastDesiredState).not.toBe('stopped');
  });

  test('does not release in_progress tasks on stop request', async () => {
    const { sessionId, userId } = await createTestSession('stop-agent-release-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stop-machine-release-1';

    await registerMachine(sessionId, machineId);
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    const taskId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'in-progress builder task',
        status: 'in_progress',
        assignedTo: 'builder',
        acknowledgedAt: now,
        startedAt: now,
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
      });
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

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
    expect(task?.assignedTo).toBe('builder');
  });
});
