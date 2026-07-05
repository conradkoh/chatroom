/**
 * Resume session token activity — Integration Tests
 *
 * Verifies updateTokenActivity restarts work when a resumed native agent is
 * agent.waiting and harness tokens resume.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { TEST_MODEL_CURSOR_SDK, TEST_MODEL_OPENCODE } from '../helpers/test-models';

async function getParticipantStatus(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const p = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    return {
      lastStatus: p?.lastStatus ?? null,
      lastSeenAction: p?.lastSeenAction ?? null,
    };
  });
}

async function setParticipantState(
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  patch: { lastStatus?: string; lastSeenAction?: string }
) {
  await t.run(async (ctx) => {
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    if (participant) {
      await ctx.db.patch('chatroom_participants', participant._id, patch);
    }
  });
}

async function createAcknowledgedTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'Resume session acknowledged task',
    createdBy: 'user',
  });

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role,
    taskId,
  });

  return taskId;
}

describe('Resume session token activity', () => {
  test('starts acknowledged task when participant is agent.waiting after resume', async () => {
    const { sessionId } = await createTestSession('test-resume-ack-waiting');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    await setParticipantState(chatroomId, 'builder', {
      lastStatus: 'agent.waiting',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
  });

  test('claims and starts pending task when participant is agent.waiting', async () => {
    const { sessionId } = await createTestSession('test-resume-pending-waiting');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'planner'),
        chatroomId,
        role: 'planner',
        type: 'remote',
        machineId: 'machine-cli-planner',
        agentHarness: 'claude',
        model: TEST_MODEL_OPENCODE,
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
      });
    });

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Resume session pending task',
      createdBy: 'user',
    });

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', taskId, { assignedTo: 'planner' });
    });

    await setParticipantState(chatroomId, 'planner', {
      lastStatus: 'agent.waiting',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    const status = await getParticipantStatus(chatroomId, 'planner');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
    expect(task?.assignedTo).toBe('planner');
  });

  test('does not restart work when participant is agent.waiting but no tasks exist', async () => {
    const { sessionId } = await createTestSession('test-resume-no-tasks');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await setParticipantState(chatroomId, 'builder', {
      lastStatus: 'agent.waiting',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.waiting');
  });

  test('native harness resumes released pending task on token activity after agent exit', async () => {
    const { sessionId } = await createTestSession('test-native-resume-released-pending');
    const machineId = 'machine-native-resume-released';

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['cursor-sdk', 'opencode'],
      availableModels: {
        'cursor-sdk': [TEST_MODEL_CURSOR_SDK],
        opencode: [TEST_MODEL_OPENCODE],
      },
    });
    await t.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: true,
    });

    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', {
      agentHarness: 'cursor-sdk',
    });
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Native harness work in progress',
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
        await ctx.db.patch(config._id, { spawnedAgentPid: 8888, desiredState: 'running' });
      }
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 8888,
      stopReason: 'user.stop',
    });

    const taskBeforeResume = await t.run(async (ctx) =>
      ctx.db.get('chatroom_tasks', claimResult.taskId)
    );
    expect(taskBeforeResume?.status).toBe('pending');

    const messageAcknowledged = await t.run(async (ctx) => {
      if (!taskBeforeResume?.sourceMessageId) {
        return false;
      }
      const msg = await ctx.db.get('chatroom_messages', taskBeforeResume.sourceMessageId);
      return msg?.acknowledgedAt != null;
    });
    expect(messageAcknowledged).toBe(true);

    await setParticipantState(chatroomId, 'builder', {
      lastStatus: 'agent.waiting',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', claimResult.taskId));
    expect(task?.status).toBe('in_progress');
  });

  test('native harness resumes released pending task when participant still shows stale task.inProgress', async () => {
    const { sessionId } = await createTestSession('test-native-resume-stale-participant');
    const machineId = 'machine-native-resume-stale-participant';

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['cursor-sdk', 'opencode'],
      availableModels: {
        'cursor-sdk': [TEST_MODEL_CURSOR_SDK],
        opencode: [TEST_MODEL_OPENCODE],
      },
    });
    await t.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: true,
    });

    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', {
      agentHarness: 'cursor-sdk',
    });
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Native harness work released with stale participant',
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
        await ctx.db.patch(config._id, { spawnedAgentPid: 7777, desiredState: 'running' });
      }
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 7777,
      stopReason: 'user.stop',
    });

    await setParticipantState(chatroomId, 'builder', {
      lastStatus: 'task.inProgress',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', claimResult.taskId));
    expect(task?.status).toBe('in_progress');
  });
});
