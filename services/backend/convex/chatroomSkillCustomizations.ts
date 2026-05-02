/**
 * Chatroom skill customizations — CRUD operations.
 *
 * All functions require SessionIdArg and chatroomId for auth.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify that a customization exists and belongs to the given chatroom.
 * Throws ConvexError if the check fails.
 */
async function requireCustomizationInChatroom(
  ctx: MutationCtx,
  customizationId: Id<'chatroom_skillCustomizations'>,
  chatroomId: Id<'chatroom_rooms'>
) {
  const customization = await ctx.db.get('chatroom_skillCustomizations', customizationId);
  if (!customization || customization.chatroomId !== chatroomId) {
    throw new ConvexError({
      code: 'SKILL_NOT_FOUND_OR_DISABLED',
      message: 'Skill customization not found in this chatroom',
    });
  }
  return customization;
}

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
 * Verifies the customization belongs to the given chatroom.
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
    await requireCustomizationInChatroom(ctx, args.customizationId, args.chatroomId);

    const patch: { content: string; updatedAt: number; name?: string } = {
      content: args.content,
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      patch.name = args.name;
    }

    await ctx.db.patch('chatroom_skillCustomizations', args.customizationId, patch);
  },
});

/**
 * Delete a skill customization.
 * Verifies the customization belongs to the given chatroom.
 */
export const remove = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    customizationId: v.id('chatroom_skillCustomizations'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireCustomizationInChatroom(ctx, args.customizationId, args.chatroomId);
    await ctx.db.delete('chatroom_skillCustomizations', args.customizationId);
  },
});

/**
 * Toggle a skill customization's isEnabled flag.
 * Verifies the customization belongs to the given chatroom.
 */
export const toggle = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    customizationId: v.id('chatroom_skillCustomizations'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const customization = await requireCustomizationInChatroom(
      ctx,
      args.customizationId,
      args.chatroomId
    );

    await ctx.db.patch('chatroom_skillCustomizations', args.customizationId, {
      isEnabled: !customization.isEnabled,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Copy a skill customization to one or more target chatrooms.
 * Verifies access to ALL target chatrooms and that the source belongs to the source chatroom.
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

    // Verify access to every target chatroom
    await Promise.all(
      args.targetChatroomIds.map((id) => requireChatroomAccess(ctx, args.sessionId, id))
    );

    // Verify the source customization belongs to the source chatroom
    const source = await requireCustomizationInChatroom(
      ctx,
      args.sourceCustomizationId,
      args.chatroomId
    );

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
 * Verifies each target customization belongs to the given chatroom.
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
      await requireCustomizationInChatroom(ctx, customizationId, args.chatroomId);
      await ctx.db.patch('chatroom_skillCustomizations', customizationId, {
        content: args.content,
        updatedAt: now,
      });
    }
  },
});
