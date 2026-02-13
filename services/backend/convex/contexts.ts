import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

/**
 * Create a new context for a chatroom.
 * This replaces the current context with a new one (explicit context management).
 * Requires session authentication and chatroom access.
 */
export const createContext = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    role: v.string(),
    triggerMessageId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get current message count in chatroom for staleness detection
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    const messageCount = messages.length;

    // Create context record
    const contextId = await ctx.db.insert('chatroom_contexts', {
      chatroomId: args.chatroomId,
      content: args.content,
      createdBy: args.role,
      createdAt: Date.now(),
      triggerMessageId: args.triggerMessageId,
      messageCountAtCreation: messageCount,
    });

    // Update chatroom with current context
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      currentContextId: contextId,
    });

    // Insert system notification message so the context change is visible in the chat
    await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: 'system',
      content: args.content,
      type: 'system',
    });

    return contextId;
  },
});

/**
 * List recent contexts for a chatroom.
 * Returns contexts ordered by creation time (newest first).
 * Requires session authentication and chatroom access.
 */
export const listContexts = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()), // default 10
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = args.limit ?? 10;

    // Get contexts ordered by creation time (newest first)
    const contexts = await ctx.db
      .query('chatroom_contexts')
      .withIndex('by_chatroom_latest', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(limit);

    return contexts;
  },
});

/**
 * Get a specific context by ID.
 * Returns the context with associated metadata.
 * Requires session authentication and access to the chatroom.
 */
export const getContext = query({
  args: {
    ...SessionIdArg,
    contextId: v.id('chatroom_contexts'),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db.get('chatroom_contexts', args.contextId);
    if (!context) {
      throw new ConvexError('Context not found');
    }

    // Validate access to the chatroom this context belongs to
    await requireChatroomAccess(ctx, args.sessionId, context.chatroomId);

    // Get current message count to compute staleness
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', context.chatroomId))
      .collect();
    const currentMessageCount = messages.length;
    const messagesSinceContext = currentMessageCount - (context.messageCountAtCreation ?? 0);

    // Compute time elapsed since context creation
    const elapsedMs = Date.now() - context.createdAt;
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    return {
      ...context,
      messagesSinceContext,
      elapsedHours,
    };
  },
});

/**
 * Get the current active context for a chatroom.
 * Returns the context currently pinned in the chatroom, or null if none.
 * Includes staleness information (message count since creation, time elapsed).
 * Requires session authentication and chatroom access.
 */
export const getCurrentContext = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    if (!chatroom.currentContextId) {
      return null;
    }

    const context = await ctx.db.get('chatroom_contexts', chatroom.currentContextId);
    if (!context) {
      return null;
    }

    // Get current message count to compute staleness
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    const currentMessageCount = messages.length;
    const messagesSinceContext = currentMessageCount - (context.messageCountAtCreation ?? 0);

    // Compute time elapsed since context creation
    const elapsedMs = Date.now() - context.createdAt;
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    return {
      ...context,
      messagesSinceContext,
      elapsedHours,
    };
  },
});

/**
 * Clear the current context for a chatroom.
 * This removes the context pin without deleting the context itself.
 * Requires session authentication and chatroom access.
 */
export const clearCurrentContext = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Clear the current context reference
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      currentContextId: undefined,
    });

    return { success: true };
  },
});
