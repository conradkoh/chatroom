/**
 * Tests for on-agent-exited — verifies restart logic based on stopReason.
 *
 * Uses the recordAgentExited mutation (which calls onAgentExited internally)
 * to test the full pipeline. After calling recordAgentExited, we verify
 * side effects via the event stream (agent.exited events are written).
 *
 * The restart scheduling (ctx.scheduler.runAfter) is not directly observable
 * in convex-test, so we test the decision logic by verifying that:
 * 1. The function completes without errors for all stop reasons
 * 2. The agent.exited event is written correctly
 *
 * The core restart condition logic is:
 * - user.stop → NO restart
 * - Any other stopReason → restart (guarded by desiredState)
 * - No stopReason → falls back to !intentional flag
 */

import { describe, expect, test } from 'vitest';

import type { SessionId } from 'convex-helpers/server/sessions';
import type { Id } from '../../../convex/_generated/dataModel';
import { t } from '../../../test.setup';
import { buildTeamRoleKey } from '../../../convex/utils/teamRoleKey';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const { api } = await import('../../../convex/_generated/api');
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const { api } = await import('../../../convex/_generated/api');
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function registerMachineAndConfig(
  sessionId: SessionId,
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  desiredState?: 'running' | 'stopped'
) {
  const { api } = await import('../../../convex/_generated/api');
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });

  // Create machine agent config (required for recordAgentExited to find config)
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('chatroom_machineAgentConfigs', {
      machineId,
      chatroomId,
      role: 'builder',
      agentType: 'opencode',
      workingDir: '/tmp/test',
      updatedAt: now,
      spawnedAgentPid: 1234,
      spawnedAt: now,
    });
  });

  // Create team agent config (for desiredState check)
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
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

async function seedPendingTask(
  chatroomId: Id<'chatroom_rooms'>
): Promise<Id<'chatroom_tasks'>> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'test task',
      status: 'pending',
      assignedTo: 'builder',
      queuePosition: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function callRecordAgentExited(
  sessionId: SessionId,
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  opts: {
    intentional: boolean;
    stopReason?: string;
  }
) {
  const { api } = await import('../../../convex/_generated/api');
  return await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 1234,
    intentional: opts.intentional,
    stopReason: opts.stopReason,
  });
}

async function countAgentExitedEvents(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroomId_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .collect();
    return events.filter((e) => e.type === 'agent.exited').length;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('onAgentExited via recordAgentExited — stopReason handling', () => {
  test('records agent.exited event for user.stop', async () => {
    const { sessionId } = await createTestSession('oae-1');
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, 'oae-m1', chatroomId, 'running');

    await callRecordAgentExited(sessionId, 'oae-m1', chatroomId, {
      intentional: true,
      stopReason: 'user.stop',
    });

    const exitEvents = await countAgentExitedEvents(chatroomId);
    expect(exitEvents).toBe(1); // Event recorded but no restart scheduled
  });

  test('records agent.exited event for agent_process.exited_clean', async () => {
    const { sessionId } = await createTestSession('oae-2');
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, 'oae-m2', chatroomId, 'running');
    await seedPendingTask(chatroomId);

    await callRecordAgentExited(sessionId, 'oae-m2', chatroomId, {
      intentional: false,
      stopReason: 'agent_process.exited_clean',
    });

    const exitEvents = await countAgentExitedEvents(chatroomId);
    expect(exitEvents).toBe(1); // Event recorded, restart scheduled (can't verify schedule in test)
  });

  test('records agent.exited event for agent_process.signal', async () => {
    // Key test: agent_end → SIGTERM flow produces this stopReason
    const { sessionId } = await createTestSession('oae-3');
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, 'oae-m3', chatroomId, 'running');
    await seedPendingTask(chatroomId);

    // This should NOT throw — agent_process.signal is now restartable
    await callRecordAgentExited(sessionId, 'oae-m3', chatroomId, {
      intentional: false,
      stopReason: 'agent_process.signal',
    });

    const exitEvents = await countAgentExitedEvents(chatroomId);
    expect(exitEvents).toBe(1);
  });

  test('records agent.exited event for agent_process.crashed', async () => {
    const { sessionId } = await createTestSession('oae-4');
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, 'oae-m4', chatroomId, 'running');
    await seedPendingTask(chatroomId);

    await callRecordAgentExited(sessionId, 'oae-m4', chatroomId, {
      intentional: false,
      stopReason: 'agent_process.crashed',
    });

    const exitEvents = await countAgentExitedEvents(chatroomId);
    expect(exitEvents).toBe(1);
  });

  test('completes without error when desiredState is stopped', async () => {
    const { sessionId } = await createTestSession('oae-5');
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, 'oae-m5', chatroomId, 'stopped');
    await seedPendingTask(chatroomId);

    // Should complete without error — desiredState guard prevents restart
    await callRecordAgentExited(sessionId, 'oae-m5', chatroomId, {
      intentional: false,
      stopReason: 'agent_process.signal',
    });

    const exitEvents = await countAgentExitedEvents(chatroomId);
    expect(exitEvents).toBe(1);
  });

  test('clears spawnedAgentPid after exit', async () => {
    const { sessionId } = await createTestSession('oae-6');
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, 'oae-m6', chatroomId, 'running');

    await callRecordAgentExited(sessionId, 'oae-m6', chatroomId, {
      intentional: true,
      stopReason: 'user.stop',
    });

    // Verify the PID was cleared in machine agent config
    const config = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_machine_chatroom_role', (q) =>
          q.eq('machineId', 'oae-m6').eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .first();
    });

    expect(config?.spawnedAgentPid).toBeUndefined();
    expect(config?.spawnedAt).toBeUndefined();
  });
});
