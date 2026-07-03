/**
 * Task release on agent exit — integration tests
 *
 * When an agent crashes or exits unexpectedly, in-flight tasks for that role
 * return to pending so getPendingTasksForRole can deliver them immediately.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
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
  await joinParticipant(sessionId, chatroomId, 'planner');

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
  expect(task?.assignedTo).toBe('builder');
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

test('recordAgentExited (user.stop) releases acknowledged task to pending', async () => {
  const { sessionId } = await createTestSession('test-task-release-user-stop');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'builder');
  await joinParticipant(sessionId, chatroomId, 'planner');

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
  const pending = tasks.find((row) => row.status === 'pending');
  expect(pending).toBeDefined();
  expect(pending?.assignedTo).toBe('builder');
  expect(pending?.acknowledgedAt).toBeUndefined();

  const pendingAfterExit = await t.query(api.tasks.getPendingTasksForRole, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  expect(pendingAfterExit.type).toBe('tasks');
});

test('recordAgentExited (daemon.shutdown) releases acknowledged task to pending', async () => {
  const { sessionId } = await createTestSession('test-task-release-daemon-shutdown');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'builder');
  await joinParticipant(sessionId, chatroomId, 'planner');

  const machineId = 'machine-task-release-daemon-shutdown';
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
      await ctx.db.patch(config._id, { spawnedAgentPid: 6262, desiredState: 'running' });
    }
  });

  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 6262,
    stopReason: 'daemon.shutdown',
  });

  const tasks = await t.query(api.tasks.listTasks, {
    sessionId,
    chatroomId,
    limit: 10,
  });
  const pending = tasks.find((row) => row.status === 'pending');
  expect(pending).toBeDefined();
  expect(pending?.assignedTo).toBe('builder');
});

test('recordAgentExited (crash) releases in_progress task to pending', async () => {
  const { sessionId } = await createTestSession('test-task-release-in-progress');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'builder');
  await joinParticipant(sessionId, chatroomId, 'planner');

  const machineId = 'machine-task-release-in-progress';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Implement the feature',
    type: 'message',
  });

  const claimResult = await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  await t.mutation(api.tasks.startTask, {
    sessionId,
    chatroomId,
    role: 'builder',
    taskId: claimResult.taskId,
  });

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { spawnedAgentPid: 7272, desiredState: 'running' });
    }
  });

  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 7272,
    stopReason: 'agent_process.crashed',
  });

  const tasks = await t.query(api.tasks.listTasks, {
    sessionId,
    chatroomId,
    limit: 10,
  });
  const pending = tasks.find((row) => row.status === 'pending');
  expect(pending).toBeDefined();
  expect(pending?.startedAt).toBeUndefined();
  expect(pending?.acknowledgedAt).toBeUndefined();
});

test('updateTeam reassigns in-flight builder task to new entry point (planner)', async () => {
  const { sessionId } = await createTestSession('test-task-release-team-switch');
  const machineId = 'machine-task-release-team-switch';
  await registerMachineWithDaemon(sessionId, machineId);

  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'custom',
    teamName: 'Custom Three-Role Team',
    teamRoles: ['planner', 'builder', 'architect'],
    teamEntryPoint: 'builder',
  });

  await joinParticipant(sessionId, chatroomId, 'builder');
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

  await t.mutation(api.chatrooms.updateTeam, {
    sessionId,
    chatroomId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });

  const tasks = await t.query(api.tasks.listTasks, {
    sessionId,
    chatroomId,
    limit: 10,
  });
  const pending = tasks.find((row) => row.status === 'pending');
  expect(pending).toBeDefined();
  expect(pending?.assignedTo).toBe('planner');
  expect(pending?.acknowledgedAt).toBeUndefined();
  expect(pending?.startedAt).toBeUndefined();

  const plannerPending = await t.query(api.tasks.getPendingTasksForRole, {
    sessionId,
    chatroomId,
    role: 'planner',
  });
  expect(plannerPending.type).toBe('tasks');
});

test('releaseOrphanedTasksForRole releases acknowledged task when PID cleared without recordAgentExited', async () => {
  const { sessionId } = await createTestSession('test-task-release-orphan');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'builder');

  const machineId = 'machine-task-release-orphan';
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

  // Simulate daemon clearing PID without recordAgentExited (orphan path)
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        spawnedAgentPid: undefined,
        desiredState: 'stopped',
      });
    }
  });

  const sweepResult = await t.mutation(api.tasks.sweepOrphanedTasks, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  expect(sweepResult.released).toBe(1);

  const tasks = await t.query(api.tasks.listTasks, {
    sessionId,
    chatroomId,
    limit: 10,
  });
  const pending = tasks.find((row) => row.status === 'pending');
  expect(pending).toBeDefined();
  expect(pending?.assignedTo).toBe('builder');
  expect(pending?.acknowledgedAt).toBeUndefined();

  const participant = await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .unique();
  });
  expect(participant?.lastStatus).toBe('agent.exited');
});
