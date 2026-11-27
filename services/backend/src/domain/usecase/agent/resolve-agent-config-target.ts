import { ConvexError } from 'convex/values';

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { BACKEND_ERROR_CODES, type BackendError } from '../../../../config/errorCodes';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { getTeamStructure } from '../../entities/team-presets';
import { getActiveTeamStructure } from '../team/active-team-structure';
import { getPrimaryWorkspaceForChatroom } from '../workspace/get-primary-workspace-for-chatroom';

export interface AgentConfigTarget {
  chatroomId: Id<'chatroom_rooms'>;
  teamStructureId: string;
  /** Canonical preset id, e.g. `trio` */
  teamId: string;
  /** Canonical role casing from the team */
  role: string;
  workspace: Doc<'chatroom_workspaces'>;
  machineId: string; // workspace.machineId
  workingDir: string; // workspace.workingDir
  /** Latest launch request for this role in this workspace, or null */
  previous: Doc<'chatroom_agentLastSentLaunchRequests'> | null;
}

export interface ResolveAgentConfigTargetInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  workspaceId?: Id<'chatroom_workspaces'> | undefined;
  teamId?: string | undefined;
}

/**
 * Resolves everything a config decision needs: canonical role, workspace, machine and the previous
 * config. Single source of truth for `agents.applyConfig` and `agents.getAgentModelOptions`, so both
 * agree on team identity, role casing and workspace precedence.
 */
// fallow-ignore-next-line complexity
export async function resolveAgentConfigTarget(
  ctx: QueryCtx | MutationCtx,
  input: ResolveAgentConfigTargetInput
): Promise<AgentConfigTarget> {
  const active = await getActiveTeamStructure(ctx, input.chatroomId);
  if (!active) throw new Error(`Chatroom ${input.chatroomId} has no team structure`);
  const structure = getTeamStructure({ teamId: active.teamStructureId });

  if (
    input.teamId !== undefined &&
    getTeamStructure({ teamId: input.teamId }).teamStructureId !== active.teamStructureId
  ) {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.AGENT_CONFIG_TEAM_MISMATCH,
      message: `Chatroom uses team ${structure.teamId}, not ${input.teamId}`,
    });
  }

  const role = findTeamRole(
    structure.roles.map((entry) => entry.role),
    input.role
  );
  if (!role) {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.AGENT_CONFIG_ROLE_NOT_IN_TEAM,
      message: `Role "${input.role}" is not in team ${structure.teamId}. Valid roles: ${structure.roles.map((entry) => entry.role).join(', ')}`,
    });
  }

  const workspace = await resolveWorkspace(ctx, input.chatroomId, role, input.workspaceId);
  const previous = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: input.chatroomId,
    role,
    workspaceId: workspace._id,
  });
  return {
    chatroomId: input.chatroomId,
    teamStructureId: active.teamStructureId,
    teamId: structure.teamId,
    role,
    workspace,
    machineId: workspace.machineId,
    workingDir: workspace.workingDir,
    previous,
  };
}

/** Case-insensitive match against the team roles; `user` is never a configurable role. */
function findTeamRole(roles: readonly string[], requested: string): string | undefined {
  const key = requested.trim().toLowerCase();
  if (key === 'user') return undefined;
  return roles.find((role) => role.toLowerCase() === key);
}

/**
 * Workspace precedence: explicit `workspaceId` (no fallback if invalid) → the role's newest launch
 * request's workspace when still active → the chatroom's primary workspace (no newest fallback).
 */
// fallow-ignore-next-line complexity
async function resolveWorkspace(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  explicitWorkspaceId: Id<'chatroom_workspaces'> | undefined
): Promise<Doc<'chatroom_workspaces'>> {
  if (explicitWorkspaceId) {
    const explicit = await ctx.db.get('chatroom_workspaces', explicitWorkspaceId);
    if (isActiveWorkspaceOf(explicit, chatroomId)) return explicit;
    throw noWorkspace('Workspace does not belong to this chatroom or is no longer active');
  }

  const newest = await getLastSentLaunchRequestForRole(ctx, { chatroomId, role });
  if (newest?.workspaceId) {
    const fromRequest = await ctx.db.get('chatroom_workspaces', newest.workspaceId);
    if (isActiveWorkspaceOf(fromRequest, chatroomId)) return fromRequest;
  }

  const primary = await getPrimaryWorkspaceForChatroom(ctx, chatroomId, {
    fallbackToNewest: false,
  });
  if (primary) return primary;
  throw noWorkspace('No active workspace; register one or pass a workspace');
}

function isActiveWorkspaceOf(
  workspace: Doc<'chatroom_workspaces'> | null,
  chatroomId: Id<'chatroom_rooms'>
): workspace is Doc<'chatroom_workspaces'> {
  return (
    workspace !== null && workspace.chatroomId === chatroomId && workspace.removedAt === undefined
  );
}

function noWorkspace(message: string): ConvexError<BackendError> {
  return new ConvexError<BackendError>({
    code: BACKEND_ERROR_CODES.AGENT_CONFIG_NO_WORKSPACE,
    message,
  });
}
