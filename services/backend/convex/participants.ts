import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { getRolePriority } from './lib/hierarchy';

/**
 * Join a chatroom as a participant.
 * If already joined, updates status to waiting.
 */
export const join = mutation({
  args: {
    chatroomId: v.id('chatrooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if already joined
    const existing = await ctx.db
      .query('participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    if (existing) {
      // Update status to waiting
      await ctx.db.patch('participants', existing._id, { status: 'waiting' });
      return existing._id;
    }

    // Create new participant
    const participantId = await ctx.db.insert('participants', {
      chatroomId: args.chatroomId,
      role: args.role,
      status: 'waiting',
    });

    // Send join message
    await ctx.db.insert('messages', {
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
 */
export const list = query({
  args: { chatroomId: v.id('chatrooms') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});

/**
 * Update participant status.
 */
export const updateStatus = mutation({
  args: {
    chatroomId: v.id('chatrooms'),
    role: v.string(),
    status: v.union(v.literal('idle'), v.literal('active'), v.literal('waiting')),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db
      .query('participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    if (!participant) {
      throw new Error(`Participant ${args.role} not found in chatroom`);
    }

    await ctx.db.patch('participants', participant._id, { status: args.status });
  },
});

/**
 * Get a participant by role.
 */
export const getByRole = query({
  args: {
    chatroomId: v.id('chatrooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();
  },
});

/**
 * Get the highest priority waiting role in a chatroom.
 * Used for determining who should receive broadcast messages.
 */
export const getHighestPriorityWaitingRole = query({
  args: { chatroomId: v.id('chatrooms') },
  handler: async (ctx, args) => {
    const participants = await ctx.db
      .query('participants')
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
