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
import { agentStopTargetStatusValidator } from '../src/domain/entities/agent-stop-command';

export const request = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    role: v.string(),
    reason: v.optional(agentStopReasonValidator),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const result = await createAgentStopCommand(ctx, { machineId: args.machineId, chatroomId: args.chatroomId, scope: { kind: 'agent', role: args.role }, reason: args.reason ?? 'user.stop' });
    return { ok: true as const, stopCommandId: result.stopCommandId, coalesced: result.coalesced };
  },
});

export const reportTargetOutcome = mutation({
  args: { ...SessionIdArg, stopCommandId: v.id('chatroom_agentStopCommands'), machineId: v.string(), targetKey: v.string(), role: v.string(), pid: v.number(), status: agentStopTargetStatusValidator, outcome: v.optional(v.union(v.literal('stopped'), v.literal('already_stopped'), v.literal('failed'))), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
  await requireMachineOwner(ctx, args.sessionId, args.machineId);
  const target = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId_targetKey', (q) => q.eq('stopCommandId', args.stopCommandId).eq('targetKey', args.targetKey)).first();
  const fields = { status: args.status, outcome: args.outcome, errorMessage: args.errorMessage, completedAt: args.status === 'completed' || args.status === 'failed' ? Date.now() : undefined };
  if (target) await ctx.db.patch(target._id, fields); else await ctx.db.insert('chatroom_agentStopTargets', { stopCommandId: args.stopCommandId, chatroomId: 'unknown' as never, machineId: args.machineId, role: args.role, pid: args.pid, targetKey: args.targetKey, revisionKey: `${args.stopCommandId}:${args.targetKey}`, ...fields });
  return { ok: true as const };
  },
});
