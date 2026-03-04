/**
 * Tests for ensureAgentHandler — verifies that desiredState is respected.
 *
 * These tests call the internal mutation directly via `t.mutation(internal.ensureAgentHandler.check, ...)`.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { t } from '../test.setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const { api } = await import('./_generated/api');
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const { api } = await import('./_generated/api');
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  const { api } = await import('./_generated/api');
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
}

async function seedTeamAgentConfig(
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  desiredState?: 'running' | 'stopped'
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: `chatroom_${chatroomId}#role_builder`,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      model: 'anthropic/claude-sonnet-4',
      workingDir: '/tmp/test',
      createdAt: now,
      updatedAt: now,
      desiredState,
    });
  });
}

async function seedPendingTask(chatroomId: Id<'chatroom_rooms'>) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'test task',
      status: 'pending',
      queuePosition: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function countStartCommands(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom_type', (q) =>
        q.eq('chatroomId', chatroomId).eq('type', 'agent.requestStart')
      )
      .collect();
    return events.length;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureAgentHandler — desiredState guard', () => {
  test('skips restart when desiredState is stopped', async () => {
    const { sessionId } = await createTestSession('eah-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'eah-machine-1';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId, 'stopped');

    const taskId = await seedPendingTask(chatroomId);
    const snapshot = Date.now() - 1; // stale snapshot — task hasn't been updated

    // Patch task updatedAt so it appears unchanged
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(0); // agent was stopped intentionally — no restart
  });

  test('dispatches start-agent when desiredState is running', async () => {
    const { sessionId } = await createTestSession('eah-2');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'eah-machine-2';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId, 'running');

    const snapshot = Date.now() - 1;
    const taskId = await seedPendingTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(1); // agent should be restarted
  });

  test('skips restart when desiredState is absent (treated as stopped)', async () => {
    const { sessionId } = await createTestSession('eah-3');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'eah-machine-3';

    await registerMachine(sessionId, machineId);
    // No desiredState — treated as 'stopped', so restart is skipped
    await seedTeamAgentConfig(chatroomId, machineId, undefined);

    const snapshot = Date.now() - 1;
    const taskId = await seedPendingTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(0); // undefined desiredState is now treated as 'stopped'
  });
});

// ---------------------------------------------------------------------------
// Circuit Breaker Tests
// ---------------------------------------------------------------------------

describe('ensureAgentHandler — circuit breaker', () => {
  test('OPEN + recent circuitOpenedAt → blocks restart', async () => {
    const { sessionId } = await createTestSession('cb-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'cb-machine-1';

    await registerMachine(sessionId, machineId);

    // Create config with circuit OPEN and recent circuitOpenedAt (within 60s cooldown)
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `chatroom_${chatroomId}#role_builder`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
        circuitState: 'open',
        circuitOpenedAt: now - 10_000, // 10s ago, within 60s cooldown
      });
    });

    const snapshot = Date.now() - 1;
    const taskId = await seedPendingTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(0); // circuit is open — restart blocked
  });

  test('OPEN + expired circuitOpenedAt → allows restart (moves to half-open)', async () => {
    const { sessionId } = await createTestSession('cb-2');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'cb-machine-2';

    await registerMachine(sessionId, machineId);

    // Create config with circuit OPEN and expired circuitOpenedAt (past 60s cooldown)
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `chatroom_${chatroomId}#role_builder`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
        circuitState: 'open',
        circuitOpenedAt: now - 90_000, // 90s ago, past 60s cooldown
      });
    });

    const snapshot = Date.now() - 1;
    const taskId = await seedPendingTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(1); // cooldown expired — restart allowed (half-open)
  });

  test('HALF-OPEN → allows restart', async () => {
    const { sessionId } = await createTestSession('cb-3');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'cb-machine-3';

    await registerMachine(sessionId, machineId);

    // Create config with circuit HALF-OPEN
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `chatroom_${chatroomId}#role_builder`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
        circuitState: 'half-open',
      });
    });

    const snapshot = Date.now() - 1;
    const taskId = await seedPendingTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(1); // half-open allows one attempt
  });

  test('CLOSED with 0 exits in window → allows restart', async () => {
    const { sessionId } = await createTestSession('cb-4');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'cb-machine-4';

    await registerMachine(sessionId, machineId);

    // Create config with no circuit state (defaults to CLOSED)
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `chatroom_${chatroomId}#role_builder`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
        circuitState: undefined, // CLOSED by default
      });
    });

    // No agent.exited events seeded — 0 exits in window

    const snapshot = Date.now() - 1;
    const taskId = await seedPendingTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(1); // no exits — restart allowed
  });

  test('CLOSED with ≥3 exits in window → trips circuit, blocks restart', async () => {
    const { sessionId } = await createTestSession('cb-5');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'cb-machine-5';

    await registerMachine(sessionId, machineId);

    // Create config with no circuit state (defaults to CLOSED)
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `chatroom_${chatroomId}#role_builder`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
        circuitState: undefined, // CLOSED by default
      });

      // Seed 3 agent.exited events within the last 5 minutes
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert('chatroom_eventStream', {
          type: 'agent.exited',
          chatroomId,
          role: 'builder',
          machineId,
          pid: 12345 + i,
          intentional: false,
          stopReason: 'user-interrupt',
          timestamp: now - (i * 60_000), // 0, 1, 2 minutes ago
        });
      }
    });

    const snapshot = Date.now() - 1;
    const taskId = await seedPendingTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { updatedAt: snapshot });
    });

    await t.mutation(internal.ensureAgentHandler.check, {
      taskId,
      chatroomId,
      snapshotUpdatedAt: snapshot,
    });

    const startCount = await countStartCommands(chatroomId);
    expect(startCount).toBe(0); // circuit trips to open — restart blocked

    // Verify circuit was tripped
    const config = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .first();
    });

    expect(config?.circuitState).toBe('open');
    expect(config?.circuitOpenedAt).toBeDefined();
  });

  test('participants.join resets half-open circuit to closed', async () => {
    const { sessionId } = await createTestSession('cb-6');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'cb-machine-6';

    await registerMachine(sessionId, machineId);

    // Create config with circuit HALF-OPEN
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `chatroom_${chatroomId}#role_builder`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
        circuitState: 'half-open',
        circuitOpenedAt: now - 90_000,
      });
    });

    // Call participants.join (simulates agent calling get-next-task)
    const { api } = await import('./_generated/api');
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    // Verify circuit was reset to CLOSED
    const config = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .first();
    });

    expect(config?.circuitState).toBe('closed');
    expect(config?.circuitOpenedAt).toBeUndefined();
  });
});
