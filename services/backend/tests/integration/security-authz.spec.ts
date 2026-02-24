import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createPairTeamChatroom, createTestSession, joinParticipant } from '../helpers/integration';

describe('security authz protections', () => {
  test('getTasksByIds does not return tasks from unauthorized chatrooms', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker');

    const ownerChatroomId = await createPairTeamChatroom(ownerSession);
    const attackerChatroomId = await createPairTeamChatroom(attackerSession);

    await joinParticipant(ownerSession, ownerChatroomId, 'builder');
    await joinParticipant(attackerSession, attackerChatroomId, 'builder');

    const ownerTask = await t.mutation(api.tasks.createTask, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      content: 'Owner task',
      createdBy: 'user',
      isBacklog: false,
    });

    const attackerTask = await t.mutation(api.tasks.createTask, {
      sessionId: attackerSession,
      chatroomId: attackerChatroomId,
      content: 'Attacker task',
      createdBy: 'user',
      isBacklog: false,
    });

    const leakedTasks = await t.query(api.tasks.getTasksByIds, {
      sessionId: attackerSession,
      taskIds: [ownerTask.taskId, attackerTask.taskId],
    });

    expect(leakedTasks).toHaveLength(1);
    expect(leakedTasks[0]?._id).toBe(attackerTask.taskId);
  });

  test('saveTeamAgentConfig rejects non-owner access', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner-save');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker-save');

    const ownerChatroomId = await createPairTeamChatroom(ownerSession);

    await expect(
      t.mutation(api.machines.saveTeamAgentConfig, {
        sessionId: attackerSession,
        chatroomId: ownerChatroomId,
        role: 'builder',
        type: 'custom',
      })
    ).rejects.toThrow('Not authorized');
  });

  test('getTeamAgentConfigs returns empty for non-owner access', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner-read');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker-read');

    const ownerChatroomId = await createPairTeamChatroom(ownerSession);

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      role: 'builder',
      type: 'custom',
    });

    const configs = await t.query(api.machines.getTeamAgentConfigs, {
      sessionId: attackerSession,
      chatroomId: ownerChatroomId,
    });

    expect(configs).toEqual([]);
  });
});
