/** Workspace-scoped agent queries for the frontend.
 *
 * These queries deliberately separate the low-frequency configuration/list
 * data from the high-frequency status read model. In particular, none of
 * these queries reads daemon connectivity or machine liveness.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import { query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { withActiveTeamStructure } from './lib/chatroomTeam';
import { getTeamStructure } from '../src/domain/entities/team-presets';
import {
  getLastSentLaunchRequestForRole,
  listLastSentLaunchRequestsForChatroom,
} from '../src/domain/usecase/agent/get-last-sent-launch-request';
import {
  normalizeWorkingDir,
  requestBelongsToWorkspace,
} from '../src/domain/usecase/agent/workspace-match';
import { getActiveTeamStructure } from '../src/domain/usecase/team/active-team-structure';

async function requireChatroomAccessForWorkspace(
  ctx: QueryCtx,
  sessionId: string,
  workspaceId: Id<'chatroom_workspaces'>
): Promise<{ workspace: Doc<'chatroom_workspaces'>; chatroom: Doc<'chatroom_rooms'> } | null> {
  const workspace = await ctx.db.get('chatroom_workspaces', workspaceId);
  if (!workspace || workspace.removedAt !== undefined) return null;

  const { chatroom } = await requireChatroomAccess(ctx, sessionId, workspace.chatroomId);
  return { workspace, chatroom: await withActiveTeamStructure(ctx, chatroom) };
}

function offlineAgentStatus(
  role: string,
  workspaceId: Id<'chatroom_workspaces'>,
  workingDir: string
) {
  return {
    role: role.trim().toLowerCase(),
    workspaceId,
    status: 'offline' as const,
    isRunning: false,
    workingDir,
    lastSeenAt: null,
    lastSeenAction: null,
    activeWork: null,
    error: null,
    projectedAt: 0,
  };
}

/** Lists roles with a previously submitted launch request for a workspace. */
export const listConfiguredAgentsForWorkspace = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    const access = await requireChatroomAccessForWorkspace(ctx, args.sessionId, args.workspaceId);
    if (!access) return [];

    const activeStructure = await getActiveTeamStructure(ctx, access.chatroom._id);
    const structure = activeStructure
      ? getTeamStructure({ teamId: activeStructure.teamStructureId })
      : null;
    const structureId = structure?.teamStructureId;
    const requests = await listLastSentLaunchRequestsForChatroom(ctx, {
      chatroomId: access.chatroom._id,
      ...(structureId ? { teamStructureId: structureId } : {}),
    });

    return requests
      .filter((request) => requestBelongsToWorkspace(request, access.workspace))
      .map((request) => ({
        role: request.role,
        type: request.agentType,
        teamId: structure?.teamId ?? null,
      }))
      .sort((a, b) => a.role.localeCompare(b.role));
  },
});

/** Returns low-frequency configuration for one workspace/role pair. */
export const getAgentConfigForWorkspaceRole = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireChatroomAccessForWorkspace(ctx, args.sessionId, args.workspaceId);
    if (!access) return null;

    const activeStructure = await getActiveTeamStructure(ctx, access.chatroom._id);
    const structureId = activeStructure?.teamStructureId;
    const config = await getLastSentLaunchRequestForRole(ctx, {
      chatroomId: access.chatroom._id,
      role: args.role.toLowerCase(),
      ...(structureId ? { teamStructureId: structureId } : {}),
      workspaceId: args.workspaceId,
    });

    if (!config || !requestBelongsToWorkspace(config, access.workspace)) return null;
    return {
      role: config.role,
      type: config.agentType,
      machineId: config.machineId ?? null,
      agentHarness: config.agentHarness ?? null,
      model: config.model ?? null,
      workingDir: config.workingDir ?? null,
      updatedAt: config.requestedAt,
    };
  },
});

/**
 * Returns the high-frequency status projection for one workspace/role pair.
 *
 * Status is read only from chatroom_agentRoleStatusReadModel. The workspace
 * check uses the projection's machine binding so a role cannot leak status
 * from another registered workspace.
 */
export const getAgentStatusForWorkspaceRole = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireChatroomAccessForWorkspace(ctx, args.sessionId, args.workspaceId);
    if (!access) return null;
    const role = args.role.trim().toLowerCase();

    let row = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom_workspace_role', (q) =>
        q.eq('chatroomId', access.chatroom._id).eq('workspaceId', args.workspaceId).eq('role', role)
      )
      .first();

    // Read legacy chatroom-scoped projections until they are replaced by a
    // workspace-scoped observation. The machine/path guard below prevents
    // status from another workspace from leaking into this one.
    if (!row) {
      row = await ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', access.chatroom._id).eq('role', role)
        )
        .first();
    }

    if (!row) return offlineAgentStatus(role, args.workspaceId, access.workspace.workingDir);
    if (
      row.machineId !== access.workspace.machineId ||
      row.workingDir === undefined ||
      normalizeWorkingDir(row.workingDir) !== normalizeWorkingDir(access.workspace.workingDir)
    )
      return offlineAgentStatus(role, args.workspaceId, access.workspace.workingDir);
    return {
      role: row.role,
      workspaceId: row.workspaceId ?? null,
      status: row.status,
      isRunning: row.status !== 'offline',
      workingDir: row.workingDir,
      lastSeenAt: row.lastSeenAt ?? null,
      lastSeenAction: row.lastSeenAction ?? null,
      activeWork: row.activeWork ?? null,
      error: row.error ?? null,
      projectedAt: row.projectedAt,
    };
  },
});
