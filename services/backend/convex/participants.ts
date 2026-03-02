import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { areAllAgentsWaiting, requireChatroomAccess } from './auth/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';
import { transitionTask } from './lib/taskStateMachine';
import { promoteNextTask } from '../src/domain/usecase/task/promote-next-task';
import { STUCK_TOKEN_THRESHOLD_MS } from '../config/reliability';
import { getTeamEntryPoint } from '../src/domain/entities/team';

/** Upserts a chatroom participant record, emits agent.waiting if entering get-next-task loop, and auto-promotes queued tasks for the entry point role. */
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
    if (chatroom.teamRoles && chatroom.teamRoles.length > 0) {
      const normalizedRole = args.role.toLowerCase();
      const normalizedTeamRoles = chatroom.teamRoles.map((r) => r.toLowerCase());
      if (!normalizedTeamRoles.includes(normalizedRole)) {
        throw new Error(
          `Invalid role: "${args.role}" is not in team configuration. Allowed roles: ${chatroom.teamRoles.join(', ')}`
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
      await ctx.db.patch('chatroom_participants', existing._id, {
        connectionId: args.connectionId,
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
      // Check if there's an active task (pending or in_progress).
      // Promotion is only attempted when no active task exists — this guard is
      // unique to the join scenario (no task transition fires here, so the
      // transitionTask usecase's auto-promotion won't trigger).
      const activeTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .filter((q) =>
          q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
        )
        .collect();

      if (activeTasks.length === 0) {
        await promoteNextTask(args.chatroomId, {
          areAllAgentsWaiting: (chatroomId) => areAllAgentsWaiting(ctx, chatroomId),
          getOldestQueuedTask: async (chatroomId) => {
            const tasks = await ctx.db
              .query('chatroom_tasks')
              .withIndex('by_chatroom_status', (q) =>
                q.eq('chatroomId', chatroomId).eq('status', 'queued')
              )
              .collect();
            if (tasks.length === 0) return null;
            tasks.sort((a, b) => a.queuePosition - b.queuePosition);
            return tasks[0] ?? null;
          },
          transitionTaskToPending: (nextTaskId) =>
            transitionTask(ctx, nextTaskId, 'pending', 'promoteNextTask'),
        });
      }
    }

    // Emit agent.waiting event when agent enters the get-next-task loop
    if (args.action === 'get-next-task:started') {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.waiting',
        chatroomId: args.chatroomId,
        role: args.role,
        timestamp: now,
      });
    }

    return participantId;
  },
});

/**
 * List all participants in a chatroom.
 * Requires CLI session authentication and chatroom access.
 */
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

/** Removes a participant from a chatroom (agent stopped). */
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
      await ctx.db.delete('chatroom_participants', participant._id);
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

/**
 * Get a participant by role.
 * Requires CLI session authentication and chatroom access.
 */
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
      (p) => p.role.toLowerCase() !== 'user'
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

/** Returns raw participant state (lastSeenAt, lastSeenAction, isStuck, agentType) for all team roles. */
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

    // Fetch acknowledged tasks for stuck-detection.
    const acknowledgedTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
      )
      .collect();

    const stuckRoles = new Set<string>();
    const now = Date.now();
    for (const task of acknowledgedTasks) {
      const role = task.assignedTo?.toLowerCase();
      if (!role) continue;
      const participant = participantByRole.get(role);
      // Agent is stuck if it has an acknowledged task and either:
      // 1. Has never been seen (lastSeenAt == null — never registered), OR
      // 2. Has not produced a token in over STUCK_TOKEN_THRESHOLD_MS
      //    (registered and seen but stopped producing output)
      if (participant?.lastSeenAt == null) {
        stuckRoles.add(role);
      } else if (
        participant.lastSeenTokenAt != null &&
        now - participant.lastSeenTokenAt > STUCK_TOKEN_THRESHOLD_MS
      ) {
        stuckRoles.add(role);
      }
    }

    const expectedRoles = chatroom.teamRoles;
    const participants = expectedRoles.map((role) => {
      const participantRow = participantByRole.get(role.toLowerCase());

      return {
        role,
        lastSeenAt: participantRow?.lastSeenAt ?? null,
        lastSeenAction: participantRow?.lastSeenAction ?? null,
        isStuck: stuckRoles.has(role.toLowerCase()),
        agentType: participantRow?.agentType ?? ('remote' as const),
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
