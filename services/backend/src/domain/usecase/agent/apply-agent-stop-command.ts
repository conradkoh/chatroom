import { projectAgentStopStateForRole } from './project-agent-operational-status';
import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import {
  collectEphemeralStopMachineIds,
  releaseEphemeralAgentRolesWithoutStopTargets,
} from './release-ephemeral-agent-role';
import type { AgentStopSelectedConfig } from './select-agent-stop-configs';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentStopReason, AgentPostStopDesiredState } from '../../entities/agent';
import {
  agentStopScopeKey,
  buildAgentStopRevisionKey,
  buildAgentStopTargetKey,
  normalizeAgentStopRole,
  type AgentStopScope,
} from '../../entities/agent-stop-command';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { projectAssignedTaskSnapshotsForChatroom } from '../machine/machine-assigned-task-snapshot-sync';

export interface ApplyAgentStopCommandInput {
  chatroomId: Id<'chatroom_rooms'>;
  scope: AgentStopScope;
  reason: AgentStopReason;
  requestedBy?: Id<'users'>;
  selectedConfigs: AgentStopSelectedConfig[];
  postStopDesiredState?: AgentPostStopDesiredState;
}
export interface ApplyAgentStopCommandResult {
  stopCommandId: Id<'chatroom_agentStopCommands'>;
  inboxCommandIdsByMachine: Record<string, Id<'chatroom_machineCommandInbox'>>;
}

/** Persist and dispatch a stop command without chatroom-level enhancer interruption. */
// fallow-ignore-next-line complexity
export async function applyAgentStopCommand(
  ctx: MutationCtx,
  input: ApplyAgentStopCommandInput
): Promise<ApplyAgentStopCommandResult> {
  const scopeKey = agentStopScopeKey(input.scope);
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
    const now = Date.now();
    await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
      lifecycleRevision: (config.lifecycleRevision ?? 0) + 1,
      desiredState: 'stopped',
      updatedAt: now,
    });
  }
  if (input.selectedConfigs.length > 0) {
    await projectAssignedTaskSnapshotsForChatroom(ctx, input.chatroomId);
  }
  for (const target of input.selectedConfigs) {
    if (target.machineId === undefined || target.spawnedAgentPid === undefined) continue;
    const targetKey = buildAgentStopTargetKey({
      machineId: target.machineId,
      role: target.role,
      pid: target.spawnedAgentPid,
    });
    await ctx.db.insert('chatroom_agentStopTargets', {
      stopCommandId,
      chatroomId: input.chatroomId,
      agentConfigId: target._id,
      agentHarness: target.agentHarness,
      machineId: target.machineId,
      role: normalizeAgentStopRole(target.role),
      pid: target.spawnedAgentPid,
      targetKey,
      revisionKey: buildAgentStopRevisionKey({ stopCommandId, targetKey }),
      status: 'pending',
    });
  }
  const rolesWithStopTargets = new Set(
    input.selectedConfigs
      .filter((config) => config.spawnedAgentPid != null)
      .map((config) => normalizeAgentStopRole(config.role))
  );
  const ephemeralMachineIds = await collectEphemeralStopMachineIds(
    ctx,
    input.chatroomId,
    input.scope
  );
  const machineIds = [
    ...new Set([
      ...input.selectedConfigs.map((target) => target.machineId),
      ...ephemeralMachineIds,
    ]),
  ];
  const inboxCommandIdsByMachine: Record<string, Id<'chatroom_machineCommandInbox'>> = {};
  for (const machineId of machineIds) {
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
  const hasStopTargets = rolesWithStopTargets.size > 0;
  if (!hasStopTargets && machineIds.length === 0)
    await ctx.db.patch('chatroom_agentStopCommands', stopCommandId, {
      status: 'completed',
      completedAt: Date.now(),
    });
  for (const role of rolesWithStopTargets)
    await projectAgentStopStateForRole(ctx, input.chatroomId, role);
  for (const role of rolesWithStopTargets)
    await projectAgentRoleStatusReadModel(ctx, {
      chatroomId: input.chatroomId,
      role,
      event: { status: 'stopping' },
    });
  await releaseEphemeralAgentRolesWithoutStopTargets(ctx, {
    chatroomId: input.chatroomId,
    scope: input.scope,
    rolesWithStopTargets,
  });
  return { stopCommandId, inboxCommandIdsByMachine };
}
