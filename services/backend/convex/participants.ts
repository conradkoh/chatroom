import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { getRolePriority } from './lib/hierarchy';
import { makePromoteNextTaskDeps } from './lib/promoteNextTaskDeps';
import { buildTeamRoleKey } from './utils/teamRoleKey';
import {
  PARTICIPANT_HEARTBEAT_MIN_INTERVAL_MS,
  CONNECTION_CLOSE_REQUEST_TTL_MS,
} from '../config/reliability';
import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
  PARTICIPANT_EXITED_ACTION,
  GET_NEXT_TASK_STOPPED_ACTION,
  isActiveParticipant,
} from '../src/domain/entities/participant';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { isAgentAlive } from '../src/domain/usecase/agent/is-agent-alive';
import { transitionAgentStatus } from '../src/domain/usecase/agent/transition-agent-status';
import { getTeamRolesFromChatroom } from '../src/domain/usecase/chatroom/get-team-roles';
import { findAcknowledgedTaskForRole } from '../src/domain/usecase/task/find-acknowledged-task-for-role';
import { promoteNextTask } from '../src/domain/usecase/task/promote-next-task';
import { readTask } from '../src/domain/usecase/task/read-task';

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

async function maybeStartAcknowledgedTaskFromTokenActivity(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  participant: NonNullable<Awaited<ReturnType<typeof getParticipantByChatroomRole>>>
): Promise<void> {
  const acknowledgedTask = await findAcknowledgedTaskForRole(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });

  const shouldStartTask =
    acknowledgedTask?.status === 'acknowledged' &&
    (participant.lastStatus === 'task.acknowledged' ||
      participant.lastSeenAction === NATIVE_TASK_INJECTED_ACTION ||
      participant.lastSeenAction === GET_NEXT_TASK_STOPPED_ACTION);

  if (!shouldStartTask) {
    return;
  }

  await readTask(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    taskId: acknowledgedTask._id,
  });
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

    // Auto-promote queued tasks when the entry point (primary) role joins
    // AND all other agents are ready (waiting, not active)
    // This ensures resilience - if a worker reconnects after being stuck, queued items get promoted
    const entryPoint = getTeamEntryPoint(chatroom);
    const normalizedRole = args.role.toLowerCase();
    const normalizedEntryPoint = entryPoint?.toLowerCase();

    if (normalizedRole === normalizedEntryPoint) {
      // Attempt queue promotion — promoteNextTask internally checks that
      // no active tasks (pending/acknowledged/in_progress) exist before
      // promoting, so no pre-check is needed here.
      await promoteNextTask(args.chatroomId, makePromoteNextTaskDeps(ctx));
    }

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
      await ctx.db.patch('chatroom_teamAgentConfigs', teamConfig._id, {
        circuitState: 'closed',
        circuitOpenedAt: undefined,
      });
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
      const acknowledgedTask = await findAcknowledgedTaskForRole(ctx, {
        chatroomId: args.chatroomId,
        role: args.role,
      });
      // Do not downgrade to agent.waiting while a claimed task awaits first token output.
      if (acknowledgedTask?.status === 'acknowledged') {
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
        await ctx.db.insert('chatroom_eventStream', {
          type: 'task.acknowledged',
          chatroomId: args.chatroomId,
          role: args.role,
          taskId: acknowledgedTask._id,
          timestamp: now,
        });
      }
      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
    }

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
      await maybeStartAcknowledgedTaskFromTokenActivity(ctx, args, participant);

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
