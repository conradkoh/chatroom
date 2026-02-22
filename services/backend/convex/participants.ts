import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { HEARTBEAT_TTL_MS } from '../config/reliability';
import { mutation, query } from './_generated/server';
import { areAllAgentsIdle, requireChatroomAccess } from './auth/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';
import { transitionTask } from './lib/taskStateMachine';

/**
 * Join a chatroom as a participant.
 * If already joined, updates lastSeenAt and optionally lastSeenAction + connectionId.
 * When the entry point (primary) role joins, auto-promotes queued tasks if no active task exists.
 * Requires CLI session authentication and chatroom access.
 *
 * The connectionId is used to detect concurrent wait-for-task processes.
 * When a new wait-for-task starts, it generates a unique connectionId.
 * Any old process with a different connectionId should detect the mismatch and exit.
 *
 * The action parameter records the CLI command that triggered the join (e.g. 'wait-for-task:started').
 */
export const join = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    // Unique connection ID to detect concurrent wait-for-task processes
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

    // State recovery: if agent was previously working and has in_progress tasks, reset them
    if (existing) {
      const orphanedTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
        )
        .filter((q) => q.eq(q.field('assignedTo'), args.role))
        .collect();

      for (const task of orphanedTasks) {
        await transitionTask(ctx, task._id, 'pending', 'resetStuckTask');
        console.warn(
          `[State Recovery] chatroomId=${args.chatroomId} role=${args.role} taskId=${task._id} ` +
            `action=reset_to_pending reason=agent_rejoined`
        );
      }
    }

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
    const entryPoint = chatroom.teamEntryPoint || chatroom.teamRoles?.[0];
    const normalizedRole = args.role.toLowerCase();
    const normalizedEntryPoint = entryPoint?.toLowerCase();

    if (normalizedRole === normalizedEntryPoint) {
      // Check if there's an active task (pending or in_progress)
      const activeTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .filter((q) =>
          q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
        )
        .collect();

      // Only promote if no active tasks AND all agents are idle (waiting for task)
      const allAgentsIdle = await areAllAgentsIdle(ctx, args.chatroomId);

      if (activeTasks.length === 0 && allAgentsIdle) {
        const queuedTasks = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
          )
          .collect();

        if (queuedTasks.length > 0) {
          // Sort by queuePosition to get oldest
          queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
          const nextTask = queuedTasks[0];

          await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');

          console.warn(
            `[Auto-Promote on Join] Primary role "${args.role}" joined (all agents ready). Promoted task ${nextTask._id} to pending. ` +
              `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
          );
        }
      } else if (activeTasks.length === 0 && !allAgentsIdle) {
        console.warn(
          `[Auto-Promote Deferred] Primary role "${args.role}" joined but some agents are not yet idle. Queue promotion deferred.`
        );
      }
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

/**
 * Remove a participant from a chatroom.
 * Called when an agent is stopped to ensure the UI no longer shows "Ready".
 * Requires CLI session authentication and chatroom access.
 */
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

/**
 * Get the highest priority waiting role in a chatroom.
 * Used for determining who should receive broadcast messages.
 * Requires CLI session authentication and chatroom access.
 */
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

    const now = Date.now();
    const presentParticipants = participants.filter(
      (p) =>
        p.lastSeenAt !== undefined &&
        now - p.lastSeenAt <= HEARTBEAT_TTL_MS &&
        p.role.toLowerCase() !== 'user'
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

/**
 * Get the current connection ID for a participant.
 * Used by CLI to detect if another wait-for-task process has taken over.
 * If the returned connectionId differs from the caller's, the caller should exit.
 * Requires CLI session authentication and chatroom access.
 */
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

/** Minimum age of lastSeenAt before an agent is considered unresponsive. */
const STUCK_LAST_SEEN_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum age of acknowledgedAt before a task is flagged as stuck. */
const STUCK_ACKNOWLEDGED_MS = 30 * 1000; // 30 seconds

/** Agent is considered online if seen within this window. */
const PRESENCE_THRESHOLD_MS = 90_000; // 90 seconds

/**
 * Get team lifecycle data for the frontend.
 *
 * Returns participants[], expectedRoles, missingRoles, expiredRoles, isReady,
 * hasHistory — status is derived from lastSeenAt (no FSM table).
 */
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

    const now = Date.now();
    const stuckRoles = new Set<string>();
    for (const task of acknowledgedTasks) {
      const role = task.assignedTo?.toLowerCase();
      if (!role) continue;
      const acknowledgedAge = task.acknowledgedAt != null ? now - task.acknowledgedAt : Infinity;
      if (acknowledgedAge < STUCK_ACKNOWLEDGED_MS) continue;
      const participant = participantByRole.get(role);
      const lastSeenAge = participant?.lastSeenAt != null ? now - participant.lastSeenAt : Infinity;
      if (lastSeenAge >= STUCK_LAST_SEEN_MS) {
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

    const aliveRoles = new Set(
      participants
        .filter((p) => p.lastSeenAt != null && now - p.lastSeenAt <= PRESENCE_THRESHOLD_MS)
        .map((p) => p.role.toLowerCase())
    );

    const missingRoles = expectedRoles.filter((r) => !aliveRoles.has(r.toLowerCase()));

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
      presentRoles: participants
        .filter((p) => p.lastSeenAt != null && now - p.lastSeenAt <= PRESENCE_THRESHOLD_MS)
        .map((p) => p.role),
      missingRoles,
      expiredRoles: [] as string[], // FSM concept — always empty now; kept for API compat
      isReady: missingRoles.length === 0,
      participants,
      hasHistory: firstUserMessage !== null,
    };
  },
});
