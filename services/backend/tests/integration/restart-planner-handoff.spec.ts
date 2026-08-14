import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { restartPlannerOnHandoffToUser } from '../../src/domain/usecase/agent/restart-planner-on-handoff-to-user';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { TEST_MODEL_CURSOR_SDK } from '../helpers/test-models';

describe('planner handoff restart', () => {
  test('preserves the complete persisted remote config in agent.restart', async () => {
    const { sessionId } = await createTestSession('planner-handoff-restart');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const machineId = 'machine-planner-handoff-restart';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['cursor-sdk'],
      availableModels: { 'cursor-sdk': [TEST_MODEL_CURSOR_SDK] },
    });
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner', {
      agentHarness: 'cursor-sdk',
      workingDir: '/distinct/planner/workspace',
    });

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
        )
        .first();
      expect(config).toBeDefined();
      if (config) {
        await ctx.db.patch(config._id, {
          model: 'distinct-model',
          wantResume: true,
          plannerRestartOnHandoffToUser: true,
        });
      }
    });

    await t.run(async (ctx) => {
      await restartPlannerOnHandoffToUser(ctx, { chatroomId, teamId: 'duo' });
    });

    const event = await t.run(async (ctx) => {
      const events = await ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      return events.find((candidate) => candidate.type === 'agent.restart');
    });
    expect(event?.type).toBe('agent.restart');
    if (event?.type === 'agent.restart') {
      expect(event.machineId).toBe(machineId);
      expect(event.agentHarness).toBe('cursor-sdk');
      expect(event.model).toBe('distinct-model');
      expect(event.workingDir).toBe('/distinct/planner/workspace');
      expect(event.wantResume).toBe(true);
      expect(event.correlationId).toEqual(expect.any(String));
    }

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
        )
        .first();
      expect(config).toMatchObject({
        machineId,
        agentHarness: 'cursor-sdk',
        model: 'distinct-model',
        workingDir: '/distinct/planner/workspace',
        wantResume: true,
      });
    });
  });
});
