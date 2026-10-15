import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  WorkspaceTaskAssigneeType,
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

/** Legacy pre-slim task snapshot: the shape written before the header-only writer. */
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

/** Slim header-only task, as the current writer produces. */
function taskHeader(chatroomId: Id<'chatroom_rooms'>, taskId: Id<'chatroom_tasks'>) {
  return {
    taskId,
    chatroomId,
    status: 'pending',
    assignedTo: 'planner',
    createdAt: 100,
    updatedAt: 100,
  };
}

const LEGACY_TASK_FIELDS = [
  'content',
  'createdBy',
  'queuePosition',
  'taskEnvelope',
  'agentHarness',
  'model',
  'workingDir',
] as const;

describe('chatroomWorkspaceTaskInbox', () => {
  test('returns a header-only view for a legacy fat row', async () => {
    const { sessionId, machineId, chatroomId, taskId } = await setup();
    const eventId = await t.run(async (ctx) =>
      ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        agentHarness: 'opencode',
        model: 'gpt-5',
        workingDir: '/tmp/workspace',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: { ...taskPayload(chatroomId, taskId), taskEnvelope: { anything: true } },
        createdAt: 500,
      })
    );

    const pending = await t.query(api.chatroomWorkspaceTaskInbox.listPending, {
      sessionId,
      machineId,
    });
    expect(pending).toEqual([
      {
        _id: eventId,
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        createdAt: 500,
        task: taskHeader(chatroomId, taskId),
      },
    ]);
    for (const legacyField of LEGACY_TASK_FIELDS) {
      expect(pending[0]).not.toHaveProperty(legacyField);
      expect(pending[0].task).not.toHaveProperty(legacyField);
    }
  });

  test('returns the same header-only view for a slim row', async () => {
    const { sessionId, machineId, chatroomId, taskId } = await setup();
    const eventId = await t.run(async (ctx) =>
      ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        assignee: { type: WorkspaceTaskAssigneeType.Permanent },
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskHeader(chatroomId, taskId),
        createdAt: 500,
      })
    );

    await expect(
      t.query(api.chatroomWorkspaceTaskInbox.listPending, { sessionId, machineId })
    ).resolves.toEqual([
      {
        _id: eventId,
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        assignee: { type: WorkspaceTaskAssigneeType.Permanent },
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        createdAt: 500,
        task: taskHeader(chatroomId, taskId),
      },
    ]);
  });

  test('returns all pending rows in ascending createdAt without a cap', async () => {
    const { sessionId, machineId, chatroomId, taskId } = await setup();
    const createdAtValues = Array.from({ length: 25 }, (_, index) => 1000 - index);
    const expectedCreatedAt = [...createdAtValues].sort((a, b) => a - b);
    await t.run(async (ctx) => {
      for (const createdAt of createdAtValues) {
        await ctx.db.insert('chatroomWorkspaceTaskInbox', {
          machineId,
          chatroomId,
          taskId,
          role: 'planner',
          eventType: WorkspaceTaskInboxEventType.TaskAssigned,
          status: WorkspaceTaskInboxEventStatus.Pending,
          task: taskHeader(chatroomId, taskId),
          createdAt,
        });
      }
    });

    const pending = await t.query(api.chatroomWorkspaceTaskInbox.listPending, {
      sessionId,
      machineId,
    });
    expect(pending).toHaveLength(25);
    expect(pending.map((row) => row.createdAt)).toEqual(expectedCreatedAt);
  });

  test('returns only unprocessed pending rows and keeps markProcessed idempotent', async () => {
    const { sessionId, machineId, chatroomId, taskId } = await setup();
    const [firstEventId, secondEventId] = await t.run(async (ctx) => [
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskHeader(chatroomId, taskId),
        createdAt: 100,
      }),
      await ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskHeader(chatroomId, taskId),
        createdAt: 200,
      }),
    ]);

    await expect(
      t.mutation(api.chatroomWorkspaceTaskInbox.markProcessed, {
        sessionId,
        machineId,
        eventId: firstEventId,
      })
    ).resolves.toEqual({ processed: true });
    await expect(
      t.mutation(api.chatroomWorkspaceTaskInbox.markProcessed, {
        sessionId,
        machineId,
        eventId: firstEventId,
      })
    ).resolves.toEqual({ processed: false });

    const pending = await t.query(api.chatroomWorkspaceTaskInbox.listPending, {
      sessionId,
      machineId,
    });
    expect(pending.map((row) => row._id)).toEqual([secondEventId]);
    expect(pending[0]).not.toHaveProperty('attemptCount');

    await expect(
      t.mutation(api.chatroomWorkspaceTaskInbox.markProcessed, {
        sessionId,
        machineId,
        eventId: secondEventId,
      })
    ).resolves.toEqual({ processed: true });
    await expect(
      t.query(api.chatroomWorkspaceTaskInbox.listPending, { sessionId, machineId })
    ).resolves.toEqual([]);
  });

  test('scopes pending rows to the requesting machine', async () => {
    const { sessionId, machineId, chatroomId, taskId } = await setup();
    await t.run(async (ctx) =>
      ctx.db.insert('chatroomWorkspaceTaskInbox', {
        machineId: `${machineId}-other`,
        chatroomId,
        taskId,
        role: 'planner',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        task: taskHeader(chatroomId, taskId),
        createdAt: 100,
      })
    );

    await expect(
      t.query(api.chatroomWorkspaceTaskInbox.listPending, { sessionId, machineId })
    ).resolves.toEqual([]);
  });
});
