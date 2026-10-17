/**
 * daemon/taskStatus:listActive — end-to-end
 *
 * The query must return the same shape and order as before, read only the slim
 * `chatroom_activeTaskHeaders` projection, and never carry task content.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { syncActiveTaskHeader } from '../../src/domain/usecase/task/active-task-header';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function setupMachine(id: string) {
  const { sessionId } = await createTestSession(id);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = `${id}-machine`;
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
  return { sessionId, chatroomId, machineId };
}

function seedActiveTask(args: {
  chatroomId: Id<'chatroom_rooms'>;
  assignedTo: string;
  createdAt: number;
  updatedAt: number;
  startInNewSession?: boolean;
  content?: string;
}) {
  return t.run(async (ctx) => {
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy: 'user',
      content: args.content ?? 'body',
      status: 'pending',
      assignedTo: args.assignedTo,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      queuePosition: 0,
      ...(args.startInNewSession === undefined
        ? {}
        : { startInNewSession: args.startInNewSession }),
    });
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (!task) throw new Error('seeded task missing');
    await syncActiveTaskHeader(ctx, task);
    return taskId;
  });
}

describe('daemon/taskStatus:listActive', () => {
  test('returns active assigned headers in createdAt order with case-insensitive role match', async () => {
    const { sessionId, chatroomId, machineId } = await setupMachine('listactive-shape');
    const later = await seedActiveTask({
      chatroomId,
      assignedTo: 'builder',
      createdAt: 200,
      updatedAt: 250,
      startInNewSession: true,
    });
    const earlier = await seedActiveTask({
      chatroomId,
      assignedTo: 'Builder',
      createdAt: 100,
      updatedAt: 120,
    });
    // Different role — excluded from the builder request.
    await seedActiveTask({ chatroomId, assignedTo: 'architect', createdAt: 150, updatedAt: 150 });

    const result = await t.query(api.daemon.taskStatus.listActive, { sessionId, machineId });

    expect(result).toEqual([
      {
        taskId: earlier,
        chatroomId,
        status: 'pending',
        assignedTo: 'Builder',
        updatedAt: 120,
        createdAt: 100,
        agentConfig: { role: 'builder', machineId },
      },
      {
        taskId: later,
        chatroomId,
        status: 'pending',
        assignedTo: 'builder',
        updatedAt: 250,
        createdAt: 200,
        agentConfig: { role: 'builder', machineId },
        requestsNativeColdSession: true,
      },
    ]);
  });

  test('does not read chatroom_tasks: the header survives task-row deletion', async () => {
    const { sessionId, chatroomId, machineId } = await setupMachine('listactive-no-task-read');
    const taskId = await seedActiveTask({
      chatroomId,
      assignedTo: 'builder',
      createdAt: 100,
      updatedAt: 100,
    });

    await t.run(async (ctx) => {
      await ctx.db.delete('chatroom_tasks', taskId);
    });

    const result = await t.query(api.daemon.taskStatus.listActive, { sessionId, machineId });
    expect(result.map((row) => row.taskId)).toEqual([taskId]);
  });

  test('never returns task content', async () => {
    const { sessionId, chatroomId, machineId } = await setupMachine('listactive-no-content');
    const taskId = await seedActiveTask({
      chatroomId,
      assignedTo: 'builder',
      createdAt: 100,
      updatedAt: 100,
      content: 'x'.repeat(200_000),
    });

    const result = await t.query(api.daemon.taskStatus.listActive, { sessionId, machineId });
    const row = result.find((entry) => entry.taskId === taskId);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('content');
    expect(Object.keys(row!).sort()).toEqual(
      [
        'agentConfig',
        'assignedTo',
        'chatroomId',
        'createdAt',
        'status',
        'taskId',
        'updatedAt',
      ].sort()
    );
  });

  test('rejects a machine owned by another user', async () => {
    const { chatroomId, machineId } = await setupMachine('listactive-auth');
    await seedActiveTask({ chatroomId, assignedTo: 'builder', createdAt: 1, updatedAt: 1 });

    const { sessionId: otherSession } = await createTestSession('listactive-auth-other');

    await expect(
      t.query(api.daemon.taskStatus.listActive, {
        sessionId: otherSession as SessionId,
        machineId,
      })
    ).rejects.toThrow();
  });
});
