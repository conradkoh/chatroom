import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { loadCurrentContext } from '../src/domain/usecase/context/load-current-context';

/** True when triggerMessageId is a user message created after the pinned context. */
async function hasNewUserTriggerSinceContext(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  triggerMessageId: Id<'chatroom_messages'> | undefined,
  contextCreatedAt: number
): Promise<boolean> {
  if (!triggerMessageId) {
    return false;
  }

  const triggerMessage = await ctx.db.get('chatroom_messages', triggerMessageId);
  if (!triggerMessage || triggerMessage.chatroomId !== chatroomId) {
    return false;
  }

  return (
    triggerMessage.senderRole === 'user' &&
    triggerMessage.type === 'message' &&
    triggerMessage._creationTime > contextCreatedAt
  );
}

/** Creates a new context for a chatroom and sets it as the current pinned context. */
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
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Only the team entry point (planner/coordinator) can create contexts
    const entryPoint = getTeamEntryPoint(chatroom);
    if (entryPoint && args.role.toLowerCase() !== entryPoint.toLowerCase()) {
      throw new ConvexError({
        code: 'CONTEXT_RESTRICTED',
        message: `Only the ${entryPoint} role can create contexts. Your role: ${args.role}`,
      });
    }

    // If there is an existing context, require that the role has sent a handoff since it was created.
    // This prevents creating redundant contexts without any meaningful work in between.
    if (chatroom.currentContextId) {
      const currentContext = await ctx.db.get('chatroom_contexts', chatroom.currentContextId);
      if (currentContext) {
        const handoffSinceContext = await ctx.db
          .query('chatroom_messages')
          .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
            q
              .eq('chatroomId', args.chatroomId)
              .eq('senderRole', args.role)
              .eq('type', 'handoff')
              .gt('_creationTime', currentContext.createdAt)
          )
          .first();

        if (!handoffSinceContext) {
          const hasNewUserTrigger = await hasNewUserTriggerSinceContext(
            ctx,
            args.chatroomId,
            args.triggerMessageId,
            currentContext.createdAt
          );

          if (!hasNewUserTrigger) {
            throw new ConvexError({
              code: 'CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT',
              message:
                'Cannot create a new context without first sending a handoff since the last context was created.',
              existingContext: {
                content: currentContext.content,
                createdAt: currentContext.createdAt,
                createdBy: currentContext.createdBy,
              },
            });
          }
        }
      }
    }

    // Staleness is computed from the creation timestamp only — see read paths
    // (getContext, getCurrentContext) and the CLI renderers. The legacy
    // `messageCountAtCreation` field on the context schema is retained as 0
    // for backwards compatibility with old records; nothing reads it anymore.
    const messageCountAtCreation = 0;

    // Create context record
    const contextId = await ctx.db.insert('chatroom_contexts', {
      chatroomId: args.chatroomId,
      content: args.content,
      createdBy: args.role,
      createdAt: Date.now(),
      triggerMessageId: args.triggerMessageId,
      messageCountAtCreation,
    });

    // Update chatroom with current context
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      currentContextId: contextId,
    });

    // Insert new-context notification so the context change is visible in the chat
    await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: 'system',
      content: args.content,
      type: 'new-context',
    });

    return contextId;
  },
});

/** Returns recent contexts for a chatroom, newest first. */
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

/** Returns a context by ID with time-based staleness metadata (elapsed hours since creation). */
export const getContext = query({
  args: {
    ...SessionIdArg,
    contextId: v.id('chatroom_contexts'),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db.get('chatroom_contexts', args.contextId);
    if (!context) {
      throw new ConvexError({ code: 'CONTEXT_NOT_FOUND', message: 'Context not found' });
    }

    // Validate access to the chatroom this context belongs to
    await requireChatroomAccess(ctx, args.sessionId, context.chatroomId);

    // Compute time elapsed since context creation. Staleness is purely
    // time-based to keep this query at zero message-doc reads.
    const elapsedMs = Date.now() - context.createdAt;
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    return {
      ...context,
      elapsedHours,
    };
  },
});

/** Returns the currently pinned context with time-based staleness metadata, or null if none. */
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

    // Load the full context record plus time-based staleness via the shared
    // loader, then surface the additional context fields callers expect.
    const snapshot = await loadCurrentContext(ctx, args.chatroomId);
    if (!snapshot) {
      return null;
    }
    const context = await ctx.db.get('chatroom_contexts', chatroom.currentContextId);
    if (!context) {
      return null;
    }

    return {
      ...context,
      elapsedHours: snapshot.elapsedHours,
    };
  },
});

/** Clears the current context pin from a chatroom without deleting the context record. */
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
