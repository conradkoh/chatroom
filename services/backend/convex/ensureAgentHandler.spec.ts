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
    const commands = await ctx.db
      .query('chatroom_machineCommands')
      .filter((q) =>
        q.and(q.eq(q.field('type'), 'start-agent'), q.eq(q.field('payload.chatroomId'), chatroomId))
      )
      .collect();
    return commands.length;
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

  test('dispatches start-agent when desiredState is absent (backward compat)', async () => {
    const { sessionId } = await createTestSession('eah-3');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'eah-machine-3';

    await registerMachine(sessionId, machineId);
    // No desiredState — old row
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
    expect(startCount).toBe(1); // old rows default to restart behavior
  });
});
