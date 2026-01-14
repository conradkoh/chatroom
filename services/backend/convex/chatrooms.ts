import { v } from 'convex/values';

import { mutation, query } from './_generated/server';

/**
 * Create a new chatroom with team configuration.
 */
export const create = mutation({
  args: {
    teamId: v.string(),
    teamName: v.string(),
    teamRoles: v.array(v.string()),
    teamEntryPoint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const chatroomId = await ctx.db.insert('chatrooms', {
      status: 'active',
      teamId: args.teamId,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
    });
    return chatroomId;
  },
});

/**
 * Get a chatroom by ID.
 */
export const get = query({
  args: { chatroomId: v.id('chatrooms') },
  handler: async (ctx, args) => {
    return await ctx.db.get('chatrooms', args.chatroomId);
  },
});

/**
 * List all chatrooms, sorted by creation time (newest first).
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const chatrooms = await ctx.db.query('chatrooms').order('desc').collect();
    return chatrooms;
  },
});

/**
 * Update the status of a chatroom.
 */
export const updateStatus = mutation({
  args: {
    chatroomId: v.id('chatrooms'),
    status: v.union(v.literal('active'), v.literal('interrupted'), v.literal('completed')),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch('chatrooms', args.chatroomId, { status: args.status });
  },
});

/**
 * Interrupt a chatroom and reset all participants.
 * Sends an interrupt message and resets chatroom to active for new messages.
 */
export const interrupt = mutation({
  args: { chatroomId: v.id('chatrooms') },
  handler: async (ctx, args) => {
    // Update chatroom status
    await ctx.db.patch('chatrooms', args.chatroomId, { status: 'interrupted' });

    // Reset all participants to idle
    const participants = await ctx.db
      .query('participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    for (const participant of participants) {
      await ctx.db.patch('participants', participant._id, { status: 'idle' });
    }

    // Send interrupt message
    await ctx.db.insert('messages', {
      chatroomId: args.chatroomId,
      senderRole: 'system',
      content: 'Chatroom interrupted by user',
      type: 'interrupt',
    });

    // Reset chatroom to active for new messages
    await ctx.db.patch('chatrooms', args.chatroomId, { status: 'active' });
  },
});

/**
 * Check if all team members have joined and are waiting.
 * Returns null if chatroom has no team (legacy chatroom).
 */
export const getTeamReadiness = query({
  args: { chatroomId: v.id('chatrooms') },
  handler: async (ctx, args) => {
    const chatroom = await ctx.db.get('chatrooms', args.chatroomId);
    if (!chatroom) {
      return null;
    }

    // Legacy chatrooms without team info
    if (!chatroom.teamId || !chatroom.teamRoles) {
      return null;
    }

    const participants = await ctx.db
      .query('participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Get roles that have joined (any status)
    const presentRoles = participants.map((p) => p.role.toLowerCase());
    const expectedRoles = chatroom.teamRoles.map((r) => r.toLowerCase());

    const missingRoles = expectedRoles.filter((r) => !presentRoles.includes(r));

    return {
      teamId: chatroom.teamId,
      teamName: chatroom.teamName ?? chatroom.teamId,
      expectedRoles: chatroom.teamRoles,
      presentRoles: participants.map((p) => p.role),
      missingRoles: chatroom.teamRoles.filter((r) => !presentRoles.includes(r.toLowerCase())),
      isReady: missingRoles.length === 0,
    };
  },
});
