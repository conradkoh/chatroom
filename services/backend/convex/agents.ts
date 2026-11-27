// fallow-ignore-file complexity code-duplication
/** Canonical web-facing agent configuration and status reads. */

import { normalizeAgentRole } from '@workspace/shared/domain/agent-role';
import {
  deriveChatroomActivityStatus,
  deriveChatroomState,
  hasStuckAssignedWork,
  isChatroomStopAvailable,
} from '@workspace/shared/domain/chatroom-activity-status';
import { hasActiveChatroomAgent } from '@workspace/shared/domain/chatroom-agent-activity-status';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { getSession } from './auth/session';
import { agentHarnessValidator } from './schema';
import { validateWorkingDir } from './workspacePathSecurity';
import { BACKEND_ERROR_CODES, type BackendError } from '../config/errorCodes';
import { AgentStartReasonCode } from '../src/domain/entities/agent';
import { ACTIVE_TASK_HEADER_READ_LIMIT } from '../src/domain/entities/task';
import { getTeamStructure } from '../src/domain/entities/team-presets';
import { applyAgentConfig } from '../src/domain/usecase/agent/apply-agent-config';
import { assertAgentTargetIsActiveWorkspace } from '../src/domain/usecase/agent/assert-agent-target-in-active-workspace';
import { assertMachineBelongsToChatroom } from '../src/domain/usecase/agent/assert-machine-belongs-to-chatroom';
import { assertWorkspaceBelongsToAgentRequest } from '../src/domain/usecase/agent/assert-workspace-belongs-to-agent-request';
import { getAgentConfigForStart } from '../src/domain/usecase/agent/get-agent-config-for-start';
import { getAgentModelOptions as getAgentModelOptionsUseCase } from '../src/domain/usecase/agent/get-agent-model-options';
import {
  getLastSentLaunchRequestForRole,
  listLastSentLaunchRequestsForChatroom,
} from '../src/domain/usecase/agent/get-last-sent-launch-request';
import { requestAgentRestart } from '../src/domain/usecase/agent/request-agent-restart';
import { requestChatroomAgentOperation as requestChatroomAgentOperationUseCase } from '../src/domain/usecase/agent/request-chatroom-agent-operation';
import {
  requestChatroomWorkspaceAgentStop,
  requestWorkspaceAgentStop,
} from '../src/domain/usecase/agent/request-chatroom-workspace-agent-stop';
import { resolveAgentConfigTarget } from '../src/domain/usecase/agent/resolve-agent-config-target';
import { saveAgentConfig } from '../src/domain/usecase/agent/save-agent-config';
import { selectWakeableAgentRoles } from '../src/domain/usecase/agent/select-wakeable-agent-roles';
import { startAgent as startAgentUseCase } from '../src/domain/usecase/agent/start-agent';
import {
  startAgentFromCurrentWorkspaceConfig,
  startAgentsFromCurrentConfig,
  type StartAgentsResult,
} from '../src/domain/usecase/agent/start-agent-from-current-config';
import {
  normalizeWorkingDir,
  requestBelongsToWorkspace,
} from '../src/domain/usecase/agent/workspace-match';
import { getAgentViewStatus } from '../src/domain/usecase/chatroom/get-agent-view-status';
import { getActiveTeamStructure } from '../src/domain/usecase/team/active-team-structure';
import { getPrimaryWorkspaceForChatroom } from '../src/domain/usecase/workspace/get-primary-workspace-for-chatroom';

/** Canonical one-time start command from the webapp. */
export const requestStart = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    workspaceId: v.optional(v.id('chatroom_workspaces')),
    role: v.string(),
    agentHarness: agentHarnessValidator,
    model: v.optional(v.string()),
    workingDir: v.optional(v.string()),
    allowNewMachine: v.optional(v.boolean()),
    wantResume: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const session = await getSession(ctx, args.sessionId);
    if (!session) throw new Error('Authentication required');
    if (args.workingDir !== undefined) validateWorkingDir(args.workingDir);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine) throw new Error('Machine not found');
    const workspace = args.workspaceId
      ? await ctx.db.get('chatroom_workspaces', args.workspaceId)
      : null;
    if (args.workspaceId) {
      await assertWorkspaceBelongsToAgentRequest(ctx, {
        workspaceId: args.workspaceId,
        chatroomId: args.chatroomId,
        machineId: args.machineId,
        kind: 'start',
      });
    }
    const existing = await getLastSentLaunchRequestForRole(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    });
    const model = args.model ?? (existing?.agentType === 'remote' ? existing.model : undefined);
    const workingDir =
      args.workingDir ??
      (existing?.agentType === 'remote' ? existing.workingDir : undefined) ??
      workspace?.workingDir;
    if (!model || !workingDir) {
      throw new Error('Cannot start agent: model and workingDir are required');
    }
    validateWorkingDir(workingDir);
    await assertAgentTargetIsActiveWorkspace(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      workingDir,
    });
    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: args.allowNewMachine ?? true,
    });
    return startAgentUseCase(
      ctx,
      {
        machineId: args.machineId,
        chatroomId: args.chatroomId,
        workspaceId: args.workspaceId,
        role: args.role,
        userId: session.userId,
        model,
        agentHarness: args.agentHarness,
        workingDir,
        reason: AgentStartReasonCode.USER_START,
        wantResume: args.wantResume ?? false,
      },
      machine
    );
  },
});

