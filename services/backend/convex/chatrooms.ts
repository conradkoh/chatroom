import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { validateCliSession, requireChatroomAccess } from './lib/cliSessionAuth';

/**
 * Create a new chatroom with team configuration.
 * Requires CLI session authentication. The chatroom will be owned by the authenticated user.
 */
export const create = mutation({
  args: {
    sessionId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
    teamRoles: v.array(v.string()),
    teamEntryPoint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate session
    const sessionResult = await validateCliSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      throw new Error(`Authentication failed: ${sessionResult.reason}`);
    }

    const chatroomId = await ctx.db.insert('chatrooms', {
      status: 'active',
      ownerId: sessionResult.userId,
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
 * Requires CLI session authentication and chatroom access.
 */
export const get = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatrooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return await ctx.db.get('chatrooms', args.chatroomId);
  },
});

/**
 * List chatrooms owned by the authenticated user, sorted by creation time (newest first).
 * Requires CLI session authentication.
 */
export const listByUser = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session
    const sessionResult = await validateCliSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      throw new Error(`Authentication failed: ${sessionResult.reason}`);
    }

    const chatrooms = await ctx.db
      .query('chatrooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', sessionResult.userId))
      .order('desc')
      .collect();
    return chatrooms;
  },
});

/**
 * Update the status of a chatroom.
 * Requires CLI session authentication and chatroom access.
 */
export const updateStatus = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatrooms'),
    status: v.union(v.literal('active'), v.literal('interrupted'), v.literal('completed')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.patch('chatrooms', args.chatroomId, { status: args.status });
  },
});

/**
 * Interrupt a chatroom and reset all participants.
 * Sends an interrupt message and resets chatroom to active for new messages.
 * Requires CLI session authentication and chatroom access.
 */
export const interrupt = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatrooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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
 * Requires CLI session authentication and chatroom access.
 */
export const getTeamReadiness = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatrooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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
