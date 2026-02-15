import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { HEARTBEAT_TTL_MS } from '../config/reliability';
import { mutation, query } from './_generated/server';
import { areAllAgentsReady, requireChatroomAccess } from './auth/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';
import { transitionTask } from './lib/taskStateMachine';

/**
 * Join a chatroom as a participant.
 * If already joined, updates status to waiting and refreshes readyUntil.
 * When the entry point (primary) role joins, auto-promotes queued tasks if no active task exists.
 * Requires CLI session authentication and chatroom access.
 *
 * The connectionId is used to detect concurrent wait-for-task processes.
 * When a new wait-for-task starts, it generates a unique connectionId.
 * Any old process with a different connectionId should detect the mismatch and exit.
 */
export const join = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    // Optional timestamp when this participant's readiness expires
    readyUntil: v.optional(v.number()),
    // Unique connection ID to detect concurrent wait-for-task processes
    connectionId: v.optional(v.string()),
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

    // IMPORTANT: State recovery must happen BEFORE updating the participant status
    // Check if agent was previously active (indicating a crash/restart)
    const wasActive = existing && existing.status === 'active';

    if (wasActive) {
      // Agent was previously active - recover any in_progress tasks they were working on
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
    if (existing) {
      // Update status to waiting and refresh readyUntil, clear activeUntil
      // Also update connectionId to allow old processes to detect they should exit
      // Set agentStatus to 'ready' (FSM: any state → ready via join)
      await ctx.db.patch('chatroom_participants', existing._id, {
        status: 'waiting',
        readyUntil: args.readyUntil,
        activeUntil: undefined, // Clear active timeout when transitioning to waiting
        connectionId: args.connectionId, // Track current connection for concurrent process detection
        agentStatus: 'ready', // FSM: agent is now ready for tasks
      });
      participantId = existing._id;
    } else {
      // Create new participant
      // Set agentStatus to 'ready' (FSM: offline → ready via join)
      participantId = await ctx.db.insert('chatroom_participants', {
        chatroomId: args.chatroomId,
        role: args.role,
        status: 'waiting',
        readyUntil: args.readyUntil,
        connectionId: args.connectionId, // Track current connection for concurrent process detection
        agentStatus: 'ready', // FSM: agent is now ready for tasks
        // activeUntil not set - will be set when transitioning to active
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

      // Only promote if no active tasks AND all agents are ready (not working on anything)
      const allAgentsReady = await areAllAgentsReady(ctx, args.chatroomId);

      if (activeTasks.length === 0 && allAgentsReady) {
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
      } else if (activeTasks.length === 0 && !allAgentsReady) {
        console.warn(
          `[Auto-Promote Deferred] Primary role "${args.role}" joined but some agents are still active. Queue promotion deferred.`
        );
      }
    }

    return participantId;
  },
});

/**
 * Refresh a participant's readyUntil timestamp (heartbeat).
 *
 * Called periodically by the `wait-for-task` CLI to prove the process is still
 * alive. The connectionId is verified so that stale processes (from a previous
 * wait-for-task invocation) cannot extend liveness for the current one.
 *
 * Requires CLI session authentication and chatroom access.
 */
export const heartbeat = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    connectionId: v.string(),
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

    if (!participant) {
      // Participant was cleaned up (e.g. by cleanupStaleAgents) but the CLI
      // heartbeat timer is still running. Signal the CLI to re-join. (Plan 026)
      console.warn(
        `[heartbeat] Participant ${args.role} not found in chatroom — signaling re-join`
      );
      return { status: 'rejoin_required' as const };
    }

    // Reject heartbeats from stale connections — a newer wait-for-task has taken over
    if (participant.connectionId && participant.connectionId !== args.connectionId) {
      console.warn(
        `[heartbeat] Rejected stale heartbeat for ${args.role}: connectionId mismatch ` +
          `(expected ${participant.connectionId}, got ${args.connectionId})`
      );
      return { status: 'ok' as const }; // Don't signal re-join for stale connections
    }

    // Refresh readyUntil
    await ctx.db.patch('chatroom_participants', participant._id, {
      readyUntil: Date.now() + HEARTBEAT_TTL_MS,
    });

    return { status: 'ok' as const };
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
 * Update participant status.
 * Status is either 'active' (working on a task) or 'waiting' (ready for tasks).
 * When transitioning to 'active', sets activeUntil and clears readyUntil.
 * When transitioning to 'waiting', sets readyUntil and clears activeUntil.
 * Requires CLI session authentication and chatroom access.
 */
