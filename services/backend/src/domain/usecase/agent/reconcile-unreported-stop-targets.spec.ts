import { describe, expect, test } from 'vitest';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';
import { reconcileUnreportedStopTargets } from './reconcile-unreported-stop-targets';

describe('reconcileUnreportedStopTargets', () => {
  test('does not fabricate already_stopped for unreported targets', async () => {
    const sessionId = 'reconcile-spec' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, { sessionId, teamId: 'duo', teamName: 'Duo', teamRoles: ['planner', 'builder'], teamEntryPoint: 'planner' });
    const ids = await t.run(async (ctx) => {
      const commandId = await ctx.db.insert('chatroom_agentStopCommands', { chatroomId, scope: { kind: 'chatroom' }, scopeKey: 'chatroom', reason: 'user.stop', status: 'processing', createdAt: Date.now() });
      await ctx.db.insert('chatroom_agentStopTargets', { stopCommandId: commandId, chatroomId, machineId: 'machine', role: 'builder', pid: 1, targetKey: 'target', revisionKey: 'revision', status: 'processing' });
      await ctx.db.insert('chatroom_agentStopMachineExecutions', { stopCommandId: commandId, chatroomId, machineId: 'machine', status: 'completed' });
      return commandId;
    });
    await t.run((ctx) => reconcileUnreportedStopTargets(ctx, { stopCommandId: ids, machineId: 'machine', reportedTargetKeys: new Set() }));
    const target = await t.run((ctx) => ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', ids)).first());
    expect(target?.status).toBe('processing');
    expect(target?.outcome).toBeUndefined();
  });
});
