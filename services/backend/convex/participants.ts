import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { areAllAgentsReady, requireChatroomAccess } from './lib/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';

/**
 * Join a chatroom as a participant.
 * If already joined, updates status to waiting and refreshes readyUntil.
 * When the entry point (primary) role joins, auto-promotes queued tasks if no active task exists.
 * Requires CLI session authentication and chatroom access.
 */
export const join = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    // Optional timestamp when this participant's readiness expires
    readyUntil: v.optional(v.number()),
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
    if (existing) {
      // Update status to waiting and refresh readyUntil
      await ctx.db.patch('chatroom_participants', existing._id, {
        status: 'waiting',
        readyUntil: args.readyUntil,
      });
      participantId = existing._id;
    } else {
      // Create new participant
      participantId = await ctx.db.insert('chatroom_participants', {
        chatroomId: args.chatroomId,
        role: args.role,
        status: 'waiting',
        readyUntil: args.readyUntil,
      });

      // Send join message
      await ctx.db.insert('chatroom_messages', {
        chatroomId: args.chatroomId,
        senderRole: args.role,
        content: `${args.role} joined the chatroom`,
        type: 'join',
      });
    }

    // Auto-promote queued tasks when the entry point (primary) role joins
    // AND all other agents are ready (idle/waiting, not active)
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

          const now = Date.now();
          await ctx.db.patch('chatroom_tasks', nextTask._id, {
            status: 'pending',
            updatedAt: now,
          });

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
 * List all participants in a chatroom.
 * Requires CLI session authentication and chatroom access.
 */
export const list = query({
  args: {
    sessionId: v.string(),
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
 * Requires CLI session authentication and chatroom access.
 */
export const updateStatus = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    status: v.union(v.literal('idle'), v.literal('active'), v.literal('waiting')),
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

    await ctx.db.patch('chatroom_participants', participant._id, { status: args.status });
  },
});

/**
 * Get a participant by role.
 * Requires CLI session authentication and chatroom access.
 */
export const getByRole = query({
  args: {
    sessionId: v.string(),
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
    sessionId: v.string(),
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
