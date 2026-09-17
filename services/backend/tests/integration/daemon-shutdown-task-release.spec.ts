/**
 * Daemon shutdown task release integration tests.
 *
 * When a daemon shuts down, every non-pending task its roles hold must move
 * back to `pending` so the next daemon boot re-delivers them — no agent on the
 * machine can be processing anything after the daemon exits.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function createAssignedTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  assignedTo: string
): Promise<Id<'chatroom_tasks'>> {
  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content,
    createdBy: 'user',
  });
  await t.run((ctx) => ctx.db.patch('chatroom_tasks', taskId, { assignedTo }));
  return taskId;
}

describe('releaseMachineTasks (daemon shutdown)', () => {
  test('releases acknowledged and in_progress tasks to pending, leaves pending untouched', async () => {
    const { sessionId } = await createTestSession('release-shutdown-1');
    const machineId = 'machine-release-1';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const acknowledgedTaskId = await createAssignedTask(
      sessionId,
      chatroomId,
      'Acknowledged task',
      'builder'
    );
    const inProgressTaskId = await createAssignedTask(
      sessionId,
      chatroomId,
      'In-progress task',
      'builder'
    );
    const pendingTaskId = await createAssignedTask(
      sessionId,
      chatroomId,
      'Pending task',
      'builder'
    );

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTaskId,
    });
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: inProgressTaskId,
    });
    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: inProgressTaskId,
    });

    const released = await t.mutation(api.daemon.taskStatus.releaseMachineTasks, {
      sessionId,
      machineId,
    });
    expect(released).toBe(2);

    const statusOf = async (taskId: Id<'chatroom_tasks'>) =>
      (await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId)))?.status;
    expect(await statusOf(acknowledgedTaskId)).toBe('pending');
    expect(await statusOf(inProgressTaskId)).toBe('pending');
    expect(await statusOf(pendingTaskId)).toBe('pending');
  });

  test('only releases tasks assigned to roles launched on this machine', async () => {
    const { sessionId } = await createTestSession('release-shutdown-2');
    const machineId = 'machine-release-2';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Task assigned to another role on the same chatroom must be untouched.
    const otherRoleTaskId = await createAssignedTask(
      sessionId,
      chatroomId,
      'Planner task',
      'planner'
    );
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId: otherRoleTaskId,
    });

    const released = await t.mutation(api.daemon.taskStatus.releaseMachineTasks, {
      sessionId,
      machineId,
    });
    expect(released).toBe(0);

    const task = await t.run((ctx) => ctx.db.get('chatroom_tasks', otherRoleTaskId));
    expect(task?.status).toBe('acknowledged');
  });

  test('rejects callers that do not own the machine', async () => {
    const { sessionId } = await createTestSession('release-shutdown-3');
    await expect(
      t.mutation(api.daemon.taskStatus.releaseMachineTasks, {
        sessionId,
        machineId: 'machine-not-owned',
      })
    ).rejects.toThrow();
  });
});
