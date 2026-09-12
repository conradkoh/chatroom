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
import { filterTeamAgentConfigsForTeam } from './utils/teamRoleKeyFilter';

function normalizeWorkingDir(value: string): string {
  return value.trim().replace(/[/\\]+$/, '');
}

async function getAccessibleWorkspace(
  ctx: QueryCtx,
  sessionId: string,
  workspaceId: Id<'chatroom_workspaces'>
): Promise<{ workspace: Doc<'chatroom_workspaces'>; chatroom: Doc<'chatroom_rooms'> } | null> {
  const workspace = await ctx.db.get('chatroom_workspaces', workspaceId);
  if (!workspace || workspace.removedAt !== undefined) return null;

  const { chatroom } = await requireChatroomAccess(ctx, sessionId, workspace.chatroomId);
  return { workspace, chatroom };
}

function configBelongsToWorkspace(
  config: Doc<'chatroom_teamAgentConfigs'>,
  workspace: Doc<'chatroom_workspaces'>
): boolean {
  return (
    config.machineId === workspace.machineId &&
    config.workingDir !== undefined &&
    normalizeWorkingDir(config.workingDir) === normalizeWorkingDir(workspace.workingDir)
  );
}

/** Lists the roles configured for a workspace without loading their live status. */
export const listAgentsForWorkspace = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    const access = await getAccessibleWorkspace(ctx, args.sessionId, args.workspaceId);
    if (!access) return [];

    const configs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', access.chatroom._id))
      .collect();
    const currentTeamConfigs = filterTeamAgentConfigsForTeam(
      configs,
      access.chatroom._id,
      access.chatroom.teamId
    );

    return currentTeamConfigs
      .filter((config) => configBelongsToWorkspace(config, access.workspace))
      .map((config) => ({
        role: config.role,
        type: config.type,
        teamId: access.chatroom.teamId ?? null,
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
    const access = await getAccessibleWorkspace(ctx, args.sessionId, args.workspaceId);
    if (!access) return null;

    const configs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', access.chatroom._id))
      .collect();
    const config = filterTeamAgentConfigsForTeam(
      configs,
      access.chatroom._id,
      access.chatroom.teamId
    ).find(
      (candidate) =>
        candidate.role.toLowerCase() === args.role.toLowerCase() &&
        configBelongsToWorkspace(candidate, access.workspace)
    );

    if (!config) return null;
    return {
      role: config.role,
      type: config.type,
      machineId: config.machineId ?? null,
      agentHarness: config.agentHarness ?? null,
      model: config.model ?? null,
      workingDir: config.workingDir ?? null,
      desiredState: config.desiredState ?? null,
      updatedAt: config.updatedAt,
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
    const access = await getAccessibleWorkspace(ctx, args.sessionId, args.workspaceId);
    if (!access) return null;

    const row = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom_role', (q) =>
        q.eq('chatroomId', access.chatroom._id).eq('role', args.role.toLowerCase())
      )
      .first();

    if (
      !row ||
      row.machineId !== access.workspace.machineId ||
      row.workingDir === undefined ||
      normalizeWorkingDir(row.workingDir) !== normalizeWorkingDir(access.workspace.workingDir)
    )
      return null;
    return {
      role: row.role,
      status: row.status,
      isRunning: row.isRunning === true,
      workingDir: row.workingDir,
      lastSeenAt: row.lastSeenAt ?? null,
      lastSeenAction: row.lastSeenAction ?? null,
      activeWork: row.activeWork ?? null,
      error: row.error ?? null,
      projectedAt: row.projectedAt,
    };
  },
});
