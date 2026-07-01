/**
 * Assigned task incremental queries — integration tests.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function syncMachineSnapshots(sessionId: string, machineId: string): Promise<void> {
  await t.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
    sessionId,
    machineId,
  });
}

describe('machines.listMachineAssignedTaskSnapshots', () => {
  test('returns active tasks without task content', async () => {
    const { sessionId } = await createTestSession('test-lite-tasks-1');
    const machineId = 'machine-lite-tasks-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const largeContent = `## Goal\n${'x'.repeat(8_000)}`;
    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: largeContent,
      createdBy: 'user',
    });

    await syncMachineSnapshots(sessionId, machineId);

    const result = await t.query(api.machines.listMachineAssignedTaskSnapshots, {
      sessionId,
      machineId,
    });

    expect(result.tasks).toHaveLength(1);
    const task = result.tasks[0]!;
    expect(task.agentConfig.role).toBe('builder');
    expect(task.status).toBe('pending');
    expect(task).not.toHaveProperty('taskContent');
    expect(JSON.stringify(result)).not.toContain(largeContent.slice(0, 100));
  });

  test('refreshes snapshot rows when agent config state changes', async () => {
    const { sessionId } = await createTestSession('test-lite-tasks-config-sync-1');
    const machineId = 'machine-lite-tasks-config-sync-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: '## Goal\nConfig sync',
      createdBy: 'user',
    });
    await syncMachineSnapshots(sessionId, machineId);

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 42_424,
    });

    const result = await t.query(api.machines.listMachineAssignedTaskSnapshots, {
      sessionId,
      machineId,
    });

    expect(result.tasks[0]?.agentConfig.spawnedAgentPid).toBe(42_424);
  });

  test('reflects desiredState=stopped in the snapshot after stop-agent', async () => {
    const { sessionId } = await createTestSession('test-lite-tasks-stop-sync-1');
    const machineId = 'machine-lite-tasks-stop-sync-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: '## Goal\nStop sync',
      createdBy: 'user',
    });
    await syncMachineSnapshots(sessionId, machineId);

    const running = await t.query(api.machines.listMachineAssignedTaskSnapshots, {
      sessionId,
      machineId,
    });
    expect(running.tasks[0]?.agentConfig.desiredState).toBe('running');

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'stop-agent',
      payload: { chatroomId, role: 'builder' },
    });

    const stopped = await t.query(api.machines.listMachineAssignedTaskSnapshots, {
      sessionId,
      machineId,
    });
    expect(stopped.tasks[0]?.agentConfig.desiredState).toBe('stopped');
    expect(stopped.tasks[0]?.agentConfig.spawnedAgentPid).toBeUndefined();
  });
});

describe('machines.subscribeAssignedTaskSignalsSince', () => {
  test('returns exclusive cursor pages without task content', async () => {
    const { sessionId } = await createTestSession('test-signals-1');
    const machineId = 'machine-signals-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const largeContent = `## Goal\n${'y'.repeat(8_000)}`;
    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: largeContent,
      createdBy: 'user',
    });

    await syncMachineSnapshots(sessionId, machineId);

    const first = await t.query(api.machines.subscribeAssignedTaskSignalsSince, {
      sessionId,
      machineId,
      limit: 10,
    });

    expect(first.items).toHaveLength(1);
    expect(first.highKey).toBeTruthy();
    expect(first.items[0]).toMatchObject({
      role: 'builder',
      status: 'pending',
    });
    expect(first.items[0]).not.toHaveProperty('taskContent');
    expect(JSON.stringify(first)).not.toContain(largeContent.slice(0, 100));

    const second = await t.query(api.machines.subscribeAssignedTaskSignalsSince, {
      sessionId,
      machineId,
      afterKey: first.highKey ?? undefined,
      limit: 10,
    });

    expect(second.items).toHaveLength(0);
  });

  test('emits a new signal when participant action changes', async () => {
    const { sessionId } = await createTestSession('test-signals-action-1');
    const machineId = 'machine-signals-action-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: '## Goal\nWork',
      createdBy: 'user',
    });
    await syncMachineSnapshots(sessionId, machineId);

    const baseline = await t.query(api.machines.subscribeAssignedTaskSignalsSince, {
      sessionId,
      machineId,
      limit: 10,
    });
    const cursor = baseline.highKey!;

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const afterAction = await t.query(api.machines.subscribeAssignedTaskSignalsSince, {
      sessionId,
      machineId,
      afterKey: cursor,
      limit: 10,
    });

    expect(afterAction.items.length).toBeGreaterThanOrEqual(1);
    expect(afterAction.items[0]?.lastSeenAction).toBe('get-next-task:started');
  });

  test('does not emit a new signal when only participant lastSeenAt changes', async () => {
    const { sessionId } = await createTestSession('test-signals-heartbeat-1');
    const machineId = 'machine-signals-heartbeat-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: '## Goal\nHeartbeat test',
      createdBy: 'user',
    });
    await syncMachineSnapshots(sessionId, machineId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const baseline = await t.query(api.machines.subscribeAssignedTaskSignalsSince, {
      sessionId,
      machineId,
      limit: 10,
    });
    const cursor = baseline.highKey!;

    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (!participant) throw new Error('participant not found');
      await ctx.db.patch('chatroom_participants', participant._id, {
        lastSeenAt: Date.now() + 60_000,
      });
    });

    await syncMachineSnapshots(sessionId, machineId);

    const afterHeartbeat = await t.query(api.machines.subscribeAssignedTaskSignalsSince, {
      sessionId,
      machineId,
      afterKey: cursor,
      limit: 10,
    });

    expect(afterHeartbeat.items).toHaveLength(0);
  });
});

describe('machines.subscribeAssignedTaskPresenceSince', () => {
  test('returns presence deltas when lastSeenAt advances', async () => {
    const { sessionId } = await createTestSession('test-presence-1');
    const machineId = 'machine-presence-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: '## Goal\nPresence',
      createdBy: 'user',
    });
    await syncMachineSnapshots(sessionId, machineId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const page = await t.query(api.machines.subscribeAssignedTaskPresenceSince, {
      sessionId,
      machineId,
      afterPresenceAt: 0,
      limit: 10,
    });

    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.items[0]?.lastSeenAt).toBeTruthy();
    expect(page.highPresenceKey).toBeTruthy();
  });

  test('paginates presence rows that share the same timestamp', async () => {
    const { sessionId } = await createTestSession('test-presence-same-timestamp-1');
    const machineId = 'machine-presence-same-timestamp-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        content: '## Goal\nPresence page 1',
        createdBy: 'user',
        status: 'pending',
        assignedTo: 'builder',
        createdAt: now,
        updatedAt: now,
        queuePosition: 1,
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        content: '## Goal\nPresence page 2',
        createdBy: 'user',
        status: 'pending',
        assignedTo: 'builder',
        createdAt: now,
        updatedAt: now,
        queuePosition: 2,
      });
    });
    await syncMachineSnapshots(sessionId, machineId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const first = await t.query(api.machines.subscribeAssignedTaskPresenceSince, {
      sessionId,
      machineId,
      afterPresenceAt: 0,
      limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.highPresenceKey).toBeTruthy();

    const second = await t.query(api.machines.subscribeAssignedTaskPresenceSince, {
      sessionId,
      machineId,
      afterPresenceKey: first.highPresenceKey ?? undefined,
      limit: 10,
    });

    expect(second.items.length).toBeGreaterThanOrEqual(1);
    expect(second.items[0]?.presenceUpdatedAt).toBe(first.items[0]?.presenceUpdatedAt);
  });
});

describe('machines.getAssignedTaskForAction', () => {
  test('returns full task content for a specific task and role', async () => {
    const { sessionId } = await createTestSession('test-action-task-1');
    const machineId = 'machine-action-task-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const content = '## Goal\nInject me\n// data:agent.session_augmentation=none';
    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content,
      createdBy: 'user',
    });
    await syncMachineSnapshots(sessionId, machineId);

    const result = await t.query(api.machines.getAssignedTaskForAction, {
      sessionId,
      machineId,
      taskId,
      role: 'builder',
    });

    expect(result).not.toBeNull();
    expect(result!.taskContent).toBe(content);
    expect(result!.agentConfig.role).toBe('builder');
  });
});
