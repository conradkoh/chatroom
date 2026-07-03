import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { getRolePriority } from './lib/hierarchy';
import { buildTeamRoleKey } from './utils/teamRoleKey';
import {
  PARTICIPANT_HEARTBEAT_MIN_INTERVAL_MS,
  CONNECTION_CLOSE_REQUEST_TTL_MS,
} from '../config/reliability';
import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
  PARTICIPANT_EXITED_ACTION,
  isActiveParticipant,
} from '../src/domain/entities/participant';
import { isAgentAlive } from '../src/domain/usecase/agent/is-agent-alive';
import { transitionAgentStatus } from '../src/domain/usecase/agent/transition-agent-status';
import { getTeamRolesFromChatroom } from '../src/domain/usecase/chatroom/get-team-roles';
import { syncParticipantPresenceOnSnapshots } from '../src/domain/usecase/machine/machine-assigned-task-snapshot-sync';
import { patchTeamAgentConfig } from '../src/domain/usecase/machine/patch-team-agent-config';
import { handleNativeAgentEnd as handleNativeAgentEndUsecase } from '../src/domain/usecase/participant/handle-native-agent-end';
import { startTaskFromTokenActivity } from '../src/domain/usecase/participant/start-task-from-token-activity';
import {
  findActiveAssignedTaskForRole,
  findAcknowledgedTaskForRole,
} from '../src/domain/usecase/task/find-acknowledged-task-for-role';
import { maybePromoteNextQueuedTask } from '../src/domain/usecase/task/maybe-promote-next-queued-task';

async function getParticipantByChatroomRole(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  return ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .unique();
}

/** Upserts a chatroom participant record.
 * Emits agent.waiting and enables queue promotion only when action is 'get-next-task:started',
 * which is sent AFTER the WebSocket subscription is established (not before).
 * Use 'get-next-task:connecting' for the initial registration before the subscription is ready.
 */
export const join = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    // Unique connection ID to detect concurrent get-next-task processes
    connectionId: v.optional(v.string()),
    // Machine this connection runs on (from CLI getMachineId())
    machineId: v.optional(v.string()),
    // Agent type — 'custom' or 'remote'
    agentType: v.optional(v.union(v.literal('custom'), v.literal('remote'))),
    // The CLI command/action that triggered this join
    action: v.optional(v.string()),
    // Task associated with native lifecycle actions (native:task-injected)
    taskId: v.optional(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Validate role is in team configuration
    const { teamRoles, normalizedTeamRoles } = getTeamRolesFromChatroom(chatroom);
    if (teamRoles.length > 0) {
      const normalizedRole = args.role.toLowerCase();
      if (!normalizedTeamRoles.includes(normalizedRole)) {
        throw new Error(
          `Invalid role: "${args.role}" is not in team configuration. Allowed roles: ${teamRoles.join(', ')}`
        );
      }
    }

    // Check if already joined
    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    let participantId;
    const now = Date.now();

    if (existing) {
      // connectionId is only updated when explicitly provided — never cleared by heartbeats
      // that don't supply a connectionId, to avoid breaking superseded-connection detection.
      const connectionIdChanged =
        args.connectionId !== undefined && args.connectionId !== existing.connectionId;
      const machineIdChanged =
        args.machineId !== undefined && args.machineId !== existing.machineId;
      const agentTypeChanged =
        args.agentType !== undefined && args.agentType !== existing.agentType;
      const actionChanged = args.action !== undefined && args.action !== existing.lastSeenAction;
      const lastSeenAtStale =
        existing.lastSeenAt === undefined ||
        now - existing.lastSeenAt >= PARTICIPANT_HEARTBEAT_MIN_INTERVAL_MS;

      // Append a close request for the connection being superseded (before we overwrite it).
      if (connectionIdChanged && existing.connectionId) {
        await ctx.db.insert('chatroom_connectionCloseRequests', {
          chatroomId: args.chatroomId,
          role: args.role,
          connectionId: existing.connectionId,
          machineId: existing.machineId,
          reason: 'superseded',
          createdAt: now,
          expiresAt: now + CONNECTION_CLOSE_REQUEST_TTL_MS,
        });
      }

      const clearConnectionId = args.action === 'get-next-task:stopped';
      if (
        connectionIdChanged ||
        machineIdChanged ||
        agentTypeChanged ||
        actionChanged ||
        lastSeenAtStale ||
        clearConnectionId
      ) {
        await ctx.db.patch('chatroom_participants', existing._id, {
          ...(clearConnectionId
            ? { connectionId: undefined }
            : connectionIdChanged
              ? { connectionId: args.connectionId }
              : {}),
          ...(machineIdChanged ? { machineId: args.machineId } : {}),
          ...(lastSeenAtStale ? { lastSeenAt: now } : {}),
          ...(actionChanged ? { lastSeenAction: args.action } : {}),
          ...(agentTypeChanged && args.agentType ? { agentType: args.agentType } : {}),
        });
      }
      participantId = existing._id;
    } else {
      // Create new participant
      participantId = await ctx.db.insert('chatroom_participants', {
        chatroomId: args.chatroomId,
        role: args.role,
        connectionId: args.connectionId,
        lastSeenAt: now,
        ...(args.machineId ? { machineId: args.machineId } : {}),
        ...(args.action !== undefined ? { lastSeenAction: args.action } : {}),
        ...(args.agentType ? { agentType: args.agentType } : {}),
      });
    }

    // Auto-promote queued tasks when the entry point role joins.
    // maybePromoteNextQueuedTask skips non-entry-point roles internally.
    const normalizedRole = args.role.toLowerCase();
    await maybePromoteNextQueuedTask(ctx, args.chatroomId, {
      entryPointRole: normalizedRole,
    });

    // Reset circuit breaker when agent successfully registers (proves it's healthy)
    let teamConfig = null;
    if (chatroom.teamId) {
      const joinTeamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);
      teamConfig = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', joinTeamRoleKey))
        .first();
    }

    if (
      teamConfig?.type === 'remote' &&
      teamConfig.circuitState &&
      teamConfig.circuitState !== 'closed'
    ) {
      await patchTeamAgentConfig(
        ctx,
        teamConfig._id,
        {
          circuitState: 'closed',
          circuitOpenedAt: undefined,
        },
        { projectScope: 'chatroom' }
      );
    }

    // Emit agent.waiting event when agent enters the get-next-task loop
    if (args.action === 'get-next-task:started') {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.waiting',
        chatroomId: args.chatroomId,
        role: args.role,
        timestamp: now,
      });
      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.waiting');
    }

    if (args.action === 'get-next-task:stopped') {
      // Agent left the blocking listener to process a claimed task.
      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
    }

    if (args.action === NATIVE_WAITING_ACTION) {
      const activeTask = await findActiveAssignedTaskForRole(ctx, {
        chatroomId: args.chatroomId,
        role: args.role,
      });
      // Do not downgrade while agent has claimed work (awaiting tokens or actively working).
      if (activeTask?.status === 'acknowledged' || activeTask?.status === 'in_progress') {
        await syncParticipantPresenceOnSnapshots(ctx, args.chatroomId, args.role, {
          actionChanged: args.action !== undefined,
        });
        return participantId;
      }

      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.waiting',
        chatroomId: args.chatroomId,
        role: args.role,
        timestamp: now,
      });
      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.waiting');
    }

    if (args.action === NATIVE_TASK_INJECTED_ACTION) {
      const acknowledgedTask = await findAcknowledgedTaskForRole(ctx, {
        chatroomId: args.chatroomId,
        role: args.role,
        taskId: args.taskId,
      });

      if (acknowledgedTask) {
        // Do NOT re-emit task.acknowledged — claim already wrote it.
        await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
      }
    }

    await syncParticipantPresenceOnSnapshots(ctx, args.chatroomId, args.role, {
      actionChanged: args.action !== undefined,
    });

    return participantId;
  },
});

