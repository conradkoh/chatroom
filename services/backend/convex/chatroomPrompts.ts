/**
 * Chatroom custom prompts — CRUD operations.
 *
 * All functions require SessionIdArg and chatroomId for auth.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';
import type { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get the prompt for a chatroom by type.
 * Returns the first matching prompt doc or null.
 */
export const getForChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    type: v.literal('development_workflow'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const prompt = await ctx.db
      .query('chatroom_prompts')
      .withIndex('by_chatroomId_type', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('type', args.type)
      )
      .first();

    return prompt ?? null;
  },
});

/**
 * Find all chatroom prompts that were copied from a given source prompt.
 */
export const findCopies = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    promptId: v.id('chatroom_prompts'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const copies = await ctx.db
      .query('chatroom_prompts')
      .withIndex('by_sourcePromptId', (q) => q.eq('sourcePromptId', args.promptId))
      .collect();

    return copies;
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new chatroom prompt.
 */
export const create = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    type: v.literal('development_workflow'),
    name: v.string(),
    content: v.string(),
    sourceChatroomId: v.optional(v.id('chatroom_rooms')),
    sourcePromptId: v.optional(v.id('chatroom_prompts')),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const now = Date.now();

    const id = await ctx.db.insert('chatroom_prompts', {
      type: args.type,
      chatroomId: args.chatroomId,
      ownerId: session.userId,
      name: args.name,
      content: args.content,
      isEnabled: true,
      sourceChatroomId: args.sourceChatroomId,
      sourcePromptId: args.sourcePromptId,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Update a prompt's content and/or name.
 */
export const update = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    promptId: v.id('chatroom_prompts'),
    content: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const patch: { content: string; updatedAt: number; name?: string } = {
      content: args.content,
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      patch.name = args.name;
    }

    await ctx.db.patch(args.promptId, patch);
  },
});

/**
 * Delete a prompt.
 */
export const remove = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    promptId: v.id('chatroom_prompts'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.delete(args.promptId);
  },
});

/**
 * Toggle a prompt's isEnabled flag.
 */
export const toggle = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    promptId: v.id('chatroom_prompts'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) {
      throw new Error('Prompt not found');
    }

    await ctx.db.patch(args.promptId, {
      isEnabled: !prompt.isEnabled,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Copy a prompt to one or more target chatrooms.
 * Sets sourceChatroomId and sourcePromptId for tracking.
 */
export const copyTo = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    sourcePromptId: v.id('chatroom_prompts'),
    targetChatroomIds: v.array(v.id('chatroom_rooms')),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const source = await ctx.db.get(args.sourcePromptId);
    if (!source) {
      throw new Error('Source prompt not found');
    }

    const now = Date.now();
    const createdIds: Id<'chatroom_prompts'>[] = [];

    for (const targetChatroomId of args.targetChatroomIds) {
      const id = await ctx.db.insert('chatroom_prompts', {
        type: source.type,
        chatroomId: targetChatroomId,
        ownerId: session.userId,
        name: source.name,
        content: source.content,
        isEnabled: true,
        sourceChatroomId: args.chatroomId,
        sourcePromptId: args.sourcePromptId,
        createdAt: now,
        updatedAt: now,
      });
      createdIds.push(id);
    }

    return createdIds;
  },
});

/**
 * Bulk-update content across selected copies of a prompt.
 */
export const bulkUpdate = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    sourcePromptId: v.id('chatroom_prompts'),
    targetPromptIds: v.array(v.id('chatroom_prompts')),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const now = Date.now();
    for (const promptId of args.targetPromptIds) {
      await ctx.db.patch(promptId, {
        content: args.content,
        updatedAt: now,
      });
    }
  },
});
