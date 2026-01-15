import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess, validateSession } from './lib/cliSessionAuth';

/**
 * Create a new chatroom with team configuration.
 * Requires session authentication. The chatroom will be owned by the authenticated user.
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
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      throw new Error(`Authentication failed: ${sessionResult.reason}`);
    }

    const chatroomId = await ctx.db.insert('chatroom_rooms', {
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
 * Requires session authentication and chatroom access.
 */
export const get = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return await ctx.db.get('chatroom_rooms', args.chatroomId);
  },
});

/**
 * List chatrooms owned by the authenticated user, sorted by creation time (newest first).
 * Requires session authentication.
 */
export const listByUser = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      throw new Error(`Authentication failed: ${sessionResult.reason}`);
    }

    const chatrooms = await ctx.db
      .query('chatroom_rooms')
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
    chatroomId: v.id('chatroom_rooms'),
    status: v.union(v.literal('active'), v.literal('interrupted'), v.literal('completed')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.patch('chatroom_rooms', args.chatroomId, { status: args.status });
  },
});

/**
 * Rename a chatroom.
 * Allows users to set a custom name for easier identification.
 * Requires CLI session authentication and chatroom access.
 */
export const rename = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Trim and validate name
    const trimmedName = args.name.trim();
    if (trimmedName.length === 0) {
      throw new Error('Chatroom name cannot be empty');
    }
    if (trimmedName.length > 100) {
      throw new Error('Chatroom name cannot exceed 100 characters');
    }

    await ctx.db.patch('chatroom_rooms', args.chatroomId, { name: trimmedName });
    return { success: true, name: trimmedName };
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
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Update chatroom status
    await ctx.db.patch('chatroom_rooms', args.chatroomId, { status: 'interrupted' });

    // Reset all participants to idle
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    for (const participant of participants) {
      await ctx.db.patch('chatroom_participants', participant._id, { status: 'idle' });
    }

    // Send interrupt message
    await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: 'system',
      content: 'Chatroom interrupted by user',
      type: 'interrupt',
    });

    // Reset chatroom to active for new messages
    await ctx.db.patch('chatroom_rooms', args.chatroomId, { status: 'active' });
  },
});

/**
 * Check if all team members have joined and are waiting.
 * Returns null if chatroom has no team (legacy chatroom).
 * Requires CLI session authentication and chatroom access.
 *
 * Note: isReady considers both presence AND readyUntil expiration.
 * A participant is considered "expired" if their readyUntil timestamp has passed.
 */
export const getTeamReadiness = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      return null;
    }

    // Chatrooms without team info
    if (!chatroom.teamId || !chatroom.teamRoles) {
      return null;
    }

    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    const now = Date.now();

    // Build participant info with readiness status
    const participantInfo = participants.map((p) => ({
      role: p.role,
      status: p.status,
      readyUntil: p.readyUntil,
      isExpired: p.readyUntil ? p.readyUntil < now : false,
    }));

    // Get roles that have joined (any status) and are not expired
    const activeRoles = participantInfo
      .filter((p) => !p.isExpired)
      .map((p) => p.role.toLowerCase());

    const expectedRoles = chatroom.teamRoles.map((r) => r.toLowerCase());

    // Missing roles: not present OR expired
    const missingRoles = expectedRoles.filter((r) => !activeRoles.includes(r));

    // Expired roles: present but expired
    const expiredRoles = participantInfo.filter((p) => p.isExpired).map((p) => p.role);

    return {
      teamId: chatroom.teamId,
      teamName: chatroom.teamName ?? chatroom.teamId,
      expectedRoles: chatroom.teamRoles,
      presentRoles: participants.map((p) => p.role),
      missingRoles: chatroom.teamRoles.filter((r) => !activeRoles.includes(r.toLowerCase())),
      expiredRoles,
      // isReady: all expected roles are present AND not expired
      isReady: missingRoles.length === 0,
      // New field: detailed participant info with readyUntil
      participants: participantInfo,
    };
  },
});