/** Start one configured role using its last saved configuration. */
export const startFromCurrentConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return startAgentFromCurrentWorkspaceConfig(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      requestedBy: session.userId,
    });
  },
});

/**
 * @deprecated Use requestChatroomAgentOperation with operation "start".
 * Kept as a compatibility wrapper for existing clients.
 */
export const startAllPermanent = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const result = await requestChatroomAgentOperationUseCase(ctx, {
      chatroomId: args.chatroomId,
      operation: 'start',
      requestedBy: session.userId,
    });
    return {
      started: result.requested.flatMap(({ role }) => (role ? [role] : [])),
      skipped: result.skipped.flatMap(({ role, reason }) => (role ? [{ role, reason }] : [])),
      failed: result.failed.flatMap(({ role, error }) => (role ? [{ role, error }] : [])),
    };
  },
});

/** Single chatroom-level lifecycle endpoint used by every bulk agent control. */
export const requestChatroomAgentOperation = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    operation: v.union(v.literal('start'), v.literal('stop'), v.literal('restart')),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return requestChatroomAgentOperationUseCase(ctx, {
      chatroomId: args.chatroomId,
      operation: args.operation,
      requestedBy: session.userId,
    });
  },
});

/**
 * Message-triggered wake-up. Starts every configured role in the chatroom's
 * primary workspace that is not running, permanent or ephemeral. The status read
 * model is only a filter; the daemon decides whether each queued request is
 * already satisfied.
 */
export const startNonRunningAgentsForChatroom = internalMutation({
  args: { chatroomId: v.id('chatroom_rooms') },
  handler: async (ctx, args): Promise<StartAgentsResult> => {
    const empty: StartAgentsResult = { started: [], skipped: [], failed: [] };
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom?.ownerId) return empty;
    const structure = await getActiveTeamStructure(ctx, args.chatroomId);
    if (!structure) return empty;
    const workspace = await getPrimaryWorkspaceForChatroom(ctx, args.chatroomId, {
      fallbackToNewest: false,
    });
    if (!workspace) return empty;
    const team = getTeamStructure({
      teamId: structure.teamStructureId,
      persistedRoles: chatroom.teamRoles ?? null,
      persistedEntryPoint: chatroom.teamEntryPoint ?? null,
    });
    const configuredRoles = team.roles.map(({ role }) => role).filter((role) => role !== 'user');
    const statusRows = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    const roles = selectWakeableAgentRoles({
      roles: configuredRoles,
      workspaceId: workspace._id,
      statusRows,
    });
    return startAgentsFromCurrentConfig(ctx, {
      chatroomId: args.chatroomId,
      workspaceId: workspace._id,
      roles,
      requestedBy: chatroom.ownerId,
    });
  },
});

/** Canonical one-time restart command from the webapp. */
export const requestRestart = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    workspaceId: v.optional(v.id('chatroom_workspaces')),
    role: v.string(),
    agentHarness: agentHarnessValidator,
    model: v.string(),
    workingDir: v.string(),
    allowNewMachine: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const session = await getSession(ctx, args.sessionId);
    if (!session) throw new Error('Authentication required');
    validateWorkingDir(args.workingDir);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine) throw new Error('Machine not found');
    if (args.workspaceId) {
      await assertWorkspaceBelongsToAgentRequest(ctx, {
        workspaceId: args.workspaceId,
        chatroomId: args.chatroomId,
        machineId: args.machineId,
        workingDir: args.workingDir,
        kind: 'restart',
      });
    }
    await assertAgentTargetIsActiveWorkspace(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      workingDir: args.workingDir,
    });
    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: args.allowNewMachine ?? true,
    });
    const result = await requestAgentRestart(
      ctx,
      {
        chatroomId: args.chatroomId,
        workspaceId: args.workspaceId,
        role: args.role,
        requestedBy: session.userId,
        request: {
          reason: AgentStartReasonCode.USER_RESTART,
          overrides: {
            machineId: args.machineId,
            model: args.model,
            agentHarness: args.agentHarness,
            workingDir: args.workingDir,
          },
        },
      },
      machine
    );
    if (result.status === 'skipped') throw new Error(`Cannot restart agent: ${result.reason}`);
    return result;
  },
});

/**
 * Save-only: persists an agent configuration without starting or restarting anything. The
 * start-with-favourites flow relies on this. Use `applyConfig` to save and restart a changed agent.
 */
