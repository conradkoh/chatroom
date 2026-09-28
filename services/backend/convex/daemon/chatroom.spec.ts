import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '../../src/domain/entities/chatroom-workspace-task-inbox';
import { t } from '../../test.setup';
import { api } from '../_generated/api';

let sequence = 0;

async function setup() {
  const sessionId = `chatroom-debug-${++sequence}` as SessionId;
  const machineId = `chatroom-debug-machine-${sequence}`;
  await t.mutation(api.auth.loginAnon, { sessionId });
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  return { sessionId, machineId, chatroomId };
}

function insertTask(
  chatroomId: Awaited<ReturnType<typeof setup>>['chatroomId'],
  overrides: {
    status?: 'pending' | 'acknowledged' | 'in_progress' | 'completed';
    content?: string;
    queuePosition?: number;
  } = {}
) {
  return t.run(async (ctx) =>
    ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: overrides.content ?? 'Assign this task',
      status: overrides.status ?? 'pending',
      assignedTo: 'planner',
      createdAt: 100,
      updatedAt: 100,
      queuePosition: overrides.queuePosition ?? 0,
    })
  );
}

describe('daemon.chatroom.debug', () => {
  test('reports task status, notification state and receipts per model', async () => {
    const { sessionId, machineId, chatroomId } = await setup();
    const taskId = await insertTask(chatroomId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Processed,
        processedAt: 900,
        task: {
          taskId,
          chatroomId,
          createdBy: 'user',
          content: 'Assign this task',
          status: 'pending',
          assignedTo: 'planner',
          createdAt: 100,
          updatedAt: 100,
          queuePosition: 0,
        },
        createdAt: 500,
      });
      await ctx.db.insert('chatroom_taskDeliveryReceipts', {
        chatroomId,
        taskId,
        role: 'planner',
        deliveryKind: 'native_inject',
        deliveredAt: 700,
      });
    });

    const snapshot = await t.query(api.daemon.chatroom.debug, {
      sessionId,
      machineId,
      chatroomId,
    });
    const { models } = snapshot;

    expect(models.chatroom_tasks.activeCount).toBe(1);
    expect(models.chatroom_tasks.rows[0]).toMatchObject({
      _id: taskId,
      status: 'pending',
      assignedTo: 'planner',
    });
    expect(models.chatroom_tasks.rows[0]?.contentLength).toBe('Assign this task'.length);

    expect(models.chatroomWorkspaceTaskInbox.rows[0]).toMatchObject({
      machineId,
      taskId,
      status: WorkspaceTaskInboxEventStatus.Processed,
      processedAt: 900,
    });
    expect(models.chatroom_taskDeliveryReceipts.rows[0]).toMatchObject({
      taskId,
      deliveredAt: 700,
      deliveryKind: 'native_inject',
    });
    expect(models.chatroom_agentLastSentLaunchRequests).toBeDefined();
    expect('chatroom_agentDesiredConfigs' in models).toBe(false);
  });

  test('keeps every active task even when completions exceed the limit', async () => {
    const { sessionId, machineId, chatroomId } = await setup();
    const activeTaskId = await insertTask(chatroomId, { queuePosition: 5 });
    for (let index = 0; index < 3; index++) {
      await insertTask(chatroomId, { status: 'completed', queuePosition: 100 + index });
    }

    const snapshot = await t.query(api.daemon.chatroom.debug, {
      sessionId,
      machineId,
      chatroomId,
      limit: 1,
    });

    expect(snapshot.models.chatroom_tasks.activeCount).toBe(1);
    expect(snapshot.models.chatroom_tasks.rows).toHaveLength(2);
    expect(snapshot.models.chatroom_tasks.rows[0]?._id).toBe(activeTaskId);
    expect(snapshot.models.chatroom_tasks.rows[1]?.status).toBe('completed');
  });

  test('reports inbox events from other machines so routing is visible', async () => {
    const { sessionId, machineId, chatroomId } = await setup();
    const taskId = await insertTask(chatroomId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId: `${machineId}-other`,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: {
          taskId,
          chatroomId,
          createdBy: 'user',
          content: 'Assign this task',
          status: 'pending',
          assignedTo: 'planner',
          createdAt: 100,
          updatedAt: 100,
          queuePosition: 0,
        },
        createdAt: 500,
      });
    });

    const snapshot = await t.query(api.daemon.chatroom.debug, {
      sessionId,
      machineId,
      chatroomId,
    });

    expect(snapshot.models.chatroomWorkspaceTaskInbox.rows).toHaveLength(1);
    expect(snapshot.models.chatroomWorkspaceTaskInbox.rows[0]?.machineId).toBe(
      `${machineId}-other`
    );
  });

  test('rejects a machine that does not own the session', async () => {
    const { sessionId, chatroomId } = await setup();

    await expect(
      t.query(api.daemon.chatroom.debug, {
        sessionId,
        machineId: 'someone-elses-machine',
        chatroomId,
      })
    ).rejects.toThrow();
  });
});
