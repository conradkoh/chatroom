import { advanceAgentLifecycleRevision } from './advance-agent-lifecycle-revision';
import { projectAgentStopStateForRole } from './project-agent-operational-status';
import type { AgentStopSelectedConfig } from './select-agent-stop-configs';
import { supersedeInflightAgentStopCommands } from './supersede-inflight-agent-stop-commands';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentStopReason , AgentPostStopDesiredState } from '../../entities/agent';
import {
  agentStopScopeKey,
  buildAgentStopRevisionKey,
  buildAgentStopTargetKey,
  normalizeAgentStopRole,
  type AgentStopScope,
} from '../../entities/agent-stop-command';
import { interruptEnhancerJobsOnChatroomStop } from '../enhancer/interrupt-enhancer-jobs-on-chatroom-stop';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

export interface CreateAgentStopCommandInput {
  chatroomId: Id<'chatroom_rooms'>;
  scope: AgentStopScope;
  reason: AgentStopReason;
  requestedBy?: Id<'users'>;
  selectedConfigs: AgentStopSelectedConfig[];
  postStopDesiredState?: AgentPostStopDesiredState;
}
export interface CreateAgentStopCommandResult {
  stopCommandId: Id<'chatroom_agentStopCommands'>;
  inboxCommandIdsByMachine: Record<string, Id<'chatroom_machineCommandInbox'>>;
}

export async function createAgentStopCommand(
  ctx: MutationCtx,
  input: CreateAgentStopCommandInput
): Promise<CreateAgentStopCommandResult> {
  const scopeKey = agentStopScopeKey(input.scope);
  await supersedeInflightAgentStopCommands(ctx, { chatroomId: input.chatroomId });
  if (input.scope.kind === 'chatroom') {
    await interruptEnhancerJobsOnChatroomStop(ctx, input.chatroomId);
  }
  const now = Date.now();
  const stopCommandId = await ctx.db.insert('chatroom_agentStopCommands', {
    chatroomId: input.chatroomId,
    scope: input.scope,
    scopeKey,
    reason: input.reason,
    requestedBy: input.requestedBy,
    status: 'pending',
    deadlineAt: now + AGENT_REQUEST_DEADLINE_MS,
    createdAt: now,
    postStopDesiredState: input.postStopDesiredState ?? 'stopped',
  });
  for (const config of input.selectedConfigs) {
    await advanceAgentLifecycleRevision(ctx, config._id);
    await patchTeamAgentConfig(
      ctx,
      config._id,
      { desiredState: 'stopped' },
      { projectScope: 'chatroom' }
    );
  }
  for (const target of input.selectedConfigs) {
    const targetKey = buildAgentStopTargetKey({
      machineId: target.machineId!,
      role: target.role,
      pid: target.spawnedAgentPid!,
    });
    await ctx.db.insert('chatroom_agentStopTargets', {
      stopCommandId,
      chatroomId: input.chatroomId,
      agentConfigId: target._id,
      agentHarness: target.agentHarness,
      machineId: target.machineId!,
      role: normalizeAgentStopRole(target.role),
      pid: target.spawnedAgentPid!,
      targetKey,
      revisionKey: buildAgentStopRevisionKey({ stopCommandId, targetKey }),
      status: 'pending',
    });
  }
  const inboxCommandIdsByMachine: Record<string, Id<'chatroom_machineCommandInbox'>> = {};
  for (const machineId of [...new Set(input.selectedConfigs.map((target) => target.machineId))]) {
    const inboxCommandId = await enqueueMachineCommand(ctx, {
      machineId,
      now: Date.now(),
      command: {
        type: 'agent.stopScope',
        stopCommandId,
        chatroomId: input.chatroomId,
        scope: input.scope,
        reason: input.reason,
      },
    });
    inboxCommandIdsByMachine[machineId] = inboxCommandId;
    await ctx.db.insert('chatroom_agentStopMachineExecutions', {
      stopCommandId,
      chatroomId: input.chatroomId,
      machineId,
      inboxCommandId,
      status: 'pending',
    });
  }
  if (input.selectedConfigs.length === 0)
    await ctx.db.patch('chatroom_agentStopCommands', stopCommandId, {
      status: 'completed',
      completedAt: Date.now(),
    });
  for (const role of [...new Set(input.selectedConfigs.map((config) => config.role))])
    await projectAgentStopStateForRole(ctx, input.chatroomId, role);
  return { stopCommandId, inboxCommandIdsByMachine };
}
