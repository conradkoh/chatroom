/**
 * Handoff reminder double agent_end — integration tests
 *
 * Simulates: agent_end (signal handoff reminder) → handoff reminder injected →
 * second agent_end → handoff-to-user. Ensures only the worked task is completed
 * and queued follow-ups are promoted for agent delivery, not swallowed.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  joinParticipant,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { TEST_MODEL_CURSOR_SDK, TEST_MODEL_OPENCODE } from '../helpers/test-models';

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

describe('Handoff reminder double agent_end', () => {
  test('first agent_end signals reminder only; handoff-to-user completes and promotes queued task', async () => {
    const { sessionId } = await createTestSession('test-handoff-reminder-double-end');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupNativeBuilder(sessionId, chatroomId, 'machine-handoff-reminder-double');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'In-progress task before handoff reminder',
      createdBy: 'user',
    });
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder', taskId });
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });
    await t.mutation(api.tasks.readTask, { sessionId, chatroomId, role: 'builder', taskId });

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'Follow-up after handoff reminder',
        type: 'message',
        queuePosition: 1,
      });
    });

    const firstEnd = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    expect(firstEnd).toEqual({ needsHandoffReminder: true, transitionedToWaiting: false });

    const afterFirst = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(afterFirst?.status).toBe('in_progress');

    const secondEnd = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    expect(secondEnd.needsHandoffReminder).toBe(true);

    await t.run(async (ctx) => {
      const pending = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pending).toHaveLength(0);
    });

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Handoff after handoff reminder sequence.',
    });
    expect(handoff.success).toBe(true);
    expect(handoff.completedTaskIds).toContain(taskId);
    expect(handoff.completedTaskIds).not.toContain(handoff.promotedTaskId);
    expect(handoff.promotedTaskId).toBeTruthy();

    const promoted = await t.run(async (ctx) =>
      ctx.db.get('chatroom_tasks', handoff.promotedTaskId!)
    );
    expect(promoted?.status).toBe('pending');
    expect(promoted?.content).toBe('Follow-up after handoff reminder');
  });

  test('native handoff-to-user never force-completes pending without in_progress', async () => {
    const { sessionId } = await createTestSession('test-native-handoff-no-pending-complete');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupNativeBuilder(sessionId, chatroomId, 'machine-native-no-pending-complete');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Pending task never started',
      createdBy: 'user',
    });
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', taskId, {
        status: 'pending',
        assignedTo: 'builder',
        queuePosition: 1,
      });
    });

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Handoff without working on pending task.',
    });
    expect(handoff.success).toBe(true);
    expect(handoff.completedTaskIds).not.toContain(taskId);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('pending');
  });
});
