import { describe, expect, test } from 'vitest';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';
import { rollupAgentStopCommandStatus } from './rollup-agent-stop-command';

describe('rollupAgentStopCommandStatus', () => {
  test('rolls terminal execution and target to completed', async () => {
    const sessionId = 'rollup-stop-1' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, { sessionId, teamId: 'duo', teamName: 'Duo', teamRoles: ['planner', 'builder'], teamEntryPoint: 'planner' });
    const commandId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_agentStopCommands', { chatroomId, scope: { kind: 'chatroom' }, scopeKey: 'chatroom', reason: 'user.stop', status: 'processing', createdAt: Date.now() });
      await ctx.db.insert('chatroom_agentStopMachineExecutions', { stopCommandId: id, chatroomId, machineId: 'm', status: 'completed', completedAt: Date.now() });
      await ctx.db.insert('chatroom_agentStopTargets', { stopCommandId: id, chatroomId, machineId: 'm', role: 'builder', pid: 1, targetKey: 'm:builder:1', revisionKey: 'r', status: 'completed', outcome: 'stopped', completedAt: Date.now() });
      await rollupAgentStopCommandStatus(ctx, id); return id;
    });
    const command = await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', commandId));
    expect(command?.status).toBe('completed');
  });
});
