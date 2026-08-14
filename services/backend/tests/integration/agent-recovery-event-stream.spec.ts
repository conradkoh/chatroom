/**
 * Agent recovery — task status and participant state without observability events.
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

async function getParticipantLastStatus(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    return participant?.lastStatus ?? null;
  });
}

describe('Agent recovery task state', () => {
  test('claimTask updates task status and participant lastStatus', async () => {
    const { sessionId } = await createTestSession('test-ares-claim');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Recovery duplicate test task',
      createdBy: 'user',
    });

    const taskAfterCreate = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(taskAfterCreate?.status).toBe('pending');

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const taskAfterClaim = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(taskAfterClaim?.status).toBe('acknowledged');
    expect(await getParticipantLastStatus(chatroomId, 'builder')).toBe('task.acknowledged');
  });

  test('native:task-injected after claim keeps participant task.acknowledged', async () => {
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

    expect(await getParticipantLastStatus(chatroomId, 'builder')).toBe('task.acknowledged');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    expect(await getParticipantLastStatus(chatroomId, 'builder')).toBe('task.acknowledged');
  });

  test('release on agent exit returns task to pending without duplicate state changes', async () => {
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

    expect(await getParticipantLastStatus(chatroomId, 'builder')).toBe('task.acknowledged');

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

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      limit: 10,
    });
    const pending = tasks.find((row) => row.status === 'pending');
    expect(pending).toBeDefined();
  });
});
