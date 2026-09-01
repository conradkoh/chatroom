/**
 * maxReasoningLevel — Integration Tests
 *
 * Verifies Codex max reasoning level persistence and command payload propagation.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { getInboxCommandsForChatroom } from '../helpers/machine-command-inbox';

const TEST_MODEL_CODEX = 'gpt-5.6';
const CODEX_HARNESS = 'codex-sdk' as const;

async function registerCodexMachine(sessionId: string, machineId: string): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: [CODEX_HARNESS],
    availableModels: { [CODEX_HARNESS]: [TEST_MODEL_CODEX] },
  });
  await t.mutation(api.machines.updateDaemonStatus, {
    sessionId,
    machineId,
    connected: true,
  });
}

describe('maxReasoningLevel persistence and commands', () => {
  test('saveTeamAgentConfig accepts and returns a valid Codex cap', async () => {
    const { sessionId } = await createTestSession('test-max-reasoning-save');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-max-reasoning-save';
    await registerCodexMachine(sessionId, machineId);

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: CODEX_HARNESS,
      model: TEST_MODEL_CODEX,
      workingDir: '/tmp/codex',
      maxReasoningLevel: 'high',
    });

    const configs = await t.query(api.machines.getTeamAgentConfigs, { sessionId, chatroomId });
    const builder = configs.find((c) => c.role === 'builder');
    expect(builder?.maxReasoningLevel).toBe('high');
  });

  test('start command omits cap uses persisted config cap in agent.requestStart', async () => {
    const { sessionId } = await createTestSession('test-max-reasoning-start-fallback');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-max-reasoning-start-fallback';
    await registerCodexMachine(sessionId, machineId);

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: CODEX_HARNESS,
      model: TEST_MODEL_CODEX,
      workingDir: '/tmp/codex',
      maxReasoningLevel: 'medium',
    });

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: TEST_MODEL_CODEX,
        agentHarness: CODEX_HARNESS,
        workingDir: '/tmp/codex',
      },
    });

    const starts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const start = starts.at(-1);
    expect(start?.command.type).toBe('agent.requestStart');
    if (start?.command.type === 'agent.requestStart') {
      expect(start.command.maxReasoningLevel).toBe('medium');
    }
  });

  test('start command with cap persists and emits agent.requestStart.maxReasoningLevel', async () => {
    const { sessionId } = await createTestSession('test-max-reasoning-start-payload');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-max-reasoning-start-payload';
    await registerCodexMachine(sessionId, machineId);

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: TEST_MODEL_CODEX,
        agentHarness: CODEX_HARNESS,
        workingDir: '/tmp/codex',
        maxReasoningLevel: 'low',
      },
    });

    const starts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const start = starts.at(-1);
    expect(start?.command.type).toBe('agent.requestStart');
    if (start?.command.type === 'agent.requestStart') {
      expect(start.command.maxReasoningLevel).toBe('low');
    }

    const config = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first()
    );
    expect(config?.maxReasoningLevel).toBe('low');
  });

  test('user restart preserves cap and override wins in agent.restart', async () => {
    const { sessionId } = await createTestSession('test-max-reasoning-restart');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-max-reasoning-restart';
    await registerCodexMachine(sessionId, machineId);
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: CODEX_HARNESS,
      model: TEST_MODEL_CODEX,
      workingDir: '/tmp/codex',
      maxReasoningLevel: 'high',
    });

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { maxReasoningLevel: 'high' });
    });

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'restart-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: TEST_MODEL_CODEX,
        agentHarness: CODEX_HARNESS,
        workingDir: '/tmp/codex',
        maxReasoningLevel: 'medium',
      },
    });

    const restarts = await getInboxCommandsForChatroom(chatroomId, 'agent.restart');
    const restart = restarts.at(-1);
    expect(restart?.command.type).toBe('agent.restart');
    if (restart?.command.type === 'agent.restart') {
      expect(restart.command.maxReasoningLevel).toBe('medium');
    }

    const config = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first()
    );
    expect(config?.maxReasoningLevel).toBe('medium');
  });

  test('offline restart reuses persisted cap', async () => {
    const { sessionId } = await createTestSession('test-max-reasoning-offline');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-max-reasoning-offline';
    await registerCodexMachine(sessionId, machineId);
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: CODEX_HARNESS,
      model: TEST_MODEL_CODEX,
      workingDir: '/tmp/codex',
      maxReasoningLevel: 'high',
    });

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      if (config) {
        await ctx.db.patch(config._id, {
          maxReasoningLevel: 'xhigh',
          desiredState: 'running',
        });
      }

      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (participant) {
        await ctx.db.patch(participant._id, { lastStatus: 'agent.exited' });
      }
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'wake up',
      type: 'message',
    });

    const restarts = await getInboxCommandsForChatroom(chatroomId, 'agent.restart');
    const restart = restarts.at(-1);
    expect(restart?.command.type).toBe('agent.restart');
    if (restart?.command.type === 'agent.restart') {
      expect(restart.command.maxReasoningLevel).toBe('xhigh');
    }
  });

  test('team-switch start reuses persisted cap', async () => {
    const { sessionId } = await createTestSession('test-max-reasoning-team-switch');
    const machineId = 'machine-max-reasoning-team-switch';
    await registerCodexMachine(sessionId, machineId);
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'trio',
      teamName: 'Trio Team',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamEntryPoint: 'planner',
    });

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'planner',
      type: 'remote',
      machineId,
      agentHarness: CODEX_HARNESS,
      model: TEST_MODEL_CODEX,
      workingDir: '/tmp/codex',
      maxReasoningLevel: 'high',
    });

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'builder',
    });

    const starts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const teamSwitchStart = starts.find(
      (row) =>
        row.command.type === 'agent.requestStart' &&
        row.command.reason === 'platform.team_switch' &&
        row.command.role === 'builder'
    );
    expect(teamSwitchStart?.command.type).toBe('agent.requestStart');
    if (teamSwitchStart?.command.type === 'agent.requestStart') {
      expect(teamSwitchStart.command.maxReasoningLevel).toBe('high');
    }
  });

  test('omitted cap remains valid and non-Codex config does not carry an active cap', async () => {
    const { sessionId } = await createTestSession('test-max-reasoning-non-codex');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-max-reasoning-non-codex';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      model: 'opencode/big-pickle',
      workingDir: '/tmp/opencode',
      maxReasoningLevel: 'high',
    });

    const configs = await t.query(api.machines.getTeamAgentConfigs, { sessionId, chatroomId });
    const builder = configs.find((c) => c.role === 'builder');
    expect(builder?.maxReasoningLevel).toBeUndefined();

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'opencode/big-pickle',
        agentHarness: 'opencode',
        workingDir: '/tmp/opencode',
      },
    });

    const starts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const start = starts.at(-1);
    expect(start?.command.type).toBe('agent.requestStart');
    if (start?.command.type === 'agent.requestStart') {
      expect(start.command.maxReasoningLevel).toBeUndefined();
    }
  });
});
