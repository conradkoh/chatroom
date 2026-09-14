import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('security authz protections', () => {
  test('getTasksByIds does not return tasks from unauthorized chatrooms', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker');

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    const attackerChatroomId = await createDuoTeamChatroom(attackerSession);

    await joinParticipant(ownerSession, ownerChatroomId, 'builder');
    await joinParticipant(attackerSession, attackerChatroomId, 'builder');

    const ownerTask = await t.mutation(api.tasks.createTask, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      content: 'Owner task',
      createdBy: 'user',
    });

    const attackerTask = await t.mutation(api.tasks.createTask, {
      sessionId: attackerSession,
      chatroomId: attackerChatroomId,
      content: 'Attacker task',
      createdBy: 'user',
    });

    const leakedTasks = await t.query(api.tasks.getTasksByIds, {
      sessionId: attackerSession,
      taskIds: [ownerTask.taskId, attackerTask.taskId],
    });

    expect(leakedTasks).toHaveLength(1);
    expect(leakedTasks[0]?._id).toBe(attackerTask.taskId);
  });

  test('saveConfig rejects non-owner access', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner-save');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker-save');

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    const machineId = 'machine-sec-owner-save';
    await registerMachineWithDaemon(ownerSession, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      machineId,
      workingDir: '/test/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });

    await expect(
      t.mutation(api.agents.saveConfig, {
        sessionId: attackerSession,
        chatroomId: ownerChatroomId,
        role: 'builder',
        workspaceId,
        machineId,
        agentHarness: 'opencode',
        model: 'auto',
        workingDir: '/test/workspace',
      })
    ).rejects.toThrow('Access denied');
  });

  test('listLastSentLaunchRequests rejects non-owner access', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner-read');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker-read');

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    const machineId = 'machine-sec-owner-read';
    await registerMachineWithDaemon(ownerSession, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      machineId,
      workingDir: '/test/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });

    await t.mutation(api.agents.saveConfig, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      workspaceId,
      role: 'builder',
      machineId,
      agentHarness: 'opencode',
      model: 'auto',
      workingDir: '/test/workspace',
    });

    await expect(
      t.query(api.agents.listLastSentLaunchRequests, {
        sessionId: attackerSession,
        chatroomId: ownerChatroomId,
      })
    ).rejects.toThrow('Access denied');
  });
});
