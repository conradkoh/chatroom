/** Chatroom-level agent lifecycle fan-out integration coverage. */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  getCommandEvents,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('agents.requestChatroomAgentOperation', () => {
  test('does not start or restart the reserved user role', async () => {
    const { sessionId } = await createTestSession('chatroom-agent-operation-user-role');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'custom-user-role-test',
    });
    await t.run((ctx) =>
      ctx.db.patch('chatroom_rooms', chatroomId, {
        teamRoles: ['user'],
        teamEntryPoint: 'user',
      })
    );
    const machineId = 'machine-chatroom-agent-operation-user-role';
    await registerMachineWithDaemon(sessionId, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace/user-role',
      hostname: 'test-host',
      registeredBy: 'user',
    });
    await t.mutation(api.agents.saveConfig, {
      sessionId,
      chatroomId,
      workspaceId,
      role: 'user',
      machineId,
      agentHarness: 'opencode',
      model: 'test-model',
      workingDir: '/workspace/user-role',
    });

    for (const operation of ['start', 'restart'] as const) {
      const result = await t.mutation(api.agents.requestChatroomAgentOperation, {
        sessionId,
        chatroomId,
        operation,
      });

      expect(result.requested).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.skipped).toEqual([]);
    }
    // Registering the workspace enqueues a daemon.gitRefresh; only agent commands matter here.
    const agentCommands = (await getCommandEvents(sessionId, machineId)).filter(
      (event) => event.type !== 'daemon.gitRefresh'
    );
    expect(agentCommands).toEqual([]);
  });

  test('starts and restarts a configured ephemeral-tagged role through the generic path', async () => {
    const { sessionId } = await createTestSession('chatroom-agent-operation-ephemeral');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder', 'architect'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'machine-chatroom-agent-operation-ephemeral';
    await registerMachineWithDaemon(sessionId, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace/ephemeral',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    await t.mutation(api.agents.saveConfig, {
      sessionId,
      chatroomId,
      workspaceId,
      role: 'architect',
      machineId,
      agentHarness: 'opencode',
      model: 'test-model',
      workingDir: '/workspace/ephemeral',
    });

    const started = await t.mutation(api.agents.requestChatroomAgentOperation, {
      sessionId,
      chatroomId,
      operation: 'start',
    });
    expect(started.requested).toEqual(
      expect.arrayContaining([{ role: 'architect', workspaceId, machineId }])
    );
    expect(started.failed).toEqual([]);
    expect(
      (await getCommandEvents(sessionId, machineId)).some(
        (event) => event.type === 'agent.requestStart' && event.role === 'architect'
      )
    ).toBe(true);

    const restarted = await t.mutation(api.agents.requestChatroomAgentOperation, {
      sessionId,
      chatroomId,
      operation: 'restart',
    });
    expect(restarted.requested).toEqual(
      expect.arrayContaining([{ role: 'architect', workspaceId, machineId }])
    );
    expect(restarted.failed).toEqual([]);
    expect(
      (await getCommandEvents(sessionId, machineId)).some(
        (event) => event.type === 'agent.restart' && event.role === 'architect'
      )
    ).toBe(true);
  });

  test('start requests a never-run configured ephemeral role and skips unconfigured roles', async () => {
    const { sessionId } = await createTestSession('chatroom-agent-operation-never-run');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-chatroom-agent-operation-never-run';
    await registerMachineWithDaemon(sessionId, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace/never-run',
      hostname: 'test-host',
      registeredBy: 'builder',
    });
    await t.mutation(api.agents.saveConfig, {
      sessionId,
      chatroomId,
      workspaceId,
      role: 'architect',
      machineId,
      agentHarness: 'opencode',
      model: 'test-model',
      workingDir: '/workspace/never-run',
    });

    const result = await t.mutation(api.agents.requestChatroomAgentOperation, {
      sessionId,
      chatroomId,
      operation: 'start',
    });

    expect(result.requested).toEqual([{ role: 'architect', workspaceId, machineId }]);
    expect(result.failed).toEqual([]);
    const unconfiguredRoles = ['planner', 'builder', 'triage', 'uiux-engineer', 'researcher'];
    expect(result.skipped).toEqual(
      expect.arrayContaining(
        unconfiguredRoles.map((role) =>
          expect.objectContaining({ role, reason: 'No saved launch configuration' })
        )
      )
    );
    expect(result.skipped.map(({ role }) => role)).not.toContain('architect');
  });

  test('queues one workspace-scoped stop per active workspace', async () => {
    const { sessionId } = await createTestSession('chatroom-agent-operation');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-chatroom-agent-operation';
    await registerMachineWithDaemon(sessionId, machineId);

    for (const workingDir of ['/workspace/one', '/workspace/two']) {
      await t.mutation(api.workspaces.registerWorkspace, {
        sessionId,
        chatroomId,
        machineId,
        workingDir,
        hostname: 'test-host',
        registeredBy: 'builder',
      });
    }

    const result = await t.mutation(api.agents.requestChatroomAgentOperation, {
      sessionId,
      chatroomId,
      operation: 'stop',
    });

    expect(result.commandIds).toHaveLength(2);
    const queued = await t.query(api.daemon.machineCommandInbox.list, { sessionId, machineId });
    expect(queued.map((row) => row.command)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.stop', workingDir: '/workspace/one' }),
        expect.objectContaining({ type: 'agent.stop', workingDir: '/workspace/two' }),
      ])
    );
  });
});
