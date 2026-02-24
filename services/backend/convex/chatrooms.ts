import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess, validateSession } from './auth/cliSessionAuth';

/**
 * Create a new chatroom with team configuration.
 * Requires session authentication. The chatroom will be owned by the authenticated user.
 */
export const create = mutation({
  args: {
    ...SessionIdArg,
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
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return chatroom;
  },
});

/**
 * List chatrooms owned by the authenticated user, sorted by last activity (most recent first).
 * Falls back to creation time for chatrooms without activity.
 * Requires session authentication.
 */
export const listByUser = query({
  args: {
    ...SessionIdArg,
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
      .collect();

    // Sort by lastActivityAt (most recent first), falling back to _creationTime
    chatrooms.sort((a, b) => {
      const aTime = a.lastActivityAt ?? a._creationTime;
      const bTime = b.lastActivityAt ?? b._creationTime;
      return bTime - aTime;
    });

    return chatrooms;
  },
});

/**
 * List chatrooms owned by the authenticated user with computed agent and chat status.
 * Returns enriched chatroom data with:
 * - agents: Array of agent presence with lastSeenAt
 * - chatStatus: Computed overall status ('working' | 'active' | 'idle' | 'completed')
 * - teamReadiness: Summary of team readiness state
 *
 * This is the single source of truth for chatroom listing display.
 * Requires session authentication.
 */
export const listByUserWithStatus = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    // Validate session
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      throw new Error(`Authentication failed: ${sessionResult.reason}`);
    }

    // Fetch chatrooms - we'll sort by lastActivityAt after fetching
    const chatrooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', sessionResult.userId))
      .collect();

    // Sort by lastActivityAt (most recent first), falling back to _creationTime
    chatrooms.sort((a, b) => {
      const aTime = a.lastActivityAt ?? a._creationTime;
      const bTime = b.lastActivityAt ?? b._creationTime;
      return bTime - aTime;
    });

    const now = Date.now();

    // Fetch all favorites and read cursors for this user in parallel
    const [favorites, readCursors] = await Promise.all([
      ctx.db
        .query('chatroom_favorites')
        .withIndex('by_userId', (q) => q.eq('userId', sessionResult.userId))
        .collect(),
      ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId', (q) => q.eq('userId', sessionResult.userId))
        .collect(),
    ]);
    const favoriteIds = new Set(favorites.map((f) => f.chatroomId));
    const readCursorMap = new Map(readCursors.map((c) => [c.chatroomId.toString(), c.lastSeenAt]));

    // Fetch all participant data and compute statuses
    const chatroomsWithStatus = await Promise.all(
      chatrooms.map(async (chatroom) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
          .collect();

        // Compute agent presence from lastSeenAt
        const LAST_SEEN_ACTIVE_MS = 600_000; // 10 minutes
        const agents = participants.map((p) => ({
          role: p.role,
          lastSeenAt: p.lastSeenAt ?? null,
        }));

        // Compute chat status (single source of truth)
        const inProgressTask = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', chatroom._id).eq('status', 'in_progress')
          )
          .first();
        const hasActive = inProgressTask !== null;

        // Compute chatStatus
        type ChatStatus = 'working' | 'active' | 'idle' | 'completed';
        let chatStatus: ChatStatus;
        if (chatroom.status === 'completed') {
          chatStatus = 'completed';
        } else if (hasActive) {
          chatStatus = 'working';
        } else if (
          agents.some((a) => a.lastSeenAt != null && now - a.lastSeenAt <= LAST_SEEN_ACTIVE_MS)
        ) {
          chatStatus = 'active';
        } else {
          chatStatus = 'idle';
        }

        // Check for unread messages (efficiently using read cursor)
        // Only check if user has a read cursor; otherwise all messages are "unread"
        const lastSeenAt = readCursorMap.get(chatroom._id.toString());
        let hasUnread = false;
        if (lastSeenAt !== undefined) {
          // Check if there's any message newer than the cursor
          // Use the chatroom index and filter by creation time
          const newerMessage = await ctx.db
            .query('chatroom_messages')
            .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
            .order('desc')
            .first();
          hasUnread = newerMessage !== null && newerMessage._creationTime > lastSeenAt;
        } else {
          // No cursor means user has never opened this chatroom
          // Check if there are any messages at all
          const anyMessage = await ctx.db
            .query('chatroom_messages')
            .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
            .first();
          hasUnread = anyMessage !== null;
        }

        return {
          ...chatroom,
          agents,
          chatStatus,
          isFavorite: favoriteIds.has(chatroom._id),
          hasUnread,
          teamReadiness: {
            isReady: agents.some(
              (a) => a.lastSeenAt != null && now - a.lastSeenAt <= LAST_SEEN_ACTIVE_MS
            ),
            missingRoles: [],
            expiredRoles: [],
          },
        };
      })
    );

    return chatroomsWithStatus;
  },
});