/** Returns all participants in a chatroom. */
export const list = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    return await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});

/** Marks a participant as exited in a chatroom (agent stopped). */
export const leave = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Find the participant
    const participant = await getParticipantByChatroomRole(ctx, args.chatroomId, args.role);

    if (participant) {
      await ctx.db.patch('chatroom_participants', participant._id, {
        lastSeenAction: PARTICIPANT_EXITED_ACTION,
        connectionId: undefined,
      });
    }
  },
});

/** Updates lastSeenTokenAt and may start an acknowledged task when harness output is detected. */
export const updateTokenActivity = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const participant = await getParticipantByChatroomRole(ctx, args.chatroomId, args.role);
    if (participant) {
      await startTaskFromTokenActivity(ctx, args, participant);

      await ctx.db.patch('chatroom_participants', participant._id, {
        lastSeenTokenAt: Date.now(),
      });
    }
  },
});

/** Returns a chatroom participant by role. */
export const getByRole = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    return await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();
  },
});

/** Idempotent handler for native harness agent_end — returns handoff reminder signal or transitions to waiting. */
export const handleNativeAgentEnd = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return await handleNativeAgentEndUsecase(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
    });
  },
});

/** Returns the highest-priority participant role in a chatroom for broadcast message routing. */
export const getHighestPriorityWaitingRole = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    const presentParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== 'user' && isActiveParticipant(p)
    );

    if (presentParticipants.length === 0) {
      return null;
    }

    // Sort by priority (lower number = higher priority)
    presentParticipants.sort((a, b) => getRolePriority(a.role) - getRolePriority(b.role));

    return presentParticipants[0]?.role ?? null;
  },
});

// updateAgentStatus removed — liveness is now tracked via lastSeenAt + lastSeenAction only.

/** Returns the current connection ID for a participant role, used to detect superseded get-next-task processes. */
export const getConnectionId = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const participant = await getParticipantByChatroomRole(ctx, args.chatroomId, args.role);

    return participant?.connectionId ?? null;
  },
});

// ─── Team Lifecycle (lastSeenAt-based) ──────────────────────────────────────

/** Returns raw participant state (lastSeenAt, lastSeenAction, agentType) for all team roles. */
export const getTeamLifecycle = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    if (!chatroom.teamId || !chatroom.teamRoles) {
      return null;
    }

    // Fetch all participants for this chatroom.
    const participantRows = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    const participantByRole = new Map(participantRows.map((p) => [p.role.toLowerCase(), p]));

    // Fetch agent configs to determine isAlive from spawnedAgentPid
    const agentConfigs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    const configByRole = new Map(agentConfigs.map((c) => [c.role.toLowerCase(), c]));

    const expectedRoles = chatroom.teamRoles;
    const participants = expectedRoles.map((role) => {
      const participantRow = participantByRole.get(role.toLowerCase());
      const config = configByRole.get(role.toLowerCase());

      return {
        role,
        lastSeenAt: participantRow?.lastSeenAt ?? null,
        lastSeenAction: participantRow?.lastSeenAction ?? null,
        agentType: participantRow?.agentType ?? ('remote' as const),
        lastStatus: participantRow?.lastStatus ?? null,
        lastDesiredState: participantRow?.lastDesiredState ?? null,
        isAlive: isAgentAlive(config?.spawnedAgentPid),
      };
    });

    const firstUserMessage = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .first();

    return {
      teamId: chatroom.teamId,
      teamName: chatroom.teamName ?? chatroom.teamId,
      expectedRoles,
      participants,
      hasHistory: firstUserMessage !== null,
    };
  },
});
