/**
 * Native harness task completion race — integration tests
 *
 * Reproduces race where handoff Step 1 force-completes a freshly promoted
 * pending task that should be delivered to the agent after handoff.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { maybePromoteNextQueuedTask } from '../../src/domain/usecase/task/maybe-promote-next-queued-task';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  joinParticipant,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { TEST_MODEL_CURSOR_SDK, TEST_MODEL_OPENCODE } from '../helpers/test-models';

const NATIVE_MACHINE_ID_RACE = 'machine-native-harness-completion-race-1';
const NATIVE_MACHINE_ID_HAPPY = 'machine-native-harness-completion-race-2';

async function setupNativeBuilder(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string
) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['cursor-sdk', 'opencode'],
    availableModels: {
      'cursor-sdk': [TEST_MODEL_CURSOR_SDK],
      opencode: [TEST_MODEL_OPENCODE],
    },
  });
  await t.mutation(api.machines.updateDaemonStatus, {
    sessionId,
    machineId,
    connected: true,
  });
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', {
    agentHarness: 'cursor-sdk',
  });
}

async function createAcknowledgedTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'Native harness task completion race test task',
    createdBy: 'user',
  });

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role,
    taskId,
  });

  return taskId;
}

describe('Native harness task completion race', () => {
  test('handoff-to-user must not complete a freshly promoted pending task after agent_end recovery', async () => {
    const { sessionId } = await createTestSession('test-native-harness-completion-race');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupNativeBuilder(sessionId, chatroomId, NATIVE_MACHINE_ID_RACE);
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    const participantAfterInject = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });
    expect(participantAfterInject?.lastInFlightTaskId).toBe(taskId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'Queued follow-up before erroneous promotion',
        type: 'message',
        queuePosition: 1,
      });
    });

    const agentEndResult = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(agentEndResult).toEqual({
      needsHandoffReminder: true,
      transitionedToWaiting: false,
    });

    const originalTask = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(originalTask?.status).toBe('completed');

    await t.run(async (ctx) => {
      const pendingBeforeRace = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pendingBeforeRace).toHaveLength(0);
    });

    let promotedTaskId: Id<'chatroom_tasks'> | undefined;
    await t.run(async (ctx) => {
      const result = await maybePromoteNextQueuedTask(ctx, chatroomId, {
        entryPointRole: 'builder',
      });
      expect(result.promoted).toBeTruthy();
      promotedTaskId = result.promoted ?? undefined;
    });

    const pendingBeforeHandoff = await t.run(async (ctx) => {
      const pending = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.content).toBe('Queued follow-up before erroneous promotion');
      return pending[0]!;
    });
    expect(pendingBeforeHandoff._id).toBe(promotedTaskId);

    const handoffResult = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Handoff after erroneous queue promotion.',
    });
    expect(handoffResult.success).toBe(true);

    // Post-fix expectation: pending task survives handoff Step 1 for agent delivery.
    expect(handoffResult.completedTaskIds).not.toContain(promotedTaskId);

    const promotedAfterHandoff = await t.run(async (ctx) =>
      ctx.db.get('chatroom_tasks', promotedTaskId!)
    );
    expect(promotedAfterHandoff?.status).toBe('pending');
    expect(promotedAfterHandoff?.content).toBe('Queued follow-up before erroneous promotion');

    const participantAfterHandoff = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });
    expect(participantAfterHandoff?.lastInFlightTaskId).toBeUndefined();
  });

  test('agent_end recovery and handoff do not double-complete the same active task', async () => {
    const { sessionId } = await createTestSession('test-native-harness-no-double-complete');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupNativeBuilder(sessionId, chatroomId, NATIVE_MACHINE_ID_HAPPY);
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'Queued follow-up after agent_end handoff',
        type: 'message',
        queuePosition: 1,
      });
    });

    const agentEndResult = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(agentEndResult).toEqual({
      needsHandoffReminder: true,
      transitionedToWaiting: false,
    });

    const completedAfterAgentEnd = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(completedAfterAgentEnd?.status).toBe('completed');

    const handoffResult = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Handoff immediately after agent_end recovery.',
    });
    expect(handoffResult.success).toBe(true);
    // Task was already completed by handleNativeAgentEnd — handoff must not re-complete it.
    expect(handoffResult.completedTaskIds).not.toContain(taskId);
    expect(handoffResult.promotedTaskId).toBeTruthy();

    const originalTask = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(originalTask?.status).toBe('completed');

    const promotedTask = await t.run(async (ctx) => {
      const pending = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pending).toHaveLength(1);
      return pending[0]!;
    });
    expect(promotedTask._id).toBe(handoffResult.promotedTaskId);
    expect(promotedTask.content).toBe('Queued follow-up after agent_end handoff');
    expect(promotedTask.status).toBe('pending');

    const participantAfterHandoff = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });
    expect(participantAfterHandoff?.lastInFlightTaskId).toBeUndefined();
  });

  test('handleNativeAgentEnd with explicit taskId completes only that task', async () => {
    const { sessionId } = await createTestSession('test-native-explicit-task-id');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupNativeBuilder(sessionId, chatroomId, 'machine-native-explicit-task');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    const agentEndResult = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    expect(agentEndResult.needsHandoffReminder).toBe(true);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('completed');
  });
});
