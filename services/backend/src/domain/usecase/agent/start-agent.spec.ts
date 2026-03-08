/**
 * Tests for start-agent use case — verifies that desiredState is set correctly.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

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

async function startAgent(
  sessionId: SessionId,
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  return await t.mutation(api.machines.sendCommand, {
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

describe('startAgent use case — desiredState', () => {
  test('sets desiredState: running on team config after starting an agent', async () => {
    const { sessionId } = await createTestSession('start-agent-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-1';

    await registerMachine(sessionId, machineId);
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    const teamConfig = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first();
    });

    expect(teamConfig?.desiredState).toBe('running');
  });

  test('resets desiredState from stopped to running when agent is started', async () => {
    const { sessionId } = await createTestSession('start-agent-2');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-2';

    await registerMachine(sessionId, machineId);

    // Register a team config with desiredState: 'stopped'
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    // Mark it as stopped
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'stop-agent',
      payload: { chatroomId, role: 'builder' },
    });

    // Verify it's stopped
    const stopped = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first();
    });
    expect(stopped?.desiredState).toBe('stopped');

    // Now start it again
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    // Verify desiredState is now 'running'
    const running = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first();
    });
    expect(running?.desiredState).toBe('running');
  });

  test('resets circuit breaker state when manually starting an agent', async () => {
    const { sessionId } = await createTestSession('start-agent-3');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-3';

    await registerMachine(sessionId, machineId);

    // Seed a team config with circuit breaker OPEN
    await t.run(async (ctx) => {
      const now = Date.now();
      const teamRoleKey = buildTeamRoleKey(chatroomId, 'pair', 'builder');
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'stopped',
        circuitState: 'open', // Circuit tripped
        circuitOpenedAt: now - 30_000, // 30s ago
      });
    });

    // Manually start the agent (should reset circuit)
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    // Verify circuit breaker was reset
    const config = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first();
    });

    expect(config?.circuitState).toBe('closed');
    expect(config?.circuitOpenedAt).toBeUndefined();
    expect(config?.desiredState).toBe('running');
  });
});
