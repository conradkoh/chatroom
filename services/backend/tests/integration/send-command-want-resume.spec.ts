/**
 * sendCommand start-agent wantResume pass-through — Integration Tests
 *
 * Verifies the sendCommand payload validator accepts `wantResume` (not the
 * deprecated `wantResumeOnFail` name) and forwards it to agent.requestStart.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('sendCommand start-agent wantResume', () => {
  test('accepts wantResume in payload and writes it on agent.requestStart', async () => {
    const { sessionId } = await createTestSession('test-cmd-want-resume-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-cmd-want-resume-1';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'claude-sonnet-4',
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
        wantResume: true,
      },
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const start = events.find((e) => e.type === 'agent.requestStart');
    expect(start?.type).toBe('agent.requestStart');
    if (start?.type === 'agent.requestStart') {
      expect(start.wantResume).toBe(true);
    }
  });

  test('accepts wantResume=false in payload', async () => {
    const { sessionId } = await createTestSession('test-cmd-want-resume-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-cmd-want-resume-2';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'claude-sonnet-4',
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
        wantResume: false,
      },
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const start = events.find((e) => e.type === 'agent.requestStart');
    if (start?.type === 'agent.requestStart') {
      expect(start.wantResume).toBe(false);
    }
  });

  test('backfills wantResume from the persisted config when omitted on a restart', async () => {
    const { sessionId } = await createTestSession('test-cmd-want-resume-3');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-cmd-want-resume-3';
    await registerMachineWithDaemon(sessionId, machineId);

    // First start persists wantResume: false on the team config.
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'claude-sonnet-4',
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
        wantResume: false,
      },
    });

    // Second start OMITS wantResume (e.g. a restart). It must NOT reset to the
    // default true — it should backfill the persisted false.
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'claude-sonnet-4',
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
      },
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const startEvents = events.filter((e) => e.type === 'agent.requestStart');
    const latest = startEvents.at(-1);
    expect(latest?.type).toBe('agent.requestStart');
    if (latest?.type === 'agent.requestStart') {
      expect(latest.wantResume).toBe(false);
    }
  });
});

describe('setWantResume mutation', () => {
  test('persists wantResume on team agent config without starting the agent', async () => {
    const { sessionId } = await createTestSession('test-set-want-resume-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.machines.setWantResume, {
      sessionId,
      chatroomId,
      role: 'builder',
      wantResume: false,
    });

    const config = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('role'), 'builder'))
        .first();
    });

    expect(config?.wantResume).toBe(false);
  });
});
