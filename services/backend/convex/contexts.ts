import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { loadCurrentContext } from '../src/domain/usecase/context/load-current-context';

function assertCanCreateContext(chatroom: Doc<'chatroom_rooms'>, role: string): void {
  const entryPoint = getTeamEntryPoint(chatroom);
  if (entryPoint && role.toLowerCase() !== entryPoint.toLowerCase()) {
    throw new ConvexError({
      code: 'CONTEXT_RESTRICTED',
      message: `Only the ${entryPoint} role can create contexts. Your role: ${role}`,
    });
  }
}

/** Returns an existing context id when triggerMessageId already has one; re-pins if needed. */
async function resolveExistingContextForTrigger(
  ctx: MutationCtx,
  chatroom: Doc<'chatroom_rooms'>,
  triggerMessageId: Id<'chatroom_messages'>
): Promise<Id<'chatroom_contexts'> | null> {
  const existingForTrigger = await ctx.db
    .query('chatroom_contexts')
    .withIndex('by_chatroom_trigger', (q) =>
      q.eq('chatroomId', chatroom._id).eq('triggerMessageId', triggerMessageId)
    )
    .first();

  if (!existingForTrigger) {
    return null;
  }

  if (chatroom.currentContextId !== existingForTrigger._id) {
    await ctx.db.patch('chatroom_rooms', chatroom._id, {
      currentContextId: existingForTrigger._id,
    });
  }

  return existingForTrigger._id;
}

async function createAndPinContext(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    content: string;
    role: string;
    triggerMessageId?: Id<'chatroom_messages'>;
  }
): Promise<Id<'chatroom_contexts'>> {
  const contextId = await ctx.db.insert('chatroom_contexts', {
    chatroomId: args.chatroomId,
    content: args.content,
    createdBy: args.role,
    createdAt: Date.now(),
    triggerMessageId: args.triggerMessageId,
    messageCountAtCreation: 0,
  });

  await ctx.db.patch('chatroom_rooms', args.chatroomId, {
    currentContextId: contextId,
  });

  await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: 'system',
    content: args.content,
    type: 'new-context',
    contextCreatedBy: args.role,
  });

  return contextId;
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
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    assertCanCreateContext(chatroom, args.role);

    if (!args.triggerMessageId) {
      return createAndPinContext(ctx, args);
    }

    const existingId = await resolveExistingContextForTrigger(ctx, chatroom, args.triggerMessageId);
    return existingId ?? createAndPinContext(ctx, args);
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
