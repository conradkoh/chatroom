/**
 * Tests for writeTaskStatusSignals — sole production entry point for
 * task-status projection writes (timeline + daemon delivery).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { writeTaskStatusSignals } from './write-task-status-signals';
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
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
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
      agentHarness: 'opencode',
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
  opts?: { assignedTo?: string | undefined; status?: 'pending' | undefined }
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'signal task',
      status: opts?.status ?? 'pending',
      ...(opts?.assignedTo !== undefined ? { assignedTo: opts.assignedTo } : {}),
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
    return (await ctx.db.get('chatroom_tasks', taskId))!;
  });
}

describe('writeTaskStatusSignals', () => {
  test('remote-routed task creates one timeline row and one delivery row with equal cursor/timestamp', async () => {
    const { sessionId } = await createTestSession('task-signals-routed');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'task-signals-machine-1';
    await seedRemoteConfig(chatroomId, 'planner', machineId);

    const task = await seedTask(chatroomId, { assignedTo: 'planner' });
    await t.run(async (ctx) => {
      const row = (await ctx.db.get('chatroom_tasks', task._id))!;
      await writeTaskStatusSignals(ctx, row);
    });

    const timeline = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_timelineTaskStatusSignals')
        .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const delivery = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_machineTaskDeliverySignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomId)
        )
        .collect();
    });

    expect(timeline).toHaveLength(1);
    expect(delivery).toHaveLength(1);
    expect(delivery[0].signalKey).toBe(timeline[0].signalKey);
    expect(delivery[0].taskUpdatedAt).toBe(timeline[0].taskUpdatedAt);
    expect(delivery[0]).toMatchObject({
      machineId,
      chatroomId,
      taskId: task._id,
      targetRole: 'planner',
      taskStatus: 'pending',
    });
    // Slim contract: no task content or row metadata.
    expect(delivery[0]).not.toHaveProperty('content');
    // Exact retained-table evidence: one timeline row and one delivery row.
    expect(timeline[0]).toMatchObject({
      chatroomId,
      taskId: task._id,
      taskStatus: 'pending',
    });
  });

  test('reassignment routes the new signal to the current machine/role only', async () => {
    const { sessionId } = await createTestSession('task-signals-reassign');
    const chatroomId = await createChatroom(sessionId);
    const oldMachineId = 'task-signals-machine-old';
    const newMachineId = 'task-signals-machine-new';
    await seedRemoteConfig(chatroomId, 'planner', oldMachineId);
    await seedRemoteConfig(chatroomId, 'builder', newMachineId);

    const task = await seedTask(chatroomId, { assignedTo: 'planner' });
    await t.run(async (ctx) => {
      const row = (await ctx.db.get('chatroom_tasks', task._id))!;
      await writeTaskStatusSignals(ctx, row);
    });

    // Reassign to builder with a strictly later timestamp, then project again.
    await t.run(async (ctx) => {
      const row = (await ctx.db.get('chatroom_tasks', task._id))!;
      await ctx.db.patch('chatroom_tasks', task._id, {
        assignedTo: 'builder',
        updatedAt: row.updatedAt + 1,
      });
      const reassigned = (await ctx.db.get('chatroom_tasks', task._id))!;
      await writeTaskStatusSignals(ctx, reassigned);
    });

    const timeline = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_timelineTaskStatusSignals')
        .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const oldDelivery = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_machineTaskDeliverySignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', oldMachineId).eq('chatroomId', chatroomId)
        )
        .collect();
    });
    const newDelivery = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_machineTaskDeliverySignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', newMachineId).eq('chatroomId', chatroomId)
        )
        .collect();
    });

    expect(timeline).toHaveLength(2);
    expect(oldDelivery).toHaveLength(1);
    expect(newDelivery).toHaveLength(1);
    expect(oldDelivery[0]).toMatchObject({
      chatroomId,
      taskId: task._id,
      targetRole: 'planner',
      taskStatus: 'pending',
    });
    expect(newDelivery[0]).toMatchObject({
      chatroomId,
      taskId: task._id,
      targetRole: 'builder',
      taskStatus: 'pending',
    });

    // Each transition's timeline/delivery pair shares cursor and timestamp.
    const [first, second] = [...timeline].sort((a, b) => (a.signalKey < b.signalKey ? -1 : 1));
    expect(oldDelivery[0].signalKey).toBe(first.signalKey);
    expect(oldDelivery[0].taskUpdatedAt).toBe(first.taskUpdatedAt);
    expect(newDelivery[0].signalKey).toBe(second.signalKey);
    expect(newDelivery[0].taskUpdatedAt).toBe(second.taskUpdatedAt);

    // The reassignment key is strictly ordered after the original transition.
    expect(second.signalKey > first.signalKey).toBe(true);
    expect(second.taskUpdatedAt).toBeGreaterThan(first.taskUpdatedAt);
    // Append-only history keeps the old row, but no new signal went to the old route.
    expect(oldDelivery[0].signalKey).not.toBe(newDelivery[0].signalKey);
  });

  test('local/user/no-machine task creates a timeline row and no daemon row', async () => {
    const { sessionId } = await createTestSession('task-signals-local');
    const chatroomId = await createChatroom(sessionId);

    // No remote config seeded: unassigned resolves to the entry point but has
    // no machine route; assignedTo=user is explicitly local.
    const unassigned = await seedTask(chatroomId);
    await t.run(async (ctx) => {
      const row = (await ctx.db.get('chatroom_tasks', unassigned._id))!;
      await writeTaskStatusSignals(ctx, row);
    });
    const userTask = await seedTask(chatroomId, { assignedTo: 'user' });
    await t.run(async (ctx) => {
      const row = (await ctx.db.get('chatroom_tasks', userTask._id))!;
      await writeTaskStatusSignals(ctx, row);
    });

    const timeline = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_timelineTaskStatusSignals')
        .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // Scoped per chatroom: the shared test DB retains rows from other tests.
    const delivery = (
      await t.run(async (ctx) => {
        return await ctx.db.query('chatroom_machineTaskDeliverySignals').collect();
      })
    ).filter((row) => row.chatroomId === chatroomId);

    expect(timeline).toHaveLength(2);
    expect(delivery).toHaveLength(0);
  });

  test('a failed transaction leaves neither projection row', async () => {
    const { sessionId } = await createTestSession('task-signals-rollback');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'task-signals-machine-rollback';
    await seedRemoteConfig(chatroomId, 'planner', machineId);

    const task = await seedTask(chatroomId, { assignedTo: 'planner' });

    await expect(
      t.run(async (ctx) => {
        const row = (await ctx.db.get('chatroom_tasks', task._id))!;
        await writeTaskStatusSignals(ctx, row);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const timeline = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_timelineTaskStatusSignals')
        .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // Scoped per chatroom: the shared test DB retains rows from other tests.
    const delivery = (
      await t.run(async (ctx) => {
        return await ctx.db.query('chatroom_machineTaskDeliverySignals').collect();
      })
    ).filter((row) => row.chatroomId === chatroomId);
    expect(timeline).toHaveLength(0);
    expect(delivery).toHaveLength(0);
  });
});
