import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess, validateSession } from './auth/cliSessionAuth';

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
 * - agents: Array of agent statuses with computed effectiveStatus (accounts for expiration)
 * - chatStatus: Computed overall status ('ready' | 'working' | 'partial' | 'disconnected' | 'setup')
 * - teamReadiness: Summary of team readiness state
 *
 * This is the single source of truth for chatroom listing display.
 * Requires session authentication.
 */
export const listByUserWithStatus = query({
  args: {
    sessionId: v.string(),
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

    // Fetch all favorites for this user in one query
    const favorites = await ctx.db
      .query('chatroom_favorites')
      .withIndex('by_userId', (q) => q.eq('userId', sessionResult.userId))
      .collect();
    const favoriteIds = new Set(favorites.map((f) => f.chatroomId));

    // Fetch all participant data and compute statuses
    const chatroomsWithStatus = await Promise.all(
      chatrooms.map(async (chatroom) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
          .collect();

        // Compute agent statuses with expiration check
        // Check the appropriate timeout field based on status:
        // - 'active' agents use activeUntil (typically ~1 hour)
        // - 'waiting' agents use readyUntil (typically ~10 minutes)
        const agents = participants.map((p) => {
          let isExpired = false;
          if (p.status === 'active') {
            // Active agents expire based on activeUntil
            isExpired = p.activeUntil ? p.activeUntil < now : false;
          } else if (p.status === 'waiting') {
            // Waiting agents expire based on readyUntil
            isExpired = p.readyUntil ? p.readyUntil < now : false;
          }
          // Effective status: if expired, treat as 'disconnected'
          const effectiveStatus = isExpired ? ('disconnected' as const) : p.status;
          return {
            role: p.role,
            status: p.status, // Raw status in DB
            effectiveStatus, // Computed status considering expiration
            isExpired,
            readyUntil: p.readyUntil,
            activeUntil: p.activeUntil,
          };
        });

        // Compute chat status (single source of truth)
        const teamRoles = chatroom.teamRoles || [];
        const activeAgents = agents.filter((a) => !a.isExpired);
        const presentRoles = new Set(activeAgents.map((a) => a.role.toLowerCase()));

        const allPresent = teamRoles.every((r) => presentRoles.has(r.toLowerCase()));
        const hasDisconnected = agents.some((a) => a.isExpired);
        const hasActive = agents.some((a) => a.effectiveStatus === 'active');

        // Check if a user has ever sent a message in this chatroom.
        // A user message is the strongest signal that the chatroom has been used
        // and should not show the setup screen again — even if all agents disconnect.
        const firstUserMessage = await ctx.db
          .query('chatroom_messages')
          .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
            q.eq('chatroomId', chatroom._id).eq('senderRole', 'user').eq('type', 'message')
          )
          .first();
        const hasHistory = firstUserMessage !== null;

        // Compute chatStatus
        type ChatStatus = 'ready' | 'working' | 'partial' | 'disconnected' | 'setup' | 'completed';
        let chatStatus: ChatStatus;
        if (chatroom.status === 'completed') {
          chatStatus = 'completed';
        } else if (hasDisconnected && !allPresent) {
          chatStatus = 'disconnected';
        } else if (!allPresent && hasHistory) {
          // Agents are missing but chatroom was previously used — show disconnected, not setup
          chatStatus = 'disconnected';
        } else if (!allPresent) {
          chatStatus = 'setup';
        } else if (hasActive) {
          chatStatus = 'working';
        } else if (allPresent) {
          chatStatus = 'ready';
        } else {
          chatStatus = 'partial';
        }

        return {
          ...chatroom,
          agents,
          chatStatus,
          isFavorite: favoriteIds.has(chatroom._id),
          teamReadiness: {
            isReady: allPresent && !hasDisconnected,
            missingRoles: teamRoles.filter((r) => !presentRoles.has(r.toLowerCase())),
            expiredRoles: agents.filter((a) => a.isExpired).map((a) => a.role),
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
    sessionId: v.string(),
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
    // Validate session and check chatroom access - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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

    // Check if a user has ever sent a message in this chatroom.
    // A user message is the strongest signal that the chatroom has been used
    // and should not show the setup screen again — even if all agents disconnect.
    const firstUserMessage = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .first();
    const hasHistory = firstUserMessage !== null;

    return {
      teamId: chatroom.teamId,
      teamName: chatroom.teamName ?? chatroom.teamId,
      expectedRoles: chatroom.teamRoles,
      presentRoles: participants.map((p) => p.role),
      missingRoles: chatroom.teamRoles.filter((r) => !activeRoles.includes(r.toLowerCase())),
      expiredRoles,
      // isReady: all expected roles are present AND not expired
      isReady: missingRoles.length === 0,
      // Detailed participant info with readyUntil
      participants: participantInfo,
      // Whether the chatroom has been used (a user has sent at least one message)
      hasHistory,
    };
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
    sessionId: v.string(),
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
    sessionId: v.string(),
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
