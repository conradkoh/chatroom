import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireSavedCommandAccess } from './savedCommandsAuth';
import {
  assertNoDuplicateSavedCommandName,
  assertSavedCommandNameNotEmpty,
  assertSavedCommandPromptNotEmpty,
  effectiveSavedCommandScope,
} from './savedCommandValidation';

const savedCommandScope = v.union(v.literal('user'), v.literal('chatroom'));

/** The discriminated union type for a saved command (only 'prompt' variant for now). */
const savedCommandUnion = v.union(
  v.object({
    type: v.literal('prompt'),
    scope: savedCommandScope,
    name: v.string(),
    prompt: v.string(),
  })
);

/**
 * List all saved commands for a chatroom, sorted by name ascending.
 * Returns chatroom-scoped commands for the given chatroom ∪ user-scoped commands
 * for the current user.
 */
export const listSavedCommands = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const chatroomScoped = (
      await ctx.db
        .query('chatroom_savedCommands')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .collect()
    ).filter((c) => effectiveSavedCommandScope(c) === 'chatroom');

    const userScoped = (
      await ctx.db
        .query('chatroom_savedCommands')
        .withIndex('by_ownerId', (q) => q.eq('ownerId', session.userId))
        .collect()
    ).filter((c) => effectiveSavedCommandScope(c) === 'user');

    return [...chatroomScoped, ...userScoped]
      .map((cmd) => ({
        ...cmd,
        scope: effectiveSavedCommandScope(cmd),
      }))
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

    const trimmedName = assertSavedCommandNameNotEmpty(args.command.name);
    const trimmedPrompt = assertSavedCommandPromptNotEmpty(args.command.prompt);

    const now = Date.now();
    const base = {
      type: args.command.type,
      scope: args.command.scope,
      name: trimmedName,
      prompt: trimmedPrompt,
      createdBy: session.userId,
      createdAt: now,
      updatedAt: now,
    } as const;

    if (args.command.scope === 'chatroom') {
      await assertNoDuplicateSavedCommandName(ctx, {
        scope: 'chatroom',
        name: trimmedName,
        chatroomId: args.chatroomId,
      });
      return await ctx.db.insert('chatroom_savedCommands', {
        ...base,
        chatroomId: args.chatroomId,
      });
    }

    await assertNoDuplicateSavedCommandName(ctx, {
      scope: 'user',
      name: trimmedName,
      ownerId: session.userId,
    });
    return await ctx.db.insert('chatroom_savedCommands', {
      ...base,
      ownerId: session.userId,
    });
  },
});

/**
 * Update an existing saved command's name and/or type-specific fields.
 * Type changes are not permitted — a command's type is immutable.
 * Scope changes are not permitted — a command's scope is immutable.
 */
export const updateSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_savedCommands'),
    name: v.optional(v.string()),
    command: v.optional(v.union(v.object({ type: v.literal('prompt'), prompt: v.string() }))),
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get('chatroom_savedCommands', args.commandId);
    if (!command) {
      throw new ConvexError({
        code: 'SAVED_COMMAND_NOT_FOUND',
        message: 'Saved command not found',
      });
    }

    await requireSavedCommandAccess(ctx, args.sessionId, command);

    // Reject type changes
    const storedType = 'type' in command ? command.type : 'prompt';
    if (args.command && args.command.type !== storedType) {
      throw new ConvexError({
        code: 'COMMAND_TYPE_IMMUTABLE',
        message: 'Cannot change command type',
      });
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmedName = assertSavedCommandNameNotEmpty(args.name);
      await assertNoDuplicateSavedCommandName(ctx, {
        scope: effectiveSavedCommandScope(command),
        name: trimmedName,
        chatroomId: command.chatroomId ?? undefined,
        ownerId: command.ownerId ?? undefined,
        excludeId: args.commandId,
      });
      updates.name = trimmedName;
    }

    if (args.command) {
      if (args.command.type === 'prompt') {
        updates.prompt = assertSavedCommandPromptNotEmpty(args.command.prompt);
      }
    }

    await ctx.db.patch('chatroom_savedCommands', args.commandId, updates);
  },
});

/**
 * Delete a saved command.
 * Auth per scope: user-scoped commands require ownership;
 * chatroom-scoped commands require chatroom access.
 */
export const deleteSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_savedCommands'),
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get('chatroom_savedCommands', args.commandId);
    if (!command) {
      throw new ConvexError({
        code: 'SAVED_COMMAND_NOT_FOUND',
        message: 'Saved command not found',
      });
    }

    await requireSavedCommandAccess(ctx, args.sessionId, command);

    await ctx.db.delete('chatroom_savedCommands', args.commandId);
  },
});
