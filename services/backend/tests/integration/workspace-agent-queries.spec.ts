/** Workspace-scoped agent query integration tests. */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function registerWorkspace(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId: sessionId as any,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'test',
  });
}

describe('workspace-scoped agent queries', () => {
  test('returns the most recently registered active workspace without liveness filtering', async () => {
    const { sessionId } = await createTestSession('test-wsq-active-workspace');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    const machineId = 'machine-wsq-active-workspace';
    await registerMachineWithDaemon(sessionId as any, machineId);

    await registerWorkspace(sessionId, chatroomId, machineId, '/workspace/old');
    const newestWorkspaceId = await registerWorkspace(
      sessionId,
      chatroomId,
      machineId,
      '/workspace/new'
    );
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_workspaces', newestWorkspaceId, {
        registeredAt: 9_999_999_999_999,
      });
    });
    await t.mutation(api.machines.markDaemonOffline, {
      sessionId: sessionId as any,
      machineId,
    });

    const result = await t.query(api.workspaces.getActiveWorkspaceForChatroom, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result?._id).toBe(newestWorkspaceId);
    expect(result?.workingDir).toBe('/workspace/new');
  });

  test('lists and reads config independently from the status projection', async () => {
    const { sessionId } = await createTestSession('test-wsq-agent-data');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    const machineId = 'machine-wsq-agent-data';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const workspaceId = await registerWorkspace(
      sessionId,
      chatroomId,
      machineId,
      '/test/workspace'
    );
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const agents = await t.query(api.agentWorkspaces.listAgentsForWorkspace, {
      sessionId: sessionId as any,
      workspaceId,
    });
    expect(agents).toEqual([{ role: 'builder', type: 'remote', teamId: 'duo' }]);

    const config = await t.query(api.agentWorkspaces.getAgentConfigForWorkspaceRole, {
      sessionId: sessionId as any,
      workspaceId,
      role: 'BUILDER',
    });
    expect(config).toMatchObject({
      role: 'builder',
      machineId,
      workingDir: '/test/workspace',
    });

    const status = await t.query(api.agentWorkspaces.getAgentStatusForWorkspaceRole, {
      sessionId: sessionId as any,
      workspaceId,
      role: 'builder',
    });
    expect(status?.role).toBe('builder');
    expect(['offline', 'starting', 'waiting', 'working', 'stopping', 'error']).toContain(
      status?.status
    );
  });

  test('does not return a role status from another workspace machine', async () => {
    const { sessionId } = await createTestSession('test-wsq-status-scope');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    const machineA = 'machine-wsq-status-a';
    const machineB = 'machine-wsq-status-b';
    await registerMachineWithDaemon(sessionId as any, machineA);
    await registerMachineWithDaemon(sessionId as any, machineB);
    const workspaceA = await registerWorkspace(sessionId, chatroomId, machineA, '/workspace/a');
    const workspaceB = await registerWorkspace(sessionId, chatroomId, machineB, '/workspace/b');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineA, 'builder', {
      workingDir: '/workspace/a',
    });

    const statusForOtherWorkspace = await t.query(
      api.agentWorkspaces.getAgentStatusForWorkspaceRole,
      {
        sessionId: sessionId as any,
        workspaceId: workspaceB,
        role: 'builder',
      }
    );
    expect(statusForOtherWorkspace).toBeNull();

    const statusForConfiguredWorkspace = await t.query(
      api.agentWorkspaces.getAgentStatusForWorkspaceRole,
      {
        sessionId: sessionId as any,
        workspaceId: workspaceA,
        role: 'builder',
      }
    );
    expect(statusForConfiguredWorkspace?.role).toBe('builder');
  });
});
