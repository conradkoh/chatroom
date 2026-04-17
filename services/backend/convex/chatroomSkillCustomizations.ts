/**
 * Chatroom skill customizations — CRUD operations.
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
 * Get the skill customization for a chatroom by type.
 * Returns the first matching customization doc or null.
 */
export const getForChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    type: v.literal('development_workflow'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const customization = await ctx.db
      .query('chatroom_skillCustomizations')
      .withIndex('by_chatroomId_type', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('type', args.type)
      )
      .first();

    return customization ?? null;
  },
});

/**
 * Find all chatroom skill customizations that were copied from a given source customization.
 */
export const findCopies = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    customizationId: v.id('chatroom_skillCustomizations'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const copies = await ctx.db
      .query('chatroom_skillCustomizations')
      .withIndex('by_sourceCustomizationId', (q) =>
        q.eq('sourceCustomizationId', args.customizationId)
      )
      .collect();

    return copies;
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new chatroom skill customization.
 */
export const create = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    type: v.literal('development_workflow'),
    name: v.string(),
    content: v.string(),
    sourceChatroomId: v.optional(v.id('chatroom_rooms')),
    sourceCustomizationId: v.optional(v.id('chatroom_skillCustomizations')),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const now = Date.now();

    const id = await ctx.db.insert('chatroom_skillCustomizations', {
      type: args.type,
      chatroomId: args.chatroomId,
      ownerId: session.userId,
      name: args.name,
      content: args.content,
      isEnabled: true,
      sourceChatroomId: args.sourceChatroomId,
      sourceCustomizationId: args.sourceCustomizationId,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Update a skill customization's content and/or name.
 */
export const update = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    customizationId: v.id('chatroom_skillCustomizations'),
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

    await ctx.db.patch(args.customizationId, patch);
  },
});

/**
 * Delete a skill customization.
 */
export const remove = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    customizationId: v.id('chatroom_skillCustomizations'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.delete(args.customizationId);
  },
});

/**
 * Toggle a skill customization's isEnabled flag.
 */
export const toggle = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    customizationId: v.id('chatroom_skillCustomizations'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const customization = await ctx.db.get(args.customizationId);
    if (!customization) {
      throw new Error('Skill customization not found');
    }

    await ctx.db.patch(args.customizationId, {
      isEnabled: !customization.isEnabled,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Copy a skill customization to one or more target chatrooms.
 * Sets sourceChatroomId and sourceCustomizationId for tracking.
 */
export const copyTo = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    sourceCustomizationId: v.id('chatroom_skillCustomizations'),
    targetChatroomIds: v.array(v.id('chatroom_rooms')),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const source = await ctx.db.get(args.sourceCustomizationId);
    if (!source) {
      throw new Error('Source skill customization not found');
    }

    const now = Date.now();
    const createdIds: Id<'chatroom_skillCustomizations'>[] = [];

    for (const targetChatroomId of args.targetChatroomIds) {
      const id = await ctx.db.insert('chatroom_skillCustomizations', {
        type: source.type,
        chatroomId: targetChatroomId,
        ownerId: session.userId,
        name: source.name,
        content: source.content,
        isEnabled: true,
        sourceChatroomId: args.chatroomId,
        sourceCustomizationId: args.sourceCustomizationId,
        createdAt: now,
        updatedAt: now,
      });
      createdIds.push(id);
    }

    return createdIds;
  },
});

/**
 * Bulk-update content across selected copies of a skill customization.
 */
export const bulkUpdate = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    sourceCustomizationId: v.id('chatroom_skillCustomizations'),
    targetCustomizationIds: v.array(v.id('chatroom_skillCustomizations')),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const now = Date.now();
    for (const customizationId of args.targetCustomizationIds) {
      await ctx.db.patch(customizationId, {
        content: args.content,
        updatedAt: now,
      });
    }
  },
});
