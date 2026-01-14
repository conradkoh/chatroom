import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './lib/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';

/**
 * Join a chatroom as a participant.
 * If already joined, updates status to waiting.
 * Requires CLI session authentication and chatroom access.
 */
export const join = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroomRooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check if already joined
    const existing = await ctx.db
      .query('chatroomParticipants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    if (existing) {
      // Update status to waiting
      await ctx.db.patch('chatroomParticipants', existing._id, { status: 'waiting' });
      return existing._id;
    }

    // Create new participant
    const participantId = await ctx.db.insert('chatroomParticipants', {
      chatroomId: args.chatroomId,
      role: args.role,
      status: 'waiting',
    });

    // Send join message
    await ctx.db.insert('chatroomMessages', {
      chatroomId: args.chatroomId,
      senderRole: args.role,
      content: `${args.role} joined the chatroom`,
      type: 'join',
    });

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
    chatroomId: v.id('chatroomRooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    return await ctx.db
      .query('chatroomParticipants')
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
    chatroomId: v.id('chatroomRooms'),
    role: v.string(),
    status: v.union(v.literal('idle'), v.literal('active'), v.literal('waiting')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const participant = await ctx.db
      .query('chatroomParticipants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    if (!participant) {
      throw new Error(`Participant ${args.role} not found in chatroom`);
    }

    await ctx.db.patch('chatroomParticipants', participant._id, { status: args.status });
  },
});

/**
 * Get a participant by role.
 * Requires CLI session authentication and chatroom access.
 */
export const getByRole = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroomRooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    return await ctx.db
      .query('chatroomParticipants')
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
    chatroomId: v.id('chatroomRooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const participants = await ctx.db
      .query('chatroomParticipants')
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
