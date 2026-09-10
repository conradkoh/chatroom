/**
 * Tests for releaseTaskAfterTurnFailure — single-task recovery after a native turn failure.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { releaseTaskAfterTurnFailure } from './release-task-after-turn-failure';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'custom',
    teamName: 'Custom Three-Role Team',
    teamRoles: ['planner', 'builder', 'architect'],
    teamEntryPoint: 'builder',
  });
}

async function seedRemoteConfig(
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  machineId: string
): Promise<void> {
  await t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    if (!room?.teamId) throw new Error('chatroom missing teamId');
    const now = Date.now();
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: buildTeamRoleKey(chatroomId, room.teamId, role),
      chatroomId,
      role,
      type: 'remote',
      machineId,
      agentHarness: 'opencode-sdk',
      model: 'model',
      workingDir: '/tmp',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedTask(
  chatroomId: Id<'chatroom_rooms'>,
  opts: {
    status: 'pending' | 'acknowledged' | 'in_progress' | 'completed';
    assignedTo?: string | undefined;
  }
): Promise<Id<'chatroom_tasks'>> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'turn-failure task',
      status: opts.status,
      ...(opts.assignedTo !== undefined ? { assignedTo: opts.assignedTo } : {}),
      ...(opts.status !== 'pending' ? { acknowledgedAt: now } : {}),
      ...(opts.status === 'in_progress' || opts.status === 'completed' ? { startedAt: now } : {}),
      ...(opts.status === 'completed' ? { completedAt: now } : {}),
      queuePosition: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function getTask(taskId: Id<'chatroom_tasks'>) {
  return await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
}

async function listSignals(chatroomId: Id<'chatroom_rooms'>) {
  const timeline = await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_timelineTaskStatusSignals')
      .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  const delivery = (
    await t.run(async (ctx) => {
      return await ctx.db.query('chatroom_machineTaskDeliverySignals').collect();
    })
  ).filter((row) => row.chatroomId === chatroomId);
  return { timeline, delivery };
}

async function getSnapshot(taskId: Id<'chatroom_tasks'>) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_machineAssignedTaskSnapshots')
      .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
      .first();
  });
}

describe('releaseTaskAfterTurnFailure', () => {
  test('in_progress task transitions to pending with task_service source signals and snapshot update', async () => {
    const { sessionId } = await createTestSession('turn-failure-inprogress');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'turn-failure-machine-1';
    await seedRemoteConfig(chatroomId, 'builder', machineId);
    const taskId = await seedTask(chatroomId, { status: 'in_progress', assignedTo: 'builder' });
    // Project the initial snapshot for the in-flight task.
    await t.run(async (ctx) => {
      const { projectAssignedTaskSnapshotsForChatroom } =
        await import('../machine/machine-assigned-task-snapshot-sync');
      await projectAssignedTaskSnapshotsForChatroom(ctx, chatroomId);
    });

    const result = await t.run(async (ctx) => {
      return await releaseTaskAfterTurnFailure(ctx, { chatroomId, role: 'builder', taskId });
    });

    expect(result).toMatchObject({ released: true, status: 'pending' });

    const task = await getTask(taskId);
    expect(task?.status).toBe('pending');
    expect(task?.assignedTo).toBe('builder');
    expect(task?.acknowledgedAt).toBeUndefined();
    expect(task?.startedAt).toBeUndefined();

    const { timeline, delivery } = await listSignals(chatroomId);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      taskId,
      taskStatus: 'pending',
      source: 'task_service',
    });
    expect(delivery).toHaveLength(1);
    expect(delivery[0]).toMatchObject({
      taskId,
      taskStatus: 'pending',
      targetRole: 'builder',
      source: 'task_service',
    });

    const snapshot = await getSnapshot(taskId);
    expect(snapshot?.taskStatus).toBe('pending');
  });

  test('acknowledged task follows the same transition', async () => {
    const { sessionId } = await createTestSession('turn-failure-ack');
    const chatroomId = await createChatroom(sessionId);
    await seedRemoteConfig(chatroomId, 'builder', 'turn-failure-machine-ack');
    const taskId = await seedTask(chatroomId, { status: 'acknowledged', assignedTo: 'builder' });

    const result = await t.run(async (ctx) => {
      return await releaseTaskAfterTurnFailure(ctx, { chatroomId, role: 'builder', taskId });
    });

    expect(result).toMatchObject({ released: true, status: 'pending' });
    const task = await getTask(taskId);
    expect(task?.status).toBe('pending');
    expect(task?.assignedTo).toBe('builder');
    expect(task?.acknowledgedAt).toBeUndefined();
  });

  test('repeated invocation is idempotent and emits no second signal', async () => {
    const { sessionId } = await createTestSession('turn-failure-idempotent');
    const chatroomId = await createChatroom(sessionId);
    await seedRemoteConfig(chatroomId, 'builder', 'turn-failure-machine-idem');
    const taskId = await seedTask(chatroomId, { status: 'in_progress', assignedTo: 'builder' });

    const first = await t.run(async (ctx) => {
      return await releaseTaskAfterTurnFailure(ctx, { chatroomId, role: 'builder', taskId });
    });
    expect(first.released).toBe(true);

    const second = await t.run(async (ctx) => {
      return await releaseTaskAfterTurnFailure(ctx, { chatroomId, role: 'builder', taskId });
    });
    expect(second).toMatchObject({ released: false, status: 'pending' });

    const { timeline, delivery } = await listSignals(chatroomId);
    expect(timeline).toHaveLength(1);
    expect(delivery).toHaveLength(1);
  });

  test('completed task is a no-op returning current status', async () => {
    const { sessionId } = await createTestSession('turn-failure-completed');
    const chatroomId = await createChatroom(sessionId);
    const taskId = await seedTask(chatroomId, { status: 'completed', assignedTo: 'builder' });

    const result = await t.run(async (ctx) => {
      return await releaseTaskAfterTurnFailure(ctx, { chatroomId, role: 'builder', taskId });
    });

    expect(result).toMatchObject({ released: false, status: 'completed' });
    const { timeline } = await listSignals(chatroomId);
    expect(timeline).toHaveLength(0);
  });

  test('role mismatch and missing task reject', async () => {
    const { sessionId } = await createTestSession('turn-failure-mismatch');
    const chatroomId = await createChatroom(sessionId);
    const taskId = await seedTask(chatroomId, { status: 'in_progress', assignedTo: 'builder' });

    await expect(
      t.run(async (ctx) => {
        return await releaseTaskAfterTurnFailure(ctx, { chatroomId, role: 'planner', taskId });
      })
    ).rejects.toThrow(/assigned to/i);

    const missing = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'probe',
        status: 'pending',
        queuePosition: 99,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.delete('chatroom_tasks', missing);
    });
    await expect(
      t.run(async (ctx) => {
        return await releaseTaskAfterTurnFailure(ctx, {
          chatroomId,
          role: 'builder',
          taskId: missing,
        });
      })
    ).rejects.toThrow(/not found/i);
  });

  test('mutation delegates with chatroom access', async () => {
    const { sessionId } = await createTestSession('turn-failure-mutation');
    const chatroomId = await createChatroom(sessionId);
    await seedRemoteConfig(chatroomId, 'builder', 'turn-failure-machine-mut');
    const taskId = await seedTask(chatroomId, { status: 'in_progress', assignedTo: 'builder' });

    const result = await t.mutation(api.tasks.releaseTaskAfterTurnFailure, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    expect(result).toMatchObject({ released: true, status: 'pending' });
    const task = await getTask(taskId);
    expect(task?.status).toBe('pending');
  });
});
