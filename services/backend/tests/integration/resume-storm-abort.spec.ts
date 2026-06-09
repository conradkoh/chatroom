/**
 * Resume storm abort — integration tests for agent.resumeStormAborted.
 */

import { describe, expect, test } from 'vitest';

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

describe('emitResumeStormAborted', () => {
  test('marks agent stopped and writes event stream row', async () => {
    const { sessionId } = await createTestSession('test-resume-storm-abort');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-resume-storm-abort';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 4242,
      model: 'test-model',
      reason: 'user.start',
    });

    await t.mutation(api.agentResumeStorm.emitResumeStormAborted, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      reason: 'rate_limit',
      endCount: 5,
      windowMs: 30_000,
      harnessSessionId: 'pi-sess-storm',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const aborted = events.filter((e) => e.type === 'agent.resumeStormAborted');
    expect(aborted).toHaveLength(1);
    expect(aborted[0]).toMatchObject({
      reason: 'rate_limit',
      endCount: 5,
      windowMs: 30_000,
      harnessSessionId: 'pi-sess-storm',
    });

    const config = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      const teamId = chatroom?.teamId;
      if (!teamId) {
        throw new Error('expected chatroom teamId');
      }
      const teamRoleKey = buildTeamRoleKey(chatroomId, teamId, 'builder');
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
        .first();
    });
    expect(config?.desiredState).toBe('stopped');
    expect(config?.spawnedAgentPid).toBeUndefined();

    const participant = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });
    expect(participant?.lastStatus).toBe('agent.resumeStormAborted');
    expect(participant?.lastDesiredState).toBe('stopped');
  });

  test('recordAgentExited with platform.resume_storm keeps resume-storm status', async () => {
    const { sessionId } = await createTestSession('test-resume-storm-exit');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-resume-storm-exit';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 5150,
      model: 'test-model',
      reason: 'user.start',
    });

    await t.mutation(api.agentResumeStorm.emitResumeStormAborted, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      reason: 'auth_error',
      endCount: 5,
      windowMs: 30_000,
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 5150,
      stopReason: 'platform.resume_storm',
      agentHarness: 'pi',
    });

    const participant = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });
    expect(participant?.lastStatus).toBe('agent.resumeStormAborted');
    expect(participant?.lastDesiredState).toBe('stopped');
  });
});
