import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';
import { makePromoteNextTaskDeps } from './lib/promoteNextTaskDeps';
import { buildTeamRoleKey } from './utils/teamRoleKey';
import {
  PARTICIPANT_EXITED_ACTION,
  isActiveParticipant,
} from '../src/domain/entities/participant';
import { isAgentAlive } from '../src/domain/usecase/agent/is-agent-alive';
import { transitionAgentStatus } from '../src/domain/usecase/agent/transition-agent-status';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { getTeamRolesFromChatroom } from '../src/domain/usecase/chatroom/get-team-roles';
import { promoteNextTask } from '../src/domain/usecase/task/promote-next-task';

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
    // Agent type — 'custom' or 'remote'
    agentType: v.optional(v.union(v.literal('custom'), v.literal('remote'))),
    // The CLI command/action that triggered this join
    action: v.optional(v.string()),
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
      // Update presence fields and optionally connectionId/action/agentType.
      // connectionId is only updated when explicitly provided — never cleared by heartbeats
      // that don't supply a connectionId, to avoid breaking superseded-connection detection.
      await ctx.db.patch('chatroom_participants', existing._id, {
        ...(args.connectionId !== undefined ? { connectionId: args.connectionId } : {}),
        lastSeenAt: now,
        ...(args.action !== undefined ? { lastSeenAction: args.action } : {}),
        ...(args.agentType ? { agentType: args.agentType } : {}),
      });
      participantId = existing._id;
    } else {
      // Create new participant
      participantId = await ctx.db.insert('chatroom_participants', {
        chatroomId: args.chatroomId,
        role: args.role,
        connectionId: args.connectionId,
        lastSeenAt: now,
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
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    if (participant) {
      await ctx.db.patch('chatroom_participants', participant._id, {
        lastSeenAction: PARTICIPANT_EXITED_ACTION,
        connectionId: undefined,
      });
    }
  },
});

/** Updates lastSeenTokenAt for a participant to track live token output from the agent. */
export const updateTokenActivity = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();
    if (participant) {
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

    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

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
