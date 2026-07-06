/**
 * Native queued delivery after agent_end — integration test
 *
 * Proves handleNativeAgentEnd completes active work without promoting the queue,
 * then handoff-to-user promotes the queued message and projects a deliverable snapshot.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { NATIVE_TASK_INJECTED_ACTION } from '../../src/domain/entities/participant';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  joinParticipant,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { TEST_MODEL_CURSOR_SDK, TEST_MODEL_OPENCODE } from '../helpers/test-models';

async function syncMachineSnapshots(sessionId: string, machineId: string): Promise<void> {
  await t.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
    sessionId,
    machineId,
  });
}

async function registerMachineWithCursorSdk(sessionId: string, machineId: string): Promise<void> {
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
}

describe('Native queued delivery after agent_end', () => {
  test('completes task, promotes queue, and emits deliverable machine snapshot', async () => {
    const { sessionId } = await createTestSession('test-native-queued-delivery-agent-end');
    const machineId = 'machine-native-queued-delivery-1';
    await registerMachineWithCursorSdk(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', {
      agentHarness: 'cursor-sdk',
    });
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 42_424,
    });

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Active native task before agent_end',
      createdBy: 'user',
    });
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: NATIVE_TASK_INJECTED_ACTION,
      taskId,
    });
    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'Queued follow-up after agent_end',
        type: 'message',
        queuePosition: 1,
      });
    });

    const result = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result).toEqual({
      needsHandoffReminder: true,
      transitionedToWaiting: false,
    });

    const originalTask = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(originalTask?.status).toBe('completed');

    await t.run(async (ctx) => {
      const pendingBeforeHandoff = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pendingBeforeHandoff).toHaveLength(0);
    });

    const handoffResult = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Handoff after agent_end — promote queued message next.',
    });
    expect(handoffResult.success).toBe(true);
    expect(handoffResult.promotedTaskId).toBeTruthy();

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
    expect(promotedTask.content).toBe('Queued follow-up after agent_end');
    expect(promotedTask.assignedTo).toBe('builder');

    await syncMachineSnapshots(sessionId, machineId);
    const snapshots = await t.query(api.machines.listMachineAssignedTaskSnapshots, {
      sessionId,
      machineId,
    });

    expect(snapshots.tasks).toHaveLength(1);
    const snapshot = snapshots.tasks[0]!;
    expect(snapshot.taskId).toBe(promotedTask._id);
    expect(snapshot.status).toBe('pending');
    expect(snapshot.agentConfig.role).toBe('builder');
    expect(snapshot.agentConfig.agentHarness).toBe('cursor-sdk');
    expect(snapshot.agentConfig.spawnedAgentPid).toBe(42_424);
    expect(snapshot.participant?.lastSeenAction).toBe(NATIVE_TASK_INJECTED_ACTION);
    expect(snapshot.participant?.lastStatus).toBe('task.completed');
  });
});
