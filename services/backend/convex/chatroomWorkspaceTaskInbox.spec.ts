import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '../src/domain/entities/chatroom-workspace-task-inbox';

let sequence = 0;

async function setup() {
  const sessionId = `workspace-task-inbox-${++sequence}` as SessionId;
  const machineId = `workspace-task-inbox-machine-${sequence}`;
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
  const taskId = await t.run(async (ctx) =>
    ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Assign this task',
      status: 'pending',
      assignedTo: 'planner',
      createdAt: 100,
      updatedAt: 100,
      queuePosition: 0,
    })
  );
  return { sessionId, machineId, chatroomId, taskId };
}

function taskPayload(chatroomId: Id<'chatroom_rooms'>, taskId: Id<'chatroom_tasks'>) {
  return {
    taskId,
    chatroomId,
    createdBy: 'user',
    content: 'Assign this task',
    status: 'pending',
    assignedTo: 'planner',
    createdAt: 100,
    updatedAt: 100,
    queuePosition: 0,
  };
}

describe('chatroomWorkspaceTaskInbox', () => {
  test('creates pending assignment events and marks them processed without retry state', async () => {
    const { sessionId, machineId, chatroomId, taskId } = await setup();
    const eventId = await t.run(async (ctx) =>
      ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskPayload(chatroomId, taskId),
        createdAt: Date.now(),
      })
    );

    const pending = await t.query(api.chatroomWorkspaceTaskInbox.listPending, {
      sessionId,
      machineId,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      eventType: WorkspaceTaskInboxEventType.TaskAssigned,
      status: WorkspaceTaskInboxEventStatus.Pending,
      task: taskPayload(chatroomId, taskId),
    });
    expect(pending[0]).not.toHaveProperty('attemptCount');

    await expect(
      t.mutation(api.chatroomWorkspaceTaskInbox.markProcessed, { sessionId, machineId, eventId })
    ).resolves.toEqual({ processed: true });
    await expect(
      t.mutation(api.chatroomWorkspaceTaskInbox.markProcessed, { sessionId, machineId, eventId })
    ).resolves.toEqual({ processed: false });
    await expect(
      t.query(api.chatroomWorkspaceTaskInbox.listPending, { sessionId, machineId })
    ).resolves.toEqual([]);
  });

  test('lists processed and pending events for one chatroom and machine, newest first', async () => {
    const { sessionId, machineId, chatroomId, taskId } = await setup();
    const otherChatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo-other',
      teamName: 'Other Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskPayload(chatroomId, taskId),
        createdAt: 100,
      });
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskUpdated,
        status: WorkspaceTaskInboxEventStatus.Processed,
        processedAt: 400,
        task: taskPayload(chatroomId, taskId),
        createdAt: 300,
      });
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId: `${machineId}-other`,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskPayload(chatroomId, taskId),
        createdAt: 200,
      });
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId: otherChatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskPayload(chatroomId, taskId),
        createdAt: 150,
      });
    });

    const events = await t.query(api.chatroomWorkspaceTaskInbox.listForChatroom, {
      sessionId,
      machineId,
      chatroomId,
    });

    expect(events.map((event) => event.createdAt)).toEqual([300, 100]);
    expect(events.map((event) => event.status)).toEqual([
      WorkspaceTaskInboxEventStatus.Processed,
      WorkspaceTaskInboxEventStatus.Pending,
    ]);

    const limited = await t.query(api.chatroomWorkspaceTaskInbox.listForChatroom, {
      sessionId,
      machineId,
      chatroomId,
      limit: 1,
    });
    expect(limited.map((event) => event.createdAt)).toEqual([300]);
  });
});
