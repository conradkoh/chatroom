import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess, validateSession } from './auth/cliSessionAuth';
import { isActiveParticipant } from '../src/domain/entities/participant';
import { clearChatroomUnread } from '../src/domain/usecase/chatroom/unread-status';
import { updateTeam as updateTeamUseCase } from '../src/domain/usecase/team/update-team';

/** Creates a new chatroom with the given team configuration. */
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
    if (!sessionResult.ok) {
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

/** Returns a chatroom by ID. */
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

/** Returns chatrooms owned by the user, sorted by last activity. */
export const listByUser = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    // Validate session — return empty list for unauthenticated users
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.ok) {
      return [];
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

/** Returns chatrooms owned by the user, enriched with agent presence, chat status, and unread indicators. */
export const listByUserWithStatus = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    // Validate session — return empty list for unauthenticated users
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.ok) {
      return [];
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

        // Compute agent presence from lastSeenAt (only active participants)
        const LAST_SEEN_ACTIVE_MS = 600_000; // 10 minutes
        const agents = participants.filter(isActiveParticipant).map((p) => ({
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
        };
      })
    );

    return chatroomsWithStatus;
  },
});

/** Updates the status of a chatroom. */
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

/** Updates the team configuration (roles, entry point) for an existing chatroom. */
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
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    if (args.teamRoles.length === 0) {
      throw new ConvexError('Team must have at least one role');
    }

    if (args.teamEntryPoint && !args.teamRoles.includes(args.teamEntryPoint)) {
      throw new ConvexError(
        `Entry point '${args.teamEntryPoint}' must be one of the team roles: ${args.teamRoles.join(', ')}`
      );
    }

    await updateTeamUseCase(ctx, {
      chatroomId: args.chatroomId,
      teamId: args.teamId,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
    });
  },
});

/** Sets a custom display name for a chatroom. */
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

/** Toggles the favorite status of a chatroom for the current user. */
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

/** Returns whether the current user has favorited a chatroom. */
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

/** Updates the user's read cursor for a chatroom to the current timestamp. */
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

    // Clear materialized unread status
    await clearChatroomUnread(ctx, args.chatroomId, session.userId);
  },
});

/** Returns the IDs of chatrooms that the authenticated user has favorited. */
export const listFavoriteIds = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.ok) {
      return [];
    }

    const favorites = await ctx.db
      .query('chatroom_favorites')
      .withIndex('by_userId', (q) => q.eq('userId', sessionResult.userId))
      .collect();

    return favorites.map((f) => f.chatroomId as string);
  },
});

/** Returns unread status (has messages newer than read cursor) for each chatroom the user owns. */
export const listUnreadStatus = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.ok) {
      return [];
    }

    // Try materialized unread status first (single query, no N+1)
    const materializedStatus = await ctx.db
      .query('chatroom_unreadStatus')
      .withIndex('by_userId', (q) => q.eq('userId', sessionResult.userId))
      .collect();

    if (materializedStatus.length > 0) {
      return materializedStatus.map((s) => ({
        chatroomId: s.chatroomId as string,
        hasUnread: s.hasUnread,
        hasUnreadHandoff: s.hasUnreadHandoff,
      }));
    }

    // Fallback: compute from message scans (migration safety)
    const [chatrooms, readCursors] = await Promise.all([
      ctx.db
        .query('chatroom_rooms')
        .withIndex('by_ownerId', (q) => q.eq('ownerId', sessionResult.userId))
        .collect(),
      ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId', (q) => q.eq('userId', sessionResult.userId))
        .collect(),
    ]);

    const readCursorMap = new Map(readCursors.map((c) => [c.chatroomId.toString(), c.lastSeenAt]));

    const unreadStatus = await Promise.all(
      chatrooms.map(async (chatroom) => {
        const lastSeenAt = readCursorMap.get(chatroom._id.toString());
        let hasUnread = false;
        let hasUnreadHandoff = false;

        const recentMessages = await ctx.db
          .query('chatroom_messages')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
          .order('desc')
          .take(10);

        if (lastSeenAt !== undefined) {
          hasUnread = recentMessages.some((msg) => msg._creationTime > lastSeenAt);
          if (hasUnread) {
            hasUnreadHandoff = recentMessages.some(
              (msg) =>
                msg._creationTime > lastSeenAt &&
                msg.type === 'handoff' &&
                msg.targetRole?.toLowerCase() === 'user'
            );
          }
        } else {
          hasUnread = recentMessages.length > 0;
          if (hasUnread) {
            hasUnreadHandoff = recentMessages.some(
              (msg) => msg.type === 'handoff' && msg.targetRole?.toLowerCase() === 'user'
            );
          }
        }

        return { chatroomId: chatroom._id as string, hasUnread, hasUnreadHandoff };
      })
    );

    return unreadStatus;
  },
});

/** Returns participant presence (role, lastSeenAt, lastSeenAction) for all chatrooms the user owns. */
export const listParticipantPresence = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.ok) {
      return [];
    }

    const chatrooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', sessionResult.userId))
      .collect();

    const presence = await Promise.all(
      chatrooms.map(async (chatroom) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
          .collect();

        return participants.map((p) => ({
          chatroomId: chatroom._id as string,
          role: p.role,
          lastSeenAt: p.lastSeenAt ?? null,
          lastSeenAction: p.lastSeenAction ?? null,
          lastStatus: p.lastStatus ?? null,
          lastDesiredState: p.lastDesiredState ?? null,
        }));
      })
    );

    return presence.flat();
  },
});

/** Returns participant presence for a single chatroom. Per-chatroom subscription reduces blast radius. */
export const getPresenceForChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.ok) return [];

    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return participants.map((p) => ({
      chatroomId: args.chatroomId as string,
      role: p.role,
      lastSeenAt: p.lastSeenAt ?? null,
      lastSeenAction: p.lastSeenAction ?? null,
      lastStatus: p.lastStatus ?? null,
      lastDesiredState: p.lastDesiredState ?? null,
    }));
  },
});

export const recordChatroomObservation = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.ok) {
      throw new Error(`Authentication failed: ${sessionResult.reason}`);
    }

    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    if (!chatroom) {
      throw new ConvexError('Chatroom not found');
    }

    const now = Date.now();

    // Check if observation record exists for this chatroom
    const existing = await ctx.db
      .query('chatroom_observation')
      .withIndex('by_chatroomId', (q) => q.eq('chatroomId', args.chatroomId))
      .first();

    if (existing) {
      // Update existing observation
      await ctx.db.patch(existing._id, { lastObservedAt: now });
    } else {
      // Create new observation record
      await ctx.db.insert('chatroom_observation', {
        chatroomId: args.chatroomId,
        lastObservedAt: now,
      });
    }
  },
});
