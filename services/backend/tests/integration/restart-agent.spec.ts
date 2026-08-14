import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { TEST_MODEL_CURSOR_SDK } from '../helpers/test-models';

describe('restart-agent use case', () => {
  test('sendCommand restart-agent releases in-flight tasks and emits agent.restart', async () => {
    const { sessionId } = await createTestSession('test-restart-agent');
    const machineId = 'machine-restart-agent-1';

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['cursor-sdk'],
      availableModels: { 'cursor-sdk': [TEST_MODEL_CURSOR_SDK] },
    });

    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', {
      agentHarness: 'cursor-sdk',
    });

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'In-flight before restart',
      createdBy: 'user',
    });

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'restart-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: TEST_MODEL_CURSOR_SDK,
        agentHarness: 'cursor-sdk',
        workingDir: '/tmp/project',
        wantResume: true,
      },
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('pending');

    const restartEvent = await t.run(async (ctx) => {
      const events = await ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_machineId_type', (q) =>
          q.eq('machineId', machineId).eq('type', 'agent.restart')
        )
        .collect();
      return events.at(-1);
    });

    expect(restartEvent?.type).toBe('agent.restart');
    if (restartEvent?.type === 'agent.restart') {
      expect(restartEvent.role).toBe('builder');
      expect(restartEvent.machineId).toBe(machineId);
      expect(restartEvent.agentHarness).toBe('cursor-sdk');
      expect(restartEvent.model).toBe(TEST_MODEL_CURSOR_SDK);
      expect(restartEvent.workingDir).toBe('/tmp/project');
      expect(restartEvent.wantResume).toBe(true);
      expect(restartEvent.correlationId).toEqual(expect.any(String));
    }

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      expect(config).toMatchObject({
        machineId,
        agentHarness: 'cursor-sdk',
        model: TEST_MODEL_CURSOR_SDK,
        workingDir: '/tmp/project',
        wantResume: true,
      });
    });
  });
});
