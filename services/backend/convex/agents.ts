/** Canonical web-facing agent configuration and status reads. */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { getSession } from './auth/session';
import { getTeamStructure } from '../src/domain/entities/team-presets';
import { getAgentConfigForStart } from '../src/domain/usecase/agent/get-agent-config-for-start';
import {
  getLastSentLaunchRequestForRole,
  listLastSentLaunchRequestsForChatroom,
} from '../src/domain/usecase/agent/get-last-sent-launch-request';
import {
  requestChatroomWorkspaceAgentStop,
  requestWorkspaceAgentStop,
} from '../src/domain/usecase/agent/request-chatroom-workspace-agent-stop';
import { getAgentViewStatus } from '../src/domain/usecase/chatroom/get-agent-view-status';
import { getActiveTeamStructure } from '../src/domain/usecase/team/active-team-structure';

function normalizeWorkingDir(value: string): string {
  return value.trim().replace(/[/\\]+$/, '');
}

function requestBelongsToWorkspace(
  request: Doc<'chatroom_agentLastSentLaunchRequests'>,
  workspace: Doc<'chatroom_workspaces'>
): boolean {
  return (
    request.workspaceId === workspace._id ||
    (request.machineId === workspace.machineId &&
      normalizeWorkingDir(request.workingDir) === normalizeWorkingDir(workspace.workingDir))
  );
}

async function resolveTeamStructure(ctx: QueryCtx, chatroom: Doc<'chatroom_rooms'>) {
  const active = await getActiveTeamStructure(ctx, chatroom._id);
  return active ? getTeamStructure({ teamId: active.teamStructureId }) : null;
}

export const getLastSentLaunchRequest = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    workspaceId: v.optional(v.id('chatroom_workspaces')),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const request = await getLastSentLaunchRequestForRole(ctx, args);
    if (!request) return null;
    if (args.workspaceId) {
      const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
      if (
        !workspace ||
        workspace.chatroomId !== args.chatroomId ||
        workspace.removedAt !== undefined ||
        !requestBelongsToWorkspace(request, workspace)
      )
        return null;
    }
    return request;
  },
});

export const listLastSentLaunchRequests = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workspaceId: v.optional(v.id('chatroom_workspaces')),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const requests = await listLastSentLaunchRequestsForChatroom(ctx, {
      chatroomId: args.chatroomId,
    });
    if (!args.workspaceId) return requests;
    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace || workspace.chatroomId !== args.chatroomId || workspace.removedAt !== undefined)
      return [];
    return requests.filter((request) => requestBelongsToWorkspace(request, workspace));
  },
});

export const getStartFormData = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return getAgentConfigForStart(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      userId: session.session.userId,
    });
  },
});

export const getStatus = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    workspaceId: v.optional(v.id('chatroom_workspaces')),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const row = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role.trim().toLowerCase())
      )
      .first();
    if (!row) return null;
    if (args.workspaceId) {
      const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
      if (
        !workspace ||
        workspace.chatroomId !== args.chatroomId ||
        workspace.removedAt !== undefined ||
        row.machineId !== workspace.machineId ||
        row.workingDir === undefined ||
        normalizeWorkingDir(row.workingDir) !== normalizeWorkingDir(workspace.workingDir)
      )
        return null;
    }
    return {
      role: row.role,
      status: row.status,
      isRunning: row.status !== 'offline',
      lastSeenAt: row.lastSeenAt ?? null,
      lastSeenAction: row.lastSeenAction ?? null,
      activeWork: row.activeWork ?? null,
      error: row.error ?? null,
      projectedAt: row.projectedAt,
      workingDir: row.workingDir ?? '',
      teamId: (await getActiveTeamStructure(ctx, args.chatroomId))?.teamStructureId ?? null,
    };
  },
});

/** Canonical role/team view for the chatroom agent panel. */
export const getViewStatus = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms') },
  handler: async (ctx, args) => {
    const session = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return getAgentViewStatus(ctx, {
      chatroomId: args.chatroomId,
      userId: session.session.userId,
    });
  },
});

export const listStatus = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const structure = await resolveTeamStructure(ctx, chatroom);
    const rows = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    const byRole = new Map(rows.map((row) => [row.role.toLowerCase(), row]));
    return (structure?.roles ?? []).map(({ role, lifecycle, optional }) => {
      const row = byRole.get(role.toLowerCase());
      return {
        role,
        roleKind: lifecycle === 'ephemeral' ? ('ephemeral' as const) : ('persistent' as const),
        optional,
        status: row?.status ?? 'offline',
        isRunning: row?.status !== undefined && row.status !== 'offline',
        machineId: row?.machineId ?? null,
        workingDir: row?.workingDir ?? null,
        lastSeenAt: row?.lastSeenAt ?? null,
        lastSeenAction: row?.lastSeenAction ?? null,
        activeWork: row?.activeWork ?? null,
        error: row?.error ?? null,
        projectedAt: row?.projectedAt ?? null,
      };
    });
  },
});

/** Canonical owner-scoped status rows used by chatroom listings. */
export const listChatroomStatus = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    const session = await getSession(ctx, args.sessionId);
    if (!session) return [];
    const chatrooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', session.userId))
      .collect();
    const results = await Promise.all(
      chatrooms.map(async (chatroom) => {
        const rows = await ctx.db
          .query('chatroom_agentRoleStatusReadModel')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
          .collect();
        const activeRows = rows.filter((row) => row.status !== 'offline');
        return {
          chatroomId: chatroom._id,
          agentStatus: activeRows.length > 0 ? ('running' as const) : ('none' as const),
          runningRoles: activeRows.map((row) => row.role),
          aliveRoles: activeRows.map((row) => row.role),
          runningAgents: activeRows.flatMap((row) =>
            row.machineId ? [{ role: row.role, machineId: row.machineId }] : []
          ),
        };
      })
    );
    return results;
  },
});

/** Owner-scoped role status rows for activity indicators in listings. */
export const listStatusForAllChatrooms = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    const session = await getSession(ctx, args.sessionId);
    if (!session) return [];
    const chatrooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', session.userId))
      .collect();
    const rows = await Promise.all(
      chatrooms.map((chatroom) =>
        ctx.db
          .query('chatroom_agentRoleStatusReadModel')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
          .collect()
      )
    );
    return rows.flat();
  },
});

/** Requests a one-time stop command; it does not write desired or runtime state. */
export const requestStop = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return requestWorkspaceAgentStop(ctx, args);
  },
});

/** Requests one stop-all command per machine that has observed room activity. */
export const requestStopAll = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    finalizeChatroom: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return requestChatroomWorkspaceAgentStop(ctx, args);
  },
});