/**
 * Update the status of a chatroom.
 * Requires CLI session authentication and chatroom access.
 */
export const updateStatus = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    status: v.union(v.literal('active'), v.literal('completed')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.patch('chatroom_rooms', args.chatroomId, { status: args.status });
  },
});

/**
 * Update the team configuration for an existing chatroom.
 * Allows dynamic switching between team types (e.g., pair → squad).
 * Active agents will need to reconnect after the switch.
 * Requires CLI session authentication and chatroom access.
 */
export const updateTeam = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    teamId: v.string(),
    teamName: v.string(),
    teamRoles: v.array(v.string()),
    teamEntryPoint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Structural validation: team must have at least one role
    if (args.teamRoles.length === 0) {
      throw new ConvexError('Team must have at least one role');
    }

    // If entry point is specified, it must be one of the team roles
    if (args.teamEntryPoint && !args.teamRoles.includes(args.teamEntryPoint)) {
      throw new ConvexError(
        `Entry point '${args.teamEntryPoint}' must be one of the team roles: ${args.teamRoles.join(', ')}`
      );
    }

    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      teamId: args.teamId,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
    });
  },
});

/**
 * Rename a chatroom.
 * Allows users to set a custom name for easier identification.
 * Requires CLI session authentication and chatroom access.
 */
export const rename = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
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

// ============================================================================
// FAVORITES
// ============================================================================

/**
 * Toggle favorite status for a chatroom.
 * If currently favorited, removes the favorite. Otherwise, adds it.
 * Requires session authentication and chatroom access.
 */
export const toggleFavorite = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check if favorite already exists
    const existing = await ctx.db
      .query('chatroom_favorites')
      .withIndex('by_userId_chatroomId', (q) =>
        q.eq('userId', session.userId).eq('chatroomId', args.chatroomId)
      )
      .first();

    if (existing) {
      // Remove favorite
      await ctx.db.delete('chatroom_favorites', existing._id);
      return { isFavorite: false };
    }

    // Add favorite
    await ctx.db.insert('chatroom_favorites', {
      chatroomId: args.chatroomId,
      userId: session.userId,
      createdAt: Date.now(),
    });
    return { isFavorite: true };
  },
});

/**
 * Check if a chatroom is favorited by the current user.
 * Requires session authentication.
 */
export const isFavorite = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const favorite = await ctx.db
      .query('chatroom_favorites')
      .withIndex('by_userId_chatroomId', (q) =>
        q.eq('userId', session.userId).eq('chatroomId', args.chatroomId)
      )
      .first();

    return { isFavorite: !!favorite };
  },
});

// ============================================================================
// READ CURSORS (for unread indicators)
// ============================================================================

/**
 * Mark a chatroom as read by updating the user's read cursor.
 * Called when the user opens/views a chatroom.
 * Sets the cursor to the current time so future messages will be unread.
 * Requires session authentication and chatroom access.
 */
export const markAsRead = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const now = Date.now();

    // Check if cursor already exists
    const existing = await ctx.db
      .query('chatroom_read_cursors')
      .withIndex('by_userId_chatroomId', (q) =>
        q.eq('userId', session.userId).eq('chatroomId', args.chatroomId)
      )
      .first();

    if (existing) {
      await ctx.db.patch('chatroom_read_cursors', existing._id, {
        lastSeenAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_read_cursors', {
        chatroomId: args.chatroomId,
        userId: session.userId,
        lastSeenAt: now,
        updatedAt: now,
      });
    }
  },
});
