import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { assertMachineBelongsToChatroom } from './assert-machine-belongs-to-chatroom';
import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { startAgent } from './start-agent';
import { normalizeWorkingDir } from './workspace-match';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { AgentStartReasonEnum } from '../../entities/agent';
import { getTeamStructure } from '../../entities/team-presets';
import { getActiveTeamStructure } from '../team/active-team-structure';
import { getPrimaryWorkspaceForChatroom } from '../workspace/get-primary-workspace-for-chatroom';

export type StartAgentFromCurrentConfigResult =
  | { status: 'started'; role: string; machineId: string }
  | { status: 'skipped'; role: string; reason: string };

/**
 * Start a permanent role from the last configuration recorded for the
 * chatroom's active workspace. The caller never supplies workspace or machine
 * identity; those are resolved from backend state.
 */
export async function startAgentFromCurrentWorkspaceConfig(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    requestedBy: Id<'users'>;
  }
): Promise<StartAgentFromCurrentConfigResult> {
  const role = input.role.trim();
  if (!role) return { status: 'skipped', role, reason: 'Role is required' };
  if (isEphemeralAgentRole(role)) {
    return { status: 'skipped', role, reason: 'Role is ephemeral' };
  }

  const activeTeam = await getActiveTeamStructure(ctx, input.chatroomId);
  if (!activeTeam) {
    return { status: 'skipped', role, reason: 'No active team structure' };
  }
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  const team = getTeamStructure({
    teamId: activeTeam.teamStructureId,
    persistedRoles: chatroom?.teamRoles ?? null,
    persistedEntryPoint: chatroom?.teamEntryPoint ?? null,
  });
  if (!team.roles.some((candidate) => candidate.role.toLowerCase() === role.toLowerCase())) {
    return { status: 'skipped', role, reason: 'Role is not part of the active team' };
  }

  const workspace = await getPrimaryWorkspaceForChatroom(ctx, input.chatroomId, {
    fallbackToNewest: false,
  });
  if (!workspace) {
    return { status: 'skipped', role, reason: 'No active primary workspace' };
  }
  const request = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: input.chatroomId,
    role,
    workspaceId: workspace._id,
  });
  if (!request) {
    return { status: 'skipped', role, reason: 'No saved launch configuration' };
  }
  if (
    !request.machineId ||
    !request.agentHarness ||
    !request.model?.trim() ||
    !request.workingDir?.trim()
  ) {
    return { status: 'skipped', role, reason: 'Saved launch configuration is incomplete' };
  }

  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', request.machineId))
    .first();
  if (!machine) {
    return { status: 'skipped', role, reason: 'Saved machine is no longer registered' };
  }
  if (machine.userId !== input.requestedBy) {
    return { status: 'skipped', role, reason: 'Saved machine is not owned by the requester' };
  }
  if (
    request.machineId !== workspace.machineId ||
    normalizeWorkingDir(request.workingDir) !== normalizeWorkingDir(workspace.workingDir)
  ) {
    return {
      status: 'skipped',
      role,
      reason: 'Saved launch configuration is not for the active workspace',
    };
  }

  await assertMachineBelongsToChatroom(ctx, {
    chatroomId: input.chatroomId,
    machineId: request.machineId,
    role,
    allowNewMachine: false,
  });

  await startAgent(
    ctx,
    {
      machineId: request.machineId,
      chatroomId: input.chatroomId,
      workspaceId: workspace._id,
      role,
      userId: input.requestedBy,
      model: request.model,
      agentHarness: request.agentHarness,
      workingDir: request.workingDir,
      reason: AgentStartReasonEnum['user.start'],
      wantResume: request.wantResume,
    },
    machine
  );

  return { status: 'started', role, machineId: request.machineId };
}

export type StartPermanentAgentsResult = {
  started: string[];
  skipped: { role: string; reason: string }[];
  failed: { role: string; error: string }[];
};

export async function startPermanentAgentsFromCurrentConfig(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    roles: readonly string[];
    requestedBy: Id<'users'>;
  }
): Promise<StartPermanentAgentsResult> {
  const outcomes = await Promise.all(
    input.roles.map(
      async (
        role
      ): Promise<
        | { kind: 'started'; role: string }
        | { kind: 'skipped'; role: string; reason: string }
        | { kind: 'failed'; role: string; error: string }
      > => {
        try {
          const started = await startAgentFromCurrentWorkspaceConfig(ctx, {
            chatroomId: input.chatroomId,
            role,
            requestedBy: input.requestedBy,
          });
          if (started.status === 'started') return { kind: 'started', role: started.role };
          return { kind: 'skipped', role: started.role, reason: started.reason };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[agents] failed to start ${role}@${input.chatroomId}: ${message}`);
          return { kind: 'failed', role, error: message };
        }
      }
    )
  );

  const result: StartPermanentAgentsResult = { started: [], skipped: [], failed: [] };
  for (const outcome of outcomes) {
    if (outcome.kind === 'started') result.started.push(outcome.role);
    else if (outcome.kind === 'skipped') {
      result.skipped.push({ role: outcome.role, reason: outcome.reason });
    } else {
      result.failed.push({ role: outcome.role, error: outcome.error });
    }
  }
  return result;
}
