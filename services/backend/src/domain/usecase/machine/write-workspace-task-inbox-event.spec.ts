/**
 * Tests for writeWorkspaceTaskInboxEvent — the inbox writer must persist only the
 * slim task header (heavy content stays on chatroom_tasks) and must keep the
 * TaskDeleted fan-out targeting machines derived from existing events.
 */

import { createTaskEnvelope } from '@workspace/shared/domain/task-envelope';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import {
  toWorkspaceTaskInboxTaskHeader,
  writeWorkspaceTaskInboxEvent,
} from './write-workspace-task-inbox-event';
import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '../../entities/chatroom-workspace-task-inbox';

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
    const user = await ctx.db.query('users').first();
    if (!user) throw new Error('test user missing');
    const now = Date.now();
    await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
      requestKey: `${chatroomId}:duo@1:${role}`,
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      chatroomId,
      teamStructureId: 'duo@1',
      role,
      agentType: 'remote',
      machineId,
      agentHarness: 'opencode-sdk',
      model: 'model',
      workingDir: '/tmp',
      reason: 'user.config',
      wantResume: false,
      requestedBy: user._id,
      requestedAt: now,
    });
  });
}

async function seedBuilderTask(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'x'.repeat(5_000),
      status: 'pending',
      assignedTo: 'builder',
      taskEnvelope: createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'continue' }),
      queuePosition: 3,
      startInNewSession: true,
      createdAt: 100,
      updatedAt: 100,
    });
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (!task) throw new Error('seeded task missing');
    return task;
  });
}

async function listInboxEvents(chatroomId: Id<'chatroom_rooms'>, taskId: Id<'chatroom_tasks'>) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroomWorkspaceTaskInbox')
      .withIndex('by_chatroom_taskId', (q) => q.eq('chatroomId', chatroomId).eq('taskId', taskId))
      .collect();
  });
}

async function readHeader(taskId: Id<'chatroom_tasks'>) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_activeTaskHeaders')
      .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
      .first()
  );
}

async function patchTask(taskId: Id<'chatroom_tasks'>, patch: Partial<Doc<'chatroom_tasks'>>) {
  return await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_tasks', taskId, patch);
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (!task) throw new Error('task missing');
    return task;
  });
}

const ACTIVE_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;

/** Asserts chatroom_activeTaskHeaders equals a scan of chatroom_tasks filtered to active + assigned. */
async function expectProjectionMatchesTasks(chatroomId: Id<'chatroom_rooms'>) {
  await t.run(async (ctx) => {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    const headers = await ctx.db
      .query('chatroom_activeTaskHeaders')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();

    const byTaskId = <T extends { taskId: Id<'chatroom_tasks'> }>(rows: T[]) =>
      [...rows].sort((a, b) => a.taskId.localeCompare(b.taskId));

    const expected = byTaskId(
      tasks
        .filter(
          (task) =>
            (ACTIVE_STATUSES as readonly string[]).includes(task.status) &&
            task.assignedTo !== undefined
        )
        .map((task) => ({
          taskId: task._id,
          chatroomId: task.chatroomId,
          status: task.status,
          assignedTo: task.assignedTo,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          ...(task.startInNewSession === undefined
            ? {}
            : { startInNewSession: task.startInNewSession }),
        }))
    );

    const actual = byTaskId(
      headers.map((header) => ({
        taskId: header.taskId,
        chatroomId: header.chatroomId,
        status: header.status,
        assignedTo: header.assignedTo,
        createdAt: header.createdAt,
        updatedAt: header.updatedAt,
        ...(header.startInNewSession === undefined
          ? {}
          : { startInNewSession: header.startInNewSession }),
      }))
    );

    expect(actual).toEqual(expected);
  });
}

describe('toWorkspaceTaskInboxTaskHeader', () => {
  test('keeps only the header keys and drops legacy fat fields', () => {
    const legacyTask = {
      taskId: 'task_1' as Id<'chatroom_tasks'>,
      chatroomId: 'room_1' as Id<'chatroom_rooms'>,
      status: 'pending',
      createdAt: 100,
      updatedAt: 200,
      createdBy: 'user',
      content: 'heavy content',
      queuePosition: 3,
      taskEnvelope: { anything: true },
    };

    const header = toWorkspaceTaskInboxTaskHeader(legacyTask);

    expect(header).toEqual({
      taskId: 'task_1',
      chatroomId: 'room_1',
      status: 'pending',
      createdAt: 100,
      updatedAt: 200,
    });
    expect(Object.keys(header).sort()).toEqual(
      ['chatroomId', 'createdAt', 'status', 'taskId', 'updatedAt'].sort()
    );
    expect(header).not.toHaveProperty('assignedTo');
    expect(header).not.toHaveProperty('startInNewSession');
    expect(header).not.toHaveProperty('content');
    expect(header).not.toHaveProperty('taskEnvelope');
    expect(header).not.toHaveProperty('queuePosition');
    expect(header).not.toHaveProperty('createdBy');
  });
});

