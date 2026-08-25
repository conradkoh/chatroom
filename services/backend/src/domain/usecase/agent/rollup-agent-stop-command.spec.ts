import { describe, expect, test } from 'vitest';
import { t } from '../../../../test.setup';
import { rollupAgentStopCommandStatus } from './rollup-agent-stop-command';

describe('rollupAgentStopCommandStatus', () => {
  test('rolls terminal execution and target to completed', async () => { const ids = await t.run(async (ctx) => { const commandId = await ctx.db.insert('chatroom_agentStopCommands', { chatroomId: 'missing' as never, scope: { kind: 'chatroom' }, scopeKey: 'chatroom', reason: 'user.stop', status: 'processing', createdAt: Date.now() }); await ctx.db.insert('chatroom_agentStopMachineExecutions', { stopCommandId: commandId, chatroomId: 'missing' as never, machineId: 'm', status: 'completed', completedAt: Date.now() }); await ctx.db.insert('chatroom_agentStopTargets', { stopCommandId: commandId, chatroomId: 'missing' as never, machineId: 'm', role: 'builder', pid: 1, targetKey: 'm:builder:1', revisionKey: 'r', status: 'completed', outcome: 'stopped', completedAt: Date.now() }); await rollupAgentStopCommandStatus(ctx, commandId); return commandId; }); const command = await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', ids)); expect(command?.status).toBe('completed'); });
});