export const saveConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workspaceId: v.id('chatroom_workspaces'),
    role: v.string(),
    machineId: v.string(),
    agentHarness: agentHarnessValidator,
    model: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const saved = await saveAgentConfig(ctx, {
      chatroomId: args.chatroomId,
      workspaceId: args.workspaceId,
      role: args.role,
      machineId: args.machineId,
      agentHarness: args.agentHarness,
      model: args.model,
      workingDir: args.workingDir,
      requestedBy: access.session.userId,
    });
    return {
      role: saved.role,
      machineId: saved.machineId,
      agentHarness: saved.agentHarness,
      model: saved.model,
      workingDir: saved.workingDir,
      updatedAt: saved.requestedAt,
    };
  },
});

/**
 * Saves a role's harness and model and restarts the agent only when the effective harness or model
 * changed. Unchanged → no write; changed and not running → saved; changed and running → restarted.
 */
export const applyConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentHarness: v.string(),
    model: v.string(),
    workspaceId: v.optional(v.id('chatroom_workspaces')),
  },
  handler: async (ctx, args) => {
    const access = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const target = await resolveAgentConfigTarget(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      workspaceId: args.workspaceId,
    });
    await requireMachineOwner(ctx, args.sessionId, target.machineId);
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', target.machineId))
      .first();
    if (!machine) {
      throw new ConvexError<BackendError>({
        code: BACKEND_ERROR_CODES.MACHINE_NOT_FOUND,
        message: 'Machine not found',
      });
    }
    return applyAgentConfig(ctx, {
      target,
      chatroomId: args.chatroomId,
      agentHarness: args.agentHarness,
      model: args.model,
      requestedBy: access.session.userId,
      machine,
    });
  },
});

/** Read-only options for `chatroom agent config models`: the role's machine catalog and current config. */
export const getAgentModelOptions = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    teamId: v.string(),
    role: v.string(),
    harness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const target = await resolveAgentConfigTarget(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: args.teamId,
    });
    await requireMachineOwner(ctx, args.sessionId, target.machineId);
    return getAgentModelOptionsUseCase(ctx, {
      target,
      chatroomId: args.chatroomId,
      harness: args.harness,
    });
  },
});

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
    const row = args.workspaceId
      ? await ctx.db
          .query('chatroom_agentRoleStatusReadModel')
          .withIndex('by_chatroom_workspace_role', (q) =>
            q
              .eq('chatroomId', args.chatroomId)
              .eq('workspaceId', args.workspaceId)
              .eq('role', args.role.trim().toLowerCase())
          )
          .first()
      : await ctx.db
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
      activeWork: row.activeWork?.kind === 'task' ? row.activeWork : null,
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

/**
 * Per-role status rows in team order. `hasAssignedTask` is true while an active
 * (pending, acknowledged or in_progress) task is assigned to the role. It is
 * independent of `status` and `activeWork`.
 */
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
    // Slim projection of active, assigned tasks (no content), the same bounded read as getChatroomStatus.
    const activeTaskHeaders = await ctx.db
      .query('chatroom_activeTaskHeaders')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .take(ACTIVE_TASK_HEADER_READ_LIMIT);
    const assignedRoles = new Set(
      activeTaskHeaders.map((header) => normalizeAgentRole(header.assignedTo))
    );
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
        activeWork: row?.activeWork?.kind === 'task' ? row.activeWork : null,
        hasAssignedTask: assignedRoles.has(normalizeAgentRole(role)),
        error: row?.error ?? null,
        projectedAt: row?.projectedAt ?? null,
      };
    });
  },
});

/** Canonical chatroom status read model used by all chatroom-level UI. */
export const getChatroomStatus = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms') },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const rows = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    // Slim projection of active, assigned tasks (no content). The active queue is small; the bound is deliberate.
    const activeTaskHeaders = await ctx.db
      .query('chatroom_activeTaskHeaders')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .take(ACTIVE_TASK_HEADER_READ_LIMIT);
    const stuck = hasStuckAssignedWork(
      rows.map((row) => ({ role: row.role, status: row.status })),
      activeTaskHeaders.map((header) => ({ assignedTo: header.assignedTo, status: header.status }))
    );
    const activityStatus = deriveChatroomActivityStatus(
      chatroom.status,
      rows.map((row) => ({ status: row.status })),
      stuck
    );
    const state = deriveChatroomState(activityStatus);
    const remoteAgentStatus = hasActiveChatroomAgent(rows) ? 'running' : 'none';

    return {
      chatroomId: args.chatroomId,
      activityStatus,
      state,
      remoteAgentStatus,
      canStop: remoteAgentStatus === 'running' || isChatroomStopAvailable(activityStatus),
    } as const;
  },
});

/** Requests a one-time stop command; it does not write desired or runtime state. */
export const requestStop = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    role: v.string(),
    workingDir: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return requestWorkspaceAgentStop(ctx, args);
  },
});

/**
 * @deprecated Use requestChatroomAgentOperation with operation "stop".
 * Kept as a compatibility wrapper for existing clients.
 */
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
