/**
 * Task release on agent exit — integration tests
 *
 * When an agent crashes or exits unexpectedly, in-flight tasks for that role
 * return to pending so getPendingTasksForRole can deliver them immediately.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

test('recordAgentExited (crash) releases acknowledged task to pending — no grace_period', async () => {
  const { sessionId } = await createTestSession('test-task-release-crash');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'builder');
  await joinParticipant(sessionId, chatroomId, 'reviewer');

  const machineId = 'machine-task-release-crash';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Implement the feature',
    type: 'message',
  });

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  const graceBeforeExit = await t.query(api.tasks.getPendingTasksForRole, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  expect(graceBeforeExit.type).toBe('grace_period');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { spawnedAgentPid: 4242, desiredState: 'running' });
    }
  });

  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 4242,
    stopReason: 'agent_process.crashed',
  });

  const tasks = await t.query(api.tasks.listTasks, {
    sessionId,
    chatroomId,
    limit: 10,
  });
  const task = tasks.find((row) => row.status === 'pending');
  expect(task).toBeDefined();
  expect(task?.assignedTo).toBeUndefined();
  expect(task?.acknowledgedAt).toBeUndefined();
  expect(task?.startedAt).toBeUndefined();

  const pendingAfterExit = await t.query(api.tasks.getPendingTasksForRole, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  expect(pendingAfterExit.type).toBe('tasks');
  const delivered = (pendingAfterExit as { type: 'tasks'; tasks: { task: { _id: string } }[] })
    .tasks;
  expect(delivered.length).toBeGreaterThan(0);
  expect(delivered[0]?.task._id).toBe(task?._id);
});

test('recordAgentExited (user.stop) does NOT release acknowledged task', async () => {
  const { sessionId } = await createTestSession('test-task-release-user-stop');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'builder');
  await joinParticipant(sessionId, chatroomId, 'reviewer');

  const machineId = 'machine-task-release-user-stop';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Implement the feature',
    type: 'message',
  });

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { spawnedAgentPid: 5252, desiredState: 'running' });
    }
  });

  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 5252,
    stopReason: 'user.stop',
  });

  const tasks = await t.query(api.tasks.listTasks, {
    sessionId,
    chatroomId,
    limit: 10,
  });
  const acknowledged = tasks.find((row) => row.status === 'acknowledged');
  expect(acknowledged).toBeDefined();
  expect(acknowledged?.assignedTo).toBe('builder');
  expect(acknowledged?.acknowledgedAt).toBeDefined();

  const pendingAfterExit = await t.query(api.tasks.getPendingTasksForRole, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  expect(pendingAfterExit.type).toBe('grace_period');
});
