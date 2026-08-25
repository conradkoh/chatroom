/**
 * Convex mutations for agent stop requests (Stage 1 stub — delegates to requestAgentStop).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { agentStopReasonValidator } from '../src/domain/entities/agent';
import { createAgentStopCommand } from '../src/domain/usecase/agent/create-agent-stop-command';
import { agentStopScopeValidator, agentStopTargetStatusValidator } from '../src/domain/entities/agent-stop-command';
import { rollupAgentStopCommandStatus } from '../src/domain/usecase/agent/rollup-agent-stop-command';
import { reconcileUnreportedStopTargets } from '../src/domain/usecase/agent/reconcile-unreported-stop-targets';
import { selectConfigsForAgentStop } from '../src/domain/usecase/agent/select-agent-stop-configs';

export const requestAgent = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    role: v.string(),
    reason: v.optional(agentStopReasonValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const selectedConfigs = await selectConfigsForAgentStop(ctx, { chatroomId: args.chatroomId, scope: { kind: 'agent', role: args.role }, machineId: args.machineId });
    const result = await createAgentStopCommand(ctx, { chatroomId: args.chatroomId, scope: { kind: 'agent', role: args.role }, reason: args.reason ?? 'user.stop', requestedBy: auth.session.userId, selectedConfigs });
    return { ok: true as const, stopCommandId: result.stopCommandId };
  },
});

export const requestMachineScope = mutation({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms'), machineId: v.string(), scope: agentStopScopeValidator, reason: v.optional(agentStopReasonValidator) },
  handler: async (ctx, args) => {
    const auth = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const selectedConfigs = await selectConfigsForAgentStop(ctx, { chatroomId: args.chatroomId, scope: args.scope, machineId: args.machineId });
    const result = await createAgentStopCommand(ctx, { chatroomId: args.chatroomId, scope: args.scope, reason: args.reason ?? 'daemon.shutdown', requestedBy: auth.session.userId, selectedConfigs });
    return { ok: true as const, stopCommandId: result.stopCommandId, inboxCommandId: result.inboxCommandIdsByMachine[args.machineId] };
  },
});

export const requestChatroom = mutation({ args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms'), reason: v.optional(agentStopReasonValidator) }, handler: async (ctx, args) => {
  const auth = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
  const scope = { kind: 'chatroom' as const };
  const selectedConfigs = await selectConfigsForAgentStop(ctx, { chatroomId: args.chatroomId, scope });
  const result = await createAgentStopCommand(ctx, { chatroomId: args.chatroomId, scope, reason: args.reason ?? 'user.stop', requestedBy: auth.session.userId, selectedConfigs });
  return { ok: true as const, stopCommandId: result.stopCommandId };
} });
export const request = requestAgent;
export const requestScope = requestMachineScope;

export const reportTargetOutcome = mutation({
  args: { ...SessionIdArg, stopCommandId: v.id('chatroom_agentStopCommands'), chatroomId: v.id('chatroom_rooms'), machineId: v.string(), targetKey: v.string(), role: v.string(), pid: v.number(), status: agentStopTargetStatusValidator, outcome: v.optional(v.union(v.literal('stopped'), v.literal('already_stopped'), v.literal('failed'))), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
  await requireMachineOwner(ctx, args.sessionId, args.machineId);
  const target = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId_targetKey', (q) => q.eq('stopCommandId', args.stopCommandId).eq('targetKey', args.targetKey)).first();
  const fields = { status: args.status, outcome: args.outcome, errorMessage: args.errorMessage, completedAt: args.status === 'completed' || args.status === 'failed' ? Date.now() : undefined };
  if (target) await ctx.db.patch(target._id, fields); else await ctx.db.insert('chatroom_agentStopTargets', { stopCommandId: args.stopCommandId, chatroomId: args.chatroomId, machineId: args.machineId, role: args.role, pid: args.pid, targetKey: args.targetKey, revisionKey: `${args.stopCommandId}:${args.targetKey}`, ...fields });
  await rollupAgentStopCommandStatus(ctx, args.stopCommandId);
  return { ok: true as const };
  },
});

export const beginMachineExecution = mutation({ args: { ...SessionIdArg, stopCommandId: v.id('chatroom_agentStopCommands'), machineId: v.string(), inboxCommandId: v.id('chatroom_machineCommandInbox') }, handler: async (ctx, args) => {
  await requireMachineOwner(ctx, args.sessionId, args.machineId);
  const command = await ctx.db.get('chatroom_agentStopCommands', args.stopCommandId);
  if (!command) throw new Error('Stop command not found');
  const execution = await ctx.db.query('chatroom_agentStopMachineExecutions').withIndex('by_stopCommandId_machineId', (q) => q.eq('stopCommandId', args.stopCommandId).eq('machineId', args.machineId)).unique();
  if (!execution) throw new Error('Machine execution not found');
  const pendingTargets = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', args.stopCommandId)).collect();
  const shouldExecute = command.status === 'pending' || command.status === 'processing';
  if (!shouldExecute) return { scope: command.scope, reason: command.reason, chatroomId: command.chatroomId, shouldExecute: false, pendingTargets: [] };
  if (execution.status === 'pending') await ctx.db.patch(execution._id, { status: 'processing', claimedAt: Date.now(), inboxCommandId: args.inboxCommandId });
  if (command.status === 'pending') await ctx.db.patch(command._id, { status: 'processing' });
  return { scope: command.scope, reason: command.reason, chatroomId: command.chatroomId, shouldExecute: true, pendingTargets: pendingTargets.filter((target) => target.machineId === args.machineId && (target.status === 'pending' || target.status === 'processing')) };
}, });

export const reconcileMachineStopTargets = mutation({ args: { ...SessionIdArg, stopCommandId: v.id('chatroom_agentStopCommands'), machineId: v.string(), reportedTargetKeys: v.array(v.string()) }, handler: async (ctx, args) => {
  await requireMachineOwner(ctx, args.sessionId, args.machineId);
  await reconcileUnreportedStopTargets(ctx, { stopCommandId: args.stopCommandId, machineId: args.machineId, reportedTargetKeys: new Set(args.reportedTargetKeys) });
  return { ok: true as const };
} });

export const completeMachineExecution = mutation({ args: { ...SessionIdArg, stopCommandId: v.id('chatroom_agentStopCommands'), machineId: v.string(), status: v.union(v.literal('completed'), v.literal('failed')), errorMessage: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireMachineOwner(ctx, args.sessionId, args.machineId);
  const execution = await ctx.db.query('chatroom_agentStopMachineExecutions').withIndex('by_stopCommandId_machineId', (q) => q.eq('stopCommandId', args.stopCommandId).eq('machineId', args.machineId)).unique();
  if (!execution) throw new Error('Machine execution not found');
  if (execution.status !== 'completed' && execution.status !== 'failed') await ctx.db.patch(execution._id, { status: args.status, completedAt: Date.now(), errorMessage: args.errorMessage });
  await rollupAgentStopCommandStatus(ctx, args.stopCommandId);
  return { ok: true as const };
}, });
