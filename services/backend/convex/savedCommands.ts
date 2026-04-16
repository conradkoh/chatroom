import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

/**
 * List all saved commands for a chatroom, sorted by name ascending.
 */
export const listSavedCommands = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const commands = await ctx.db
      .query('chatroom_savedCommands')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Create a new saved command for a chatroom.
 * Returns the created command ID.
 */
export const createSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    name: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new ConvexError('Command name must not be empty');
    }

    const now = Date.now();
    const commandId = await ctx.db.insert('chatroom_savedCommands', {
      chatroomId: args.chatroomId,
      name: trimmedName,
      prompt: args.prompt,
      createdBy: args.sessionId,
      createdAt: now,
      updatedAt: now,
    });

    return commandId;
  },
});

/**
 * Update an existing saved command's name and/or prompt.
 */
export const updateSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_savedCommands'),
    name: v.optional(v.string()),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    if (!command) {
      throw new ConvexError('Saved command not found');
    }

    // Verify the caller has access to the chatroom this command belongs to
    await requireChatroomAccess(ctx, args.sessionId, command.chatroomId);

    const updates: Partial<{ name: string; prompt: string; updatedAt: number }> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName) {
        throw new ConvexError('Command name must not be empty');
      }
      updates.name = trimmedName;
    }

    if (args.prompt !== undefined) {
      updates.prompt = args.prompt;
    }

    await ctx.db.patch(args.commandId, updates);
  },
});

/**
 * Delete a saved command.
 */
export const deleteSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_savedCommands'),
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    if (!command) {
      throw new ConvexError('Saved command not found');
    }

    // Verify the caller has access to the chatroom this command belongs to
    await requireChatroomAccess(ctx, args.sessionId, command.chatroomId);

    await ctx.db.delete(args.commandId);
  },
});
