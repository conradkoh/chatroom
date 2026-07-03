/**
 * Agent recovery event stream — no duplicate task.activated / task.acknowledged
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function getEventCounts(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return {
      activated: events.filter((e) => e.type === 'task.activated'),
      acknowledged: events.filter((e) => e.type === 'task.acknowledged'),
      inProgress: events.filter((e) => e.type === 'task.inProgress'),
    };
  });
}

describe('Agent recovery event stream', () => {
  test('claimTask produces exactly 1 task.activated (pending) + 1 task.acknowledged', async () => {
    const { sessionId } = await createTestSession('test-ares-claim');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Recovery duplicate test task',
      createdBy: 'user',
    });

    const countsAfterCreate = await getEventCounts(chatroomId);
    expect(countsAfterCreate.activated).toHaveLength(1);
    expect(countsAfterCreate.activated[0]?.type).toBe('task.activated');
    if (countsAfterCreate.activated[0]?.type === 'task.activated') {
      expect(countsAfterCreate.activated[0].taskStatus).toBe('pending');
    }
    expect(countsAfterCreate.acknowledged).toHaveLength(0);

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const countsAfterClaim = await getEventCounts(chatroomId);
    expect(countsAfterClaim.activated).toHaveLength(1);
    expect(countsAfterClaim.acknowledged).toHaveLength(1);
    expect(
      countsAfterClaim.activated.some(
        (e) => e.type === 'task.activated' && e.taskStatus === 'acknowledged'
      )
    ).toBe(false);
  });

  test('native:task-injected after claim does NOT add second task.acknowledged', async () => {
    const { sessionId } = await createTestSession('test-ares-reinject');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Re-inject duplicate test task',
      createdBy: 'user',
    });

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const countsBeforeReinject = await getEventCounts(chatroomId);
    expect(countsBeforeReinject.acknowledged).toHaveLength(1);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    const countsAfterReinject = await getEventCounts(chatroomId);
    expect(countsAfterReinject.acknowledged).toHaveLength(1);
    expect(countsAfterReinject.acknowledged[0]?._id).toBe(
      countsBeforeReinject.acknowledged[0]?._id
    );
  });

  test('release on agent exit does NOT add second task.activated (pending)', async () => {
    const { sessionId } = await createTestSession('test-ares-release');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await joinParticipant(sessionId, chatroomId, 'planner');

    const machineId = 'machine-ares-release';
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

    const countsBeforeExit = await getEventCounts(chatroomId);
    expect(countsBeforeExit.activated).toHaveLength(1);
    expect(countsBeforeExit.acknowledged).toHaveLength(1);

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      if (config) {
        await ctx.db.patch(config._id, { spawnedAgentPid: 9393, desiredState: 'running' });
      }
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 9393,
      stopReason: 'agent_process.crashed',
    });

    const countsAfterExit = await getEventCounts(chatroomId);
    expect(countsAfterExit.activated).toHaveLength(1);
    expect(countsAfterExit.acknowledged).toHaveLength(1);

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      limit: 10,
    });
    const pending = tasks.find((row) => row.status === 'pending');
    expect(pending).toBeDefined();
  });
});
