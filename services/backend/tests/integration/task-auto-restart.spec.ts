/**
 * Task Auto-Restart Integration Tests
 *
 * Tests for the ensure-agent restart behavior:
 *
 * 1. User message tasks are pre-assigned to the entry point at creation.
 *    (Fix A — messages.ts: assignedTo = teamEntryPoint instead of undefined)
 *
 * 2. ensureAgentHandler.check only restarts the agent assigned to the task —
 *    not all remote agents.
 *    (Fix B — ensureAgentHandler.ts: rolesToRestart filter)
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  getCommandEvents,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createDuoTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function createPairTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

// ─── Fix A: Pre-assignment at task creation ──────────────────────────────────

describe('Fix A: User message tasks pre-assigned to entry point', () => {
  test('user message task is assigned to teamEntryPoint at creation', async () => {
    const { sessionId } = await createTestSession('test-ar-preassign-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Please help me with a task',
      senderRole: 'user',
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });

    expect(tasks.length).toBe(1);
    // Pre-assigned to entry point (planner), NOT undefined
    expect(tasks[0]?.assignedTo).toBe('planner');
  });

  test('user message task is assigned to first role when no teamEntryPoint', async () => {
    const { sessionId } = await createTestSession('test-ar-preassign-2');
    // Create chatroom without explicit entry point
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      // teamEntryPoint intentionally omitted — should fall back to first role
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Hello',
      senderRole: 'user',
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });

    expect(tasks.length).toBe(1);
    // Falls back to first role
    expect(tasks[0]?.assignedTo).toBe('planner');
  });

  test('handoff message task remains assigned to the target role (unchanged)', async () => {
    const { sessionId } = await createTestSession('test-ar-preassign-3');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Implement feature X',
      senderRole: 'planner',
      targetRole: 'builder',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });

    expect(tasks.length).toBe(1);
    expect(tasks[0]?.assignedTo).toBe('builder');
  });
});

// ─── Fix B: ensureAgentHandler only restarts the assigned role ───────────────

describe('Fix B: ensureAgentHandler only restarts the agent assigned to the task', () => {
  test('only entry-point agent gets a start-agent command when user message task is stale', async () => {
    const { sessionId } = await createTestSession('test-ar-handler-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    // Register two machines — one for planner (entry point), one for builder
    const plannerMachineId = 'machine-planner-ar-1';
    const builderMachineId = 'machine-builder-ar-1';

    await registerMachineWithDaemon(sessionId, plannerMachineId);
    await registerMachineWithDaemon(sessionId, builderMachineId);

    // Both agents configured as remote, desiredState=running
    await setupRemoteAgentConfig(sessionId, chatroomId, plannerMachineId, 'planner');
    await setupRemoteAgentConfig(sessionId, chatroomId, builderMachineId, 'builder');

    // Snapshot event counts BEFORE the ensure-agent handler fires.
    // setupRemoteAgentConfig calls startAgent which now emits agent.requestStart events,
    // so we take a baseline before calling ensureAgentHandler.check.
    const plannerEventsBefore = (await getCommandEvents(sessionId, plannerMachineId)).length;
    const builderEventsBefore = (await getCommandEvents(sessionId, builderMachineId)).length;

    // User sends a message — task is pre-assigned to planner (entry point)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Please help',
      senderRole: 'user',
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });
    expect(tasks.length).toBe(1);
    const task = tasks[0]!;
    expect(task.assignedTo).toBe('planner');

    // Simulate ensure-agent check firing for this task (120s timeout)
    await t.mutation(internal.ensureAgentHandler.check, {
      taskId: task._id,
      chatroomId,
      snapshotUpdatedAt: task.updatedAt,
    });

    // Count NEW events emitted by ensureAgentHandler (delta from baseline)
    const plannerEventsAfter = (await getCommandEvents(sessionId, plannerMachineId)).length;
    const builderEventsAfter = (await getCommandEvents(sessionId, builderMachineId)).length;

    const plannerNew = plannerEventsAfter - plannerEventsBefore;
    const builderNew = builderEventsAfter - builderEventsBefore;

    // Only the planner's machine should receive a new agent.requestStart event
    expect(plannerNew).toBe(1);
    expect(builderNew).toBe(0);
  });

  test('only the assigned role agent is restarted when a handoff task is stale', async () => {
    const { sessionId } = await createTestSession('test-ar-handler-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const plannerMachineId = 'machine-planner-ar-2';
    const builderMachineId = 'machine-builder-ar-2';

    await registerMachineWithDaemon(sessionId, plannerMachineId);
    await registerMachineWithDaemon(sessionId, builderMachineId);

    await setupRemoteAgentConfig(sessionId, chatroomId, plannerMachineId, 'planner');
    await setupRemoteAgentConfig(sessionId, chatroomId, builderMachineId, 'builder');

    // Snapshot event counts BEFORE the handler fires
    const plannerEventsBefore = (await getCommandEvents(sessionId, plannerMachineId)).length;
    const builderEventsBefore = (await getCommandEvents(sessionId, builderMachineId)).length;

    // Planner sends handoff to builder
    await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Implement this',
      senderRole: 'planner',
      targetRole: 'builder',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });
    expect(tasks.length).toBe(1);
    const task = tasks[0]!;
    expect(task.assignedTo).toBe('builder');

    // Simulate ensure-agent check
    await t.mutation(internal.ensureAgentHandler.check, {
      taskId: task._id,
      chatroomId,
      snapshotUpdatedAt: task.updatedAt,
    });

    // Count NEW events emitted by ensureAgentHandler (delta from baseline)
    const plannerEventsAfter = (await getCommandEvents(sessionId, plannerMachineId)).length;
    const builderEventsAfter = (await getCommandEvents(sessionId, builderMachineId)).length;

    const plannerNew = plannerEventsAfter - plannerEventsBefore;
    const builderNew = builderEventsAfter - builderEventsBefore;

    // Only builder's machine should receive a new agent.requestStart event
    expect(plannerNew).toBe(0);
    expect(builderNew).toBe(1);
  });

  test('check is skipped if task was updated since snapshot (idempotency guard)', async () => {
    const { sessionId } = await createTestSession('test-ar-handler-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-builder-ar-3';

    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Snapshot event count BEFORE the handler is called
    const eventsBefore = (await getCommandEvents(sessionId, machineId)).length;

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Hello',
      senderRole: 'user',
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });
    const task = tasks[0]!;

    // Pass an old snapshotUpdatedAt (before the task's actual updatedAt) — handler should skip
    await t.mutation(internal.ensureAgentHandler.check, {
      taskId: task._id,
      chatroomId,
      snapshotUpdatedAt: task.updatedAt - 1, // older than current — should skip
    });

    const eventsAfter = (await getCommandEvents(sessionId, machineId)).length;
    // No new events should have been emitted (handler skipped)
    expect(eventsAfter - eventsBefore).toBe(0);
  });
});

// ─── Handoff target role validation ──────────────────────────────────────────

describe('Handoff target role validation', () => {
  test('handoff to non-existent role returns INVALID_TARGET_ROLE error', async () => {
    const { sessionId } = await createTestSession('test-invalid-target-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Handing off to reviewer',
      senderRole: 'planner',
      targetRole: 'reviewer',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('INVALID_TARGET_ROLE');
    expect(result.error?.message).toContain('Cannot hand off to "reviewer"');
    expect(result.error?.message).toContain('not part of the current team');
    expect(result.error?.suggestedTargets).toEqual(['user', 'planner', 'builder']);
  });

  test('handoff to valid team role succeeds', async () => {
    const { sessionId } = await createTestSession('test-valid-target-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Implement this feature',
      senderRole: 'planner',
      targetRole: 'builder',
    });

    expect(result.success).toBe(true);
  });

  test('handoff to user is always valid (even in duo team)', async () => {
    const { sessionId } = await createTestSession('test-user-target-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Done with the task',
      senderRole: 'planner',
      targetRole: 'user',
    });

    expect(result.success).toBe(true);
  });
});
