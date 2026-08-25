import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentStopReason } from '../../entities/agent';
import { agentStopScopeKey, buildAgentStopRevisionKey, buildAgentStopTargetKey, normalizeAgentStopRole, type AgentStopScope } from '../../entities/agent-stop-command';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';
import { projectAgentStopStateForRole } from './project-agent-operational-status';

export interface CreateAgentStopCommandInput { chatroomId: Id<'chatroom_rooms'>; scope: AgentStopScope; reason: AgentStopReason; requestedBy?: Id<'users'>; machineId?: string; }
export interface CreateAgentStopCommandResult { stopCommandId: Id<'chatroom_agentStopCommands'>; coalesced: boolean; }

export async function createAgentStopCommand(ctx: MutationCtx, input: CreateAgentStopCommandInput): Promise<CreateAgentStopCommandResult> {
  const scopeKey = agentStopScopeKey(input.scope);
  for (const status of ['pending', 'processing'] as const) {
    const existing = await ctx.db.query('chatroom_agentStopCommands').withIndex('by_chatroom_scopeKey_status', (q) => q.eq('chatroomId', input.chatroomId).eq('scopeKey', scopeKey).eq('status', status)).first();
    if (existing) return { stopCommandId: existing._id, coalesced: true };
  }
  const configs = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId)).collect();
  const matchingConfigs = configs.filter((config) => !!config.machineId && (!input.machineId || config.machineId === input.machineId) && (input.scope.kind === 'chatroom' || normalizeAgentStopRole(config.role) === normalizeAgentStopRole(input.scope.role)));
  const targets = matchingConfigs.filter((config) => config.spawnedAgentPid != null);
  const stopCommandId = await ctx.db.insert('chatroom_agentStopCommands', { chatroomId: input.chatroomId, scope: input.scope, scopeKey, reason: input.reason, requestedBy: input.requestedBy, status: 'pending', createdAt: Date.now() });
  for (const config of matchingConfigs) await patchTeamAgentConfig(ctx, config._id, { desiredState: 'stopped' }, { projectScope: 'chatroom' });
  for (const target of targets) {
    const targetKey = buildAgentStopTargetKey({ machineId: target.machineId!, role: target.role, pid: target.spawnedAgentPid! });
    await ctx.db.insert('chatroom_agentStopTargets', { stopCommandId, chatroomId: input.chatroomId, machineId: target.machineId!, role: target.role, pid: target.spawnedAgentPid!, targetKey, revisionKey: buildAgentStopRevisionKey({ stopCommandId, targetKey }), status: 'pending' });
  }
  for (const machineId of [...new Set(targets.map((target) => target.machineId!))]) {
    const inboxCommandId = await enqueueMachineCommand(ctx, { machineId, now: Date.now(), command: { type: 'agent.stopScope', stopCommandId, chatroomId: input.chatroomId, scope: input.scope, reason: input.reason } });
    await ctx.db.insert('chatroom_agentStopMachineExecutions', { stopCommandId, chatroomId: input.chatroomId, machineId, inboxCommandId, status: 'pending' });
  }
  if (targets.length === 0) await ctx.db.patch('chatroom_agentStopCommands', stopCommandId, { status: 'completed', completedAt: Date.now() });
  for (const role of [...new Set(matchingConfigs.map((config) => config.role))]) await projectAgentStopStateForRole(ctx, input.chatroomId, role);
  return { stopCommandId, coalesced: false };
}
