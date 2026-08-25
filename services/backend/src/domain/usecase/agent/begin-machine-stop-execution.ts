import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentStopTargetDescriptor } from '@workspace/shared/domain/agent-stop-command';
import { AGENT_STOP_EXPIRY_LEASE_GRACE_MS } from '../../../../config/reliability';
import { terminalizeExpiredStopCommand } from './terminalize-expired-stop-command';
export async function beginMachineStopExecution(ctx: MutationCtx, args: { stopCommandId: Id<'chatroom_agentStopCommands'>; machineId: string; inboxCommandId: Id<'chatroom_machineCommandInbox'> }) {
  const command = await ctx.db.get('chatroom_agentStopCommands', args.stopCommandId); if (!command) throw new Error('Stop command not found');
  const empty = { shouldExecute: false as const, scope: command.scope, reason: command.reason, chatroomId: command.chatroomId, targets: [] as AgentStopTargetDescriptor[], pendingTargets: [] as any[] };
  if ((command.deadlineAt != null && Date.now() > command.deadlineAt + AGENT_STOP_EXPIRY_LEASE_GRACE_MS) || ['superseded','completed','failed'].includes(command.status)) { if (command.status === 'pending' || command.status === 'processing') await terminalizeExpiredStopCommand(ctx, command._id); return empty; }
  const execution = await ctx.db.query('chatroom_agentStopMachineExecutions').withIndex('by_stopCommandId_machineId', q => q.eq('stopCommandId', args.stopCommandId).eq('machineId', args.machineId)).unique(); if (!execution) throw new Error('Machine execution not found');
  if (execution.inboxCommandId && execution.inboxCommandId !== args.inboxCommandId) return empty;
  const pendingTargets = (await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId_machineId', q => q.eq('stopCommandId', args.stopCommandId).eq('machineId', args.machineId)).collect()).filter(t => t.status === 'pending' || t.status === 'processing');
  if (execution.status === 'pending') await ctx.db.patch(execution._id, { status: 'processing', claimedAt: Date.now(), inboxCommandId: args.inboxCommandId });
  if (command.status === 'pending') await ctx.db.patch(command._id, { status: 'processing' });
  const targets = pendingTargets.filter(t => t.agentConfigId && t.agentHarness).map(t => ({ agentConfigId: t.agentConfigId!, chatroomId: t.chatroomId, machineId: t.machineId, role: t.role, pid: t.pid, agentHarness: t.agentHarness!, targetKey: t.targetKey }));
  return { shouldExecute: true as const, scope: command.scope, reason: command.reason, chatroomId: command.chatroomId, targets, pendingTargets };
}
