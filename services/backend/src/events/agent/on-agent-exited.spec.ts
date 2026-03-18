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
 * - agent_process.turn_end / agent_process.turn_end_quick_fail → NO restart
 * - Any other stopReason → restart (guarded by desiredState)
 * - No stopReason → restart (safe default fallback for legacy events)
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
  desiredState?: 'running' | 'stopped',
  agentHarness?: string
) {
  const { api } = await import('../../../convex/_generated/api');
  const harness = agentHarness ?? 'opencode';
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: [harness],
  });

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: harness,
      model: 'anthropic/claude-sonnet-4',
      workingDir: '/tmp/test',
      createdAt: now,
      updatedAt: now,
      desiredState,
      spawnedAgentPid: 1234,
      spawnedAt: now,
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
    stopReason?: string;
    agentHarness?: string;
  }
) {
  const { api } = await import('../../../convex/_generated/api');
  return await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 1234,
    stopReason: opts.stopReason,
    agentHarness: opts.agentHarness,
  });
}

async function countAgentRequestStartEvents(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroomId_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .collect();
    return events.filter((e) => e.type === 'agent.requestStart').length;
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
      stopReason: 'user.stop',
    });

    const config = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .filter((q) => q.eq(q.field('machineId'), 'oae-m6'))
        .first();
    });

    expect(config?.spawnedAgentPid).toBeUndefined();
    expect(config?.spawnedAt).toBeUndefined();
  });
});

describe('onAgentExited — Pi harness crash recovery suppression', () => {
  test('Pi harness does NOT generate agent.requestStart even when shouldRestart=true', async () => {
    const { sessionId } = await createTestSession('oae-pi-1');
    const chatroomId = await createChatroom(sessionId);
    // Register with pi harness and desiredState=running (would normally trigger crash recovery)
    await registerMachineAndConfig(sessionId, 'oae-pi-m1', chatroomId, 'running', 'pi');

    // Use a stopReason that would normally trigger crash recovery (shouldRestart=true)
    await callRecordAgentExited(sessionId, 'oae-pi-m1', chatroomId, {
      stopReason: 'agent_process.crashed',
      agentHarness: 'pi',
    });

    // Verify agent.exited event was recorded (cleanup still happens)
    const exitEvents = await countAgentExitedEvents(chatroomId);
    expect(exitEvents).toBe(1);

    // The key assertion: NO agent.requestStart event — task monitor owns restarts for Pi
    const requestStartEvents = await countAgentRequestStartEvents(chatroomId);
    expect(requestStartEvents).toBe(0);
  });

  test('OpenCode harness DOES generate agent.requestStart on crash', async () => {
    const { sessionId } = await createTestSession('oae-pi-2');
    const chatroomId = await createChatroom(sessionId);
    // Register with opencode harness and desiredState=running
    await registerMachineAndConfig(sessionId, 'oae-pi-m2', chatroomId, 'running', 'opencode');

    await callRecordAgentExited(sessionId, 'oae-pi-m2', chatroomId, {
      stopReason: 'agent_process.crashed',
      agentHarness: 'opencode',
    });

    // OpenCode harness should generate crash recovery
    const requestStartEvents = await countAgentRequestStartEvents(chatroomId);
    expect(requestStartEvents).toBe(1);
  });

  test('Pi harness with user.stop still skips crash recovery (shouldRestart=false path)', async () => {
    const { sessionId } = await createTestSession('oae-pi-3');
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, 'oae-pi-m3', chatroomId, 'running', 'pi');

    await callRecordAgentExited(sessionId, 'oae-pi-m3', chatroomId, {
      stopReason: 'user.stop',
      agentHarness: 'pi',
    });

    const requestStartEvents = await countAgentRequestStartEvents(chatroomId);
    expect(requestStartEvents).toBe(0);
  });
});

describe('onAgentExited — participant persistence', () => {
  async function setupAndExit(sessionPrefix: string) {
    const { api } = await import('../../../convex/_generated/api');
    const { sessionId } = await createTestSession(`${sessionPrefix}`);
    const chatroomId = await createChatroom(sessionId);
    await registerMachineAndConfig(sessionId, `${sessionPrefix}-m`, chatroomId, 'running');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await callRecordAgentExited(sessionId, `${sessionPrefix}-m`, chatroomId, {
      stopReason: 'agent_process.crashed',
    });

    const participant = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });

    return { participant };
  }

  test('participant record persists with lastSeenAction "exited" after recordAgentExited', async () => {
    const { participant } = await setupAndExit('oae-pp-1');
    expect(participant).not.toBeNull();
    expect(participant!.lastSeenAction).toBe('exited');
  });

  test('participant connectionId is cleared after recordAgentExited', async () => {
    const { participant } = await setupAndExit('oae-pp-2');
    expect(participant!.connectionId).toBeUndefined();
  });

  test('participant lastSeenAt is preserved after recordAgentExited', async () => {
    const { participant } = await setupAndExit('oae-pp-3');
    expect(participant!.lastSeenAt).toBeTypeOf('number');
  });
});
