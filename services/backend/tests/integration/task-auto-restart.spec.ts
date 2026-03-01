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

    // Snapshot event counts BEFORE the ensure-agent handler fires
    const plannerEventsBefore = await getCommandEvents(sessionId, plannerMachineId);
    const builderEventsBefore = await getCommandEvents(sessionId, builderMachineId);

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

    // Only the planner's machine should receive a agent.requestStart event from the handler
    const plannerEventsAfter = await getCommandEvents(sessionId, plannerMachineId);
    const builderEventsAfter = await getCommandEvents(sessionId, builderMachineId);

    const plannerNew = plannerEventsAfter.length - plannerEventsBefore.length;
    const builderNew = builderEventsAfter.length - builderEventsBefore.length;

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
    const plannerEventsBefore = await getCommandEvents(sessionId, plannerMachineId);
    const builderEventsBefore = await getCommandEvents(sessionId, builderMachineId);

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

    // Only builder's machine should receive an agent.requestStart event from the handler
    const plannerEventsAfter = await getCommandEvents(sessionId, plannerMachineId);
    const builderEventsAfter = await getCommandEvents(sessionId, builderMachineId);

    const plannerNew = plannerEventsAfter.length - plannerEventsBefore.length;
    const builderNew = builderEventsAfter.length - builderEventsBefore.length;

    expect(plannerNew).toBe(0);
    expect(builderNew).toBe(1);
  });

  test('check is skipped if task was updated since snapshot (idempotency guard)', async () => {
    const { sessionId } = await createTestSession('test-ar-handler-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-builder-ar-3';

    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Snapshot events before handler fires
    const eventsBefore = await getCommandEvents(sessionId, machineId);

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

    // Pass an old snapshotUpdatedAt (before the task's actual updatedAt)
    await t.mutation(internal.ensureAgentHandler.check, {
      taskId: task._id,
      chatroomId,
      snapshotUpdatedAt: task.updatedAt - 1, // older than current — should skip
    });

    const eventsAfter = await getCommandEvents(sessionId, machineId);
    // Should be 0 new events — handler skipped due to stale snapshot
    expect(eventsAfter.length - eventsBefore.length).toBe(0);
  });
});