describe('writeWorkspaceTaskInboxEvent', () => {
  test('persists only the slim task header', async () => {
    const { sessionId } = await createTestSession('inbox-slim-header');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'inbox-slim-machine-1';
    await seedRemoteConfig(chatroomId, 'builder', machineId);
    const task = await seedBuilderTask(chatroomId);

    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskAssigned, task)
    );

    const events = await listInboxEvents(chatroomId, task._id);
    expect(events).toHaveLength(1);
    const row = events[0];

    expect(row.machineId).toBe(machineId);
    expect(row.status).toBe(WorkspaceTaskInboxEventStatus.Pending);
    expect(row.assignee).toEqual({ type: 'permanent' });
    expect(row.task).toEqual({
      taskId: task._id,
      chatroomId: task.chatroomId,
      status: task.status,
      assignedTo: 'builder',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startInNewSession: true,
    });
    expect(row.task).not.toHaveProperty('content');
    expect(row.task).not.toHaveProperty('taskEnvelope');
    expect(row.task).not.toHaveProperty('createdBy');
    expect(row.task).not.toHaveProperty('queuePosition');
  });

  test('TaskDeleted fans out to machines from existing events', async () => {
    const { sessionId } = await createTestSession('inbox-task-deleted');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'inbox-slim-machine-deleted';
    await seedRemoteConfig(chatroomId, 'builder', machineId);
    const task = await seedBuilderTask(chatroomId);

    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskAssigned, task)
    );
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskDeleted, task)
    );

    const events = await listInboxEvents(chatroomId, task._id);
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          machineId,
          role: 'builder',
          eventType: WorkspaceTaskInboxEventType.TaskDeleted,
        }),
      ])
    );
  });
});

describe('writeWorkspaceTaskInboxEvent — active task header projection', () => {
  async function setupTask(id: string) {
    const { sessionId } = await createTestSession(id);
    const chatroomId = await createChatroom(sessionId);
    const machineId = `${id}-machine`;
    await seedRemoteConfig(chatroomId, 'builder', machineId);
    const task = await seedBuilderTask(chatroomId);
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskAssigned, task)
    );
    return { chatroomId, task };
  }

  test('creating a task syncs the projection', async () => {
    const { chatroomId, task } = await setupTask('proj-create');

    await expectProjectionMatchesTasks(chatroomId);
    const header = await readHeader(task._id);
    expect(header).not.toBeNull();
    expect(header!.status).toBe('pending');
    expect(header!.assignedTo).toBe('builder');
    expect(header!.startInNewSession).toBe(true);
  });

  test('transitioning a task updates the projection', async () => {
    const { chatroomId, task } = await setupTask('proj-transition');

    const updated = await patchTask(task._id, { status: 'in_progress' });
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskUpdated, updated)
    );

    await expectProjectionMatchesTasks(chatroomId);
    expect((await readHeader(task._id))!.status).toBe('in_progress');
  });

  test('reassigning a task updates the projection', async () => {
    const { chatroomId, task } = await setupTask('proj-reassign');

    const updated = await patchTask(task._id, { assignedTo: 'architect' });
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskUpdated, updated)
    );

    await expectProjectionMatchesTasks(chatroomId);
    expect((await readHeader(task._id))!.assignedTo).toBe('architect');
  });

  test('completing a task removes the projection row', async () => {
    const { chatroomId, task } = await setupTask('proj-complete');

    const updated = await patchTask(task._id, { status: 'completed' });
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskUpdated, updated)
    );

    await expectProjectionMatchesTasks(chatroomId);
    expect(await readHeader(task._id)).toBeNull();
  });

  test('deleting a task removes the projection row', async () => {
    const { chatroomId, task } = await setupTask('proj-delete');

    // Production order: TaskDeleted is written just before the task row is deleted.
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskDeleted, task)
    );
    await t.run((ctx) => ctx.db.delete('chatroom_tasks', task._id));

    await expectProjectionMatchesTasks(chatroomId);
    expect(await readHeader(task._id)).toBeNull();
  });

  test('consuming a session keeps the projection in sync', async () => {
    const { chatroomId, task } = await setupTask('proj-consume');

    const updated = await patchTask(task._id, {
      startInNewSession: undefined,
      sessionPolicyConsumedAt: Date.now(),
    });
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskUpdated, updated)
    );

    await expectProjectionMatchesTasks(chatroomId);
    expect((await readHeader(task._id))!.startInNewSession).toBeUndefined();
  });

  test('editing content leaves the projection row unchanged', async () => {
    const { chatroomId, task } = await setupTask('proj-edit-content');
    const before = await readHeader(task._id);

    const updated = await patchTask(task._id, { content: 'rewritten body' });
    await t.run((ctx) =>
      writeWorkspaceTaskInboxEvent(ctx, WorkspaceTaskInboxEventType.TaskUpdated, updated)
    );

    await expectProjectionMatchesTasks(chatroomId);
    const after = await readHeader(task._id);
    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('content');
  });
});