export const updateStatus = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    status: v.union(v.literal('active'), v.literal('waiting')),
    // Optional: timestamp when the new status expires
    // For 'active': when agent is considered crashed (~1 hour)
    // For 'waiting': when agent is considered disconnected (~1 min, governed by HEARTBEAT_TTL_MS)
    expiresAt: v.optional(v.number()),
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

    if (!participant) {
      throw new Error(`Participant ${args.role} not found in chatroom`);
    }

    // Build the update based on the target status
    // Sync agentStatus with legacy status field (FSM Plan 026)
    const update: {
      status: 'active' | 'waiting';
      readyUntil?: number;
      activeUntil?: number;
      agentStatus: 'working' | 'ready';
    } = {
      status: args.status,
      agentStatus: args.status === 'active' ? 'working' : 'ready',
    };

    if (args.status === 'active') {
      // Transitioning to active: set activeUntil, clear readyUntil
      update.activeUntil = args.expiresAt;
      update.readyUntil = undefined;
    } else {
      // Transitioning to waiting: set readyUntil, clear activeUntil
      update.readyUntil = args.expiresAt;
      update.activeUntil = undefined;
    }

    await ctx.db.patch('chatroom_participants', participant._id, update);
  },
});

/**
 * Remove a participant from a chatroom.
 * Called when an agent is stopped to ensure the UI no longer shows "Ready".
 * Deletes the participant record so getTeamReadiness will report the role as missing.
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

    const waitingParticipants = participants.filter((p) => p.status === 'waiting');

    if (waitingParticipants.length === 0) {
      return null;
    }

    // Sort by priority (lower number = higher priority)
    waitingParticipants.sort((a, b) => getRolePriority(a.role) - getRolePriority(b.role));

    return waitingParticipants[0]?.role ?? null;
  },
});

/**
 * Update the agent status FSM state for a participant (Plan 026).
 *
 * This mutation sets the explicit `agentStatus` field on a participant record.
 * It is called by the daemon during crash recovery (restarting, dead_failed_revive)
 * and by the CLI at lifecycle points (ready, working, offline).
 *
 * If the participant does not exist and the target status is a "dead" state
 * (dead, dead_failed_revive, restarting), a minimal participant record is created
 * to hold the status. This handles the case where `participants.leave` deleted the
 * record before the daemon could report crash recovery status.
 *
 * Requires CLI session authentication and chatroom access.
 */
export const updateAgentStatus = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentStatus: v.union(
      v.literal('offline'),
      v.literal('dead'),
      v.literal('dead_failed_revive'),
      v.literal('ready'),
      v.literal('restarting'),
      v.literal('working')
    ),
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

    if (!participant) {
      // If participant doesn't exist and we're setting a dead/recovery state,
      // create a minimal participant record to hold the status
      const deadStates = ['dead', 'dead_failed_revive', 'restarting'];
      if (deadStates.includes(args.agentStatus)) {
        await ctx.db.insert('chatroom_participants', {
          chatroomId: args.chatroomId,
          role: args.role,
          status: 'waiting', // placeholder for legacy field
          agentStatus: args.agentStatus,
        });
        return;
      }
      throw new Error(`Participant ${args.role} not found in chatroom`);
    }

    await ctx.db.patch('chatroom_participants', participant._id, {
      agentStatus: args.agentStatus,
    });
  },
});

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
