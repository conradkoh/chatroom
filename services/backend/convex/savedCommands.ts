import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internalMutation, mutation, query } from './_generated/server';
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
 * Coerces legacy rows (no `type` field) to the typed 'prompt' shape transparently.
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
    return commands
      .map((cmd) => {
        // Coerce legacy rows (missing `type`) to the typed shape
        if (!('type' in cmd) || cmd.type === undefined) {
          return { ...cmd, type: 'prompt' as const };
        }
        return cmd;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
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
      throw new ConvexError('Command name must not be empty');
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
    command: v.optional(
      v.union(v.object({ type: v.literal('prompt'), prompt: v.string() }))
    ),
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    if (!command) {
      throw new ConvexError('Saved command not found');
    }

    // Verify the caller has access to the chatroom this command belongs to
    await requireChatroomAccess(ctx, args.sessionId, command.chatroomId);

    // Reject type changes — not supported
    const storedType = 'type' in command ? command.type : 'prompt';
    if (args.command && args.command.type !== storedType) {
      throw new ConvexError('Cannot change command type');
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName) {
        throw new ConvexError('Command name must not be empty');
      }
      updates.name = trimmedName;
    }

    if (args.command) {
      if (args.command.type === 'prompt') {
        updates.prompt = args.command.prompt;
      }
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

/**
 * One-shot backfill: assigns `type: 'prompt'` to any saved command rows that
 * predate the discriminated-union schema. Idempotent — safe to re-run.
 *
 * Run with: `npx convex run savedCommands:migrateSavedCommandsAddType`
 */
export const migrateSavedCommandsAddType = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('chatroom_savedCommands').collect();
    let migrated = 0;
    for (const row of all) {
      // Cast through unknown — old rows are missing `type` per the legacy shape
      const r = row as unknown as { type?: string; _id: typeof row._id };
      if (!r.type) {
        await ctx.db.patch(r._id, { type: 'prompt' as const });
        migrated++;
      }
    }
    return { total: all.length, migrated };
  },
});
