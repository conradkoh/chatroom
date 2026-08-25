/**
 * Convex mutations for agent stop commands — request boundaries and guarded state-machine transitions.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { agentStopReasonValidator } from '../src/domain/entities/agent';
import {
  agentStopScopeValidator,
  agentStopTargetStatusValidator,
} from '../src/domain/entities/agent-stop-command';
import { applySuccessfulTargetLifecycle } from '../src/domain/usecase/agent/apply-successful-target-lifecycle';
import { beginMachineStopExecution } from '../src/domain/usecase/agent/begin-machine-stop-execution';
import { completeMachineStopExecution } from '../src/domain/usecase/agent/complete-machine-stop-execution';
import { createAgentStopCommand } from '../src/domain/usecase/agent/create-agent-stop-command';
import { reconcileUnreportedStopTargets } from '../src/domain/usecase/agent/reconcile-unreported-stop-targets';
import { rollupAgentStopCommandStatus } from '../src/domain/usecase/agent/rollup-agent-stop-command';
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

    const selectedConfigs = await selectConfigsForAgentStop(ctx, {
      chatroomId: args.chatroomId,
      scope: { kind: 'agent', role: args.role },
      machineId: args.machineId,
    });
    const result = await createAgentStopCommand(ctx, {
      chatroomId: args.chatroomId,
      scope: { kind: 'agent', role: args.role },
      reason: args.reason ?? 'user.stop',
      requestedBy: auth.session.userId,
      selectedConfigs,
    });
    return { ok: true as const, stopCommandId: result.stopCommandId };
  },
});

export const requestMachineScope = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    scope: agentStopScopeValidator,
    reason: v.optional(agentStopReasonValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const selectedConfigs = await selectConfigsForAgentStop(ctx, {
      chatroomId: args.chatroomId,
      scope: args.scope,
      machineId: args.machineId,
    });
    const result = await createAgentStopCommand(ctx, {
      chatroomId: args.chatroomId,
      scope: args.scope,
      reason: args.reason ?? 'daemon.shutdown',
      requestedBy: auth.session.userId,
      selectedConfigs,
    });
    return {
      ok: true as const,
      stopCommandId: result.stopCommandId,
      inboxCommandId: result.inboxCommandIdsByMachine[args.machineId],
    };
  },
});

export const requestChatroom = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    reason: v.optional(agentStopReasonValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const scope = { kind: 'chatroom' as const };
    const selectedConfigs = await selectConfigsForAgentStop(ctx, {
      chatroomId: args.chatroomId,
      scope,
    });
    const result = await createAgentStopCommand(ctx, {
      chatroomId: args.chatroomId,
      scope,
      reason: args.reason ?? 'user.stop',
      requestedBy: auth.session.userId,
      selectedConfigs,
    });
    return { ok: true as const, stopCommandId: result.stopCommandId };
  },
});
export const request = requestAgent;
export const requestScope = requestMachineScope;

export const reportTargetOutcome = mutation({
  args: {
    ...SessionIdArg,
    stopCommandId: v.id('chatroom_agentStopCommands'),
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    targetKey: v.string(),
    role: v.string(),
    pid: v.number(),
    status: agentStopTargetStatusValidator,
    outcome: v.optional(
      v.union(v.literal('stopped'), v.literal('already_stopped'), v.literal('failed'))
    ),
    errorMessage: v.optional(v.string()),
    termination: v.optional(
      v.union(v.literal('graceful'), v.literal('forced'), v.literal('absent'))
    ),
    lifecycleWarning: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const target = await ctx.db
      .query('chatroom_agentStopTargets')
      .withIndex('by_stopCommandId_targetKey', (q) =>
        q.eq('stopCommandId', args.stopCommandId).eq('targetKey', args.targetKey)
      )
      .first();
    const fields = {
      status: args.status,
      ...(args.outcome !== 'failed' ? { outcome: args.outcome } : {}),
      errorMessage: args.errorMessage,
      ...(args.termination ? { termination: args.termination } : {}),
      ...(args.lifecycleWarning ? { lifecycleWarning: args.lifecycleWarning } : {}),
      completedAt: args.status === 'completed' || args.status === 'failed' ? Date.now() : undefined,
    };
    if (!target) return { ok: true as const, applied: false };
    if (
      target.status === 'completed' ||
      target.status === 'failed' ||
      target.status === 'superseded'
    )
      return { ok: true as const, applied: false };
    await ctx.db.patch('chatroom_agentStopTargets', target._id, fields);
    const command = await ctx.db.get('chatroom_agentStopCommands', args.stopCommandId);
    const updatedTarget = await ctx.db.get('chatroom_agentStopTargets', target._id);
    if (command && updatedTarget)
      await applySuccessfulTargetLifecycle(ctx, { command, target: updatedTarget });
    await rollupAgentStopCommandStatus(ctx, args.stopCommandId);
    return { ok: true as const, applied: true };
  },
});

export const beginMachineExecution = mutation({
  args: {
    ...SessionIdArg,
    stopCommandId: v.id('chatroom_agentStopCommands'),
    machineId: v.string(),
    inboxCommandId: v.id('chatroom_machineCommandInbox'),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return beginMachineStopExecution(ctx, args);
  },
});

export const reconcileMachineStopTargets = mutation({
  args: {
    ...SessionIdArg,
    stopCommandId: v.id('chatroom_agentStopCommands'),
    machineId: v.string(),
    reportedTargetKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await reconcileUnreportedStopTargets(ctx, {
      stopCommandId: args.stopCommandId,
      machineId: args.machineId,
      reportedTargetKeys: new Set(args.reportedTargetKeys),
    });
    return { ok: true as const };
  },
});

export const completeMachineExecution = mutation({
  args: {
    ...SessionIdArg,
    stopCommandId: v.id('chatroom_agentStopCommands'),
    machineId: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await completeMachineStopExecution(ctx, args);
    return { ok: true as const };
  },
});
