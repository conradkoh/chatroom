import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireSavedCommandAccess } from './savedCommandsAuth';
import {
  assertNoDuplicateSavedCommandName,
  assertSavedCommandNameNotEmpty,
  assertSavedCommandPromptNotEmpty,
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

    const chatroomScoped = await ctx.db
      .query('chatroom_savedCommands')
      .withIndex('by_chatroom_scope', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('scope', 'chatroom')
      )
      .collect();

    const userScoped = await ctx.db
      .query('chatroom_savedCommands')
      .withIndex('by_ownerId_scope', (q) => q.eq('ownerId', session.userId).eq('scope', 'user'))
      .collect();

    return [...chatroomScoped, ...userScoped].sort((a, b) => a.name.localeCompare(b.name));
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
 * Update an existing saved command's name, type-specific fields, and/or scope.
 * Type changes are not permitted — a command's type is immutable.
 * When scope changes, the command is replaced (not patched) to cleanly swap
 * chatroomId/ownerId optional fields per schema contract.
 */
export const updateSavedCommand = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_savedCommands'),
    name: v.optional(v.string()),
    scope: v.optional(savedCommandScope),
    chatroomId: v.optional(v.id('chatroom_rooms')),
    command: v.optional(v.union(v.object({ type: v.literal('prompt'), prompt: v.string() }))),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const command = await ctx.db.get('chatroom_savedCommands', args.commandId);
    if (!command) {
      throw new ConvexError({
        code: 'SAVED_COMMAND_NOT_FOUND',
        message: 'Saved command not found',
      });
    }

    const { userId } = await requireSavedCommandAccess(ctx, args.sessionId, command);

    // Reject type changes
    const storedType = 'type' in command ? command.type : 'prompt';
    if (args.command && args.command.type !== storedType) {
      throw new ConvexError({
        code: 'COMMAND_TYPE_IMMUTABLE',
        message: 'Cannot change command type',
      });
    }

    const targetScope = args.scope ?? command.scope;
    const scopeChanging = targetScope !== command.scope;

    const finalName =
      args.name !== undefined ? assertSavedCommandNameNotEmpty(args.name) : command.name;
    let finalPrompt = command.prompt;
    if (args.command?.type === 'prompt') {
      finalPrompt = assertSavedCommandPromptNotEmpty(args.command.prompt);
    }

    if (scopeChanging) {
      if (targetScope === 'chatroom') {
        const targetChatroomId = args.chatroomId ?? command.chatroomId;
        if (!targetChatroomId) {
          throw new ConvexError({
            code: 'CHATROOM_ID_REQUIRED',
            message: 'chatroomId required when changing to chatroom scope',
          });
        }
        await requireChatroomAccess(ctx, args.sessionId, targetChatroomId);
        await assertNoDuplicateSavedCommandName(ctx, {
          scope: 'chatroom',
          name: finalName,
          chatroomId: targetChatroomId,
          excludeId: args.commandId,
        });
        await ctx.db.replace('chatroom_savedCommands', args.commandId, {
          type: command.type,
          scope: 'chatroom',
          chatroomId: targetChatroomId,
          name: finalName,
          prompt: finalPrompt,
          createdBy: command.createdBy,
          createdAt: command.createdAt,
          updatedAt: Date.now(),
        });
        return;
      }
      await assertNoDuplicateSavedCommandName(ctx, {
        scope: 'user',
        name: finalName,
        ownerId: userId as Id<'users'>,
        excludeId: args.commandId,
      });
      await ctx.db.replace('chatroom_savedCommands', args.commandId, {
        type: command.type,
        scope: 'user',
        ownerId: userId as Id<'users'>,
        name: finalName,
        prompt: finalPrompt,
        createdBy: command.createdBy,
        createdAt: command.createdAt,
        updatedAt: Date.now(),
      });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      await assertNoDuplicateSavedCommandName(ctx, {
        scope: command.scope,
        name: finalName,
        chatroomId: command.chatroomId ?? undefined,
        ownerId: command.ownerId ?? undefined,
        excludeId: args.commandId,
      });
      updates.name = finalName;
    }

    if (args.command?.type === 'prompt') {
      updates.prompt = finalPrompt;
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
