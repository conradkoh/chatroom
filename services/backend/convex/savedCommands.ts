import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

/** The discriminated union type for a saved command (only 'prompt' variant for now). */
const savedCommandUnion = v.union(
  v.object({
    type: v.literal('prompt'),
    name: v.string(),
    prompt: v.string(),
  })
);

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
 * Create a new saved command for a chatroom using a discriminated-union `command` arg.
 * Returns the created command ID.
 */
export const createSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    command: savedCommandUnion,
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const trimmedName = args.command.name.trim();
    if (!trimmedName) {
      throw new ConvexError({
        code: 'COMMAND_NAME_EMPTY',
        message: 'Command name must not be empty',
      });
    }

    const now = Date.now();
    const commandId = await ctx.db.insert('chatroom_savedCommands', {
      ...args.command,
      name: trimmedName,
      chatroomId: args.chatroomId,
      createdBy: session.userId,
      createdAt: now,
      updatedAt: now,
    });

    return commandId;
  },
});

/**
 * Update an existing saved command's name and/or type-specific fields.
 * Type changes are not permitted — a command's type is immutable.
 */
export const updateSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_savedCommands'),
    name: v.optional(v.string()),
    command: v.optional(v.union(v.object({ type: v.literal('prompt'), prompt: v.string() }))),
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get("chatroom_savedCommands", args.commandId);
    if (!command) {
      throw new ConvexError({
        code: 'SAVED_COMMAND_NOT_FOUND',
        message: 'Saved command not found',
      });
    }

    // Verify the caller has access to the chatroom this command belongs to
    await requireChatroomAccess(ctx, args.sessionId, command.chatroomId);

    // Reject type changes — not supported
    const storedType = 'type' in command ? command.type : 'prompt';
    if (args.command && args.command.type !== storedType) {
      throw new ConvexError({
        code: 'COMMAND_TYPE_IMMUTABLE',
        message: 'Cannot change command type',
      });
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName) {
        throw new ConvexError({
          code: 'COMMAND_NAME_EMPTY',
          message: 'Command name must not be empty',
        });
      }
      updates.name = trimmedName;
    }

    if (args.command) {
      if (args.command.type === 'prompt') {
        updates.prompt = args.command.prompt;
      }
    }

    await ctx.db.patch("chatroom_savedCommands", args.commandId, updates);
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
    const command = await ctx.db.get("chatroom_savedCommands", args.commandId);
    if (!command) {
      throw new ConvexError({
        code: 'SAVED_COMMAND_NOT_FOUND',
        message: 'Saved command not found',
      });
    }

    // Verify the caller has access to the chatroom this command belongs to
    await requireChatroomAccess(ctx, args.sessionId, command.chatroomId);

    await ctx.db.delete("chatroom_savedCommands", args.commandId);
  },
});
