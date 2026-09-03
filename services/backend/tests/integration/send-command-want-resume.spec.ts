/**
 * sendCommand start-agent wantResume pass-through — Integration Tests
 *
 * Verifies the sendCommand payload validator accepts `wantResume` (not the
 * deprecated `wantResumeOnFail` name) and forwards it to agent.requestStart.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { getInboxCommandsForChatroom } from '../helpers/machine-command-inbox';
import { TEST_MODEL_OPENCODE_LEGACY } from '../helpers/test-models';

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
        role: 'planner',
        model: TEST_MODEL_OPENCODE_LEGACY,
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
        wantResume: true,
      },
    });

    const inboxStarts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const start = inboxStarts.find((row) => row.command.type === 'agent.requestStart');
    expect(start?.command.type).toBe('agent.requestStart');
    if (start?.command.type === 'agent.requestStart') {
      expect(start.command.wantResume).toBe(true);
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
        role: 'planner',
        model: TEST_MODEL_OPENCODE_LEGACY,
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
        wantResume: false,
      },
    });

    const inboxStarts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const start = inboxStarts.find((row) => row.command.type === 'agent.requestStart');
    if (start?.command.type === 'agent.requestStart') {
      expect(start.command.wantResume).toBe(false);
    }
  });

  test('defaults omitted wantResume to false instead of reading persisted config', async () => {
    const { sessionId } = await createTestSession('test-cmd-want-resume-3');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-cmd-want-resume-3';
    await registerMachineWithDaemon(sessionId, machineId);

    // Seed a legacy persisted preference from before this deprecation.
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'planner',
        model: TEST_MODEL_OPENCODE_LEGACY,
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
        wantResume: true,
      },
    });

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { wantResume: true });
    });

    // Second start omits wantResume. It must use the cold-start default instead
    // of reading the stale persisted true value.
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'planner',
        model: TEST_MODEL_OPENCODE_LEGACY,
        agentHarness: 'opencode',
        workingDir: '/tmp/test',
      },
    });

    const inboxStarts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const latest = inboxStarts.at(-1);
    expect(latest?.command.type).toBe('agent.requestStart');
    if (latest?.command.type === 'agent.requestStart') {
      expect(latest.command.wantResume).toBe(false);
    }
  });
});
