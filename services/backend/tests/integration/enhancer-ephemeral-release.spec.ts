import { describe, expect, test } from 'vitest';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession } from '../helpers/integration';
import { api } from '../../convex/_generated/api';
import { transitionTask } from '../../src/domain/usecase/task/transition-task';

describe('ephemeral enhancer release', () => {
  test('terminal enhancer task creates a release stop command', async () => {
    const { sessionId } = await createTestSession('enhancer-ephemeral-release');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await t.run(async (ctx) => {
      await ctx.db.patch(chatroomId, { teamRoles: ['planner', 'enhancer', 'builder'] });
      await ctx.db.insert('chatroom_teamAgentConfigs', { teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'enhancer'), chatroomId, role: 'enhancer', type: 'remote', machineId: 'release-machine', agentHarness: 'opencode', model: 'test', workingDir: '/workspace', enabled: true, desiredState: 'running', spawnedAgentPid: 4242, lifecycleRevision: 0, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const taskId = await t.run((ctx) => ctx.db.insert('chatroom_tasks', { chatroomId, createdBy: 'user', content: 'Enhance', status: 'in_progress', assignedTo: 'enhancer', createdAt: Date.now(), updatedAt: Date.now(), queuePosition: 1 }));
    await t.run((ctx) => transitionTask(ctx, taskId, 'completed', 'completeTaskById'));
    const command = await t.run((ctx) => ctx.db.query('chatroom_agentStopCommands').withIndex('by_chatroom_scopeKey_status', (q) => q.eq('chatroomId', chatroomId)).collect()).then((rows) => rows.find((row) => row.reason === 'platform.ephemeral_task_complete'));
    expect(command?.postStopDesiredState).toBe('running');
    const target = await t.run((ctx) => ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', command!._id)).first());
    expect(target?.pid).toBe(4242);
  });
});
