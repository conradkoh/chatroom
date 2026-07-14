import { ConvexError } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

export function normalizeSavedCommandName(name: string): string {
  return name.trim();
}

export function normalizeSavedCommandPrompt(prompt: string): string {
  return prompt.trim();
}

export function effectiveSavedCommandScope(
  command: Doc<'chatroom_savedCommands'>
): 'user' | 'chatroom' {
  if (command.scope) return command.scope;
  return command.chatroomId ? 'chatroom' : 'user';
}

export function assertSavedCommandNameNotEmpty(name: string): string {
  const trimmed = normalizeSavedCommandName(name);
  if (!trimmed) {
    throw new ConvexError({
      code: 'COMMAND_NAME_EMPTY',
      message: 'Command name must not be empty',
    });
  }
  return trimmed;
}

export function assertSavedCommandPromptNotEmpty(prompt: string): string {
  const trimmed = normalizeSavedCommandPrompt(prompt);
  if (!trimmed) {
    throw new ConvexError({
      code: 'COMMAND_PROMPT_EMPTY',
      message: 'Command prompt must not be empty',
    });
  }
  return trimmed;
}

export async function assertNoDuplicateSavedCommandName(
  ctx: QueryCtx | MutationCtx,
  args: {
    scope: 'user' | 'chatroom';
    name: string;
    chatroomId?: Id<'chatroom_rooms'>;
    ownerId?: Id<'users'>;
    excludeId?: Id<'chatroom_savedCommands'>;
  }
): Promise<void> {
  const lower = args.name.toLowerCase();
  const candidates =
    args.scope === 'chatroom'
      ? await ctx.db
          .query('chatroom_savedCommands')
          .withIndex('by_chatroom_scope', (q) =>
            q.eq('chatroomId', args.chatroomId as Id<'chatroom_rooms'>).eq('scope', 'chatroom')
          )
          .collect()
      : await ctx.db
          .query('chatroom_savedCommands')
          .withIndex('by_ownerId_scope', (q) =>
            q.eq('ownerId', args.ownerId as Id<'users'>).eq('scope', 'user')
          )
          .collect();

  const dup = candidates.find((c) => c._id !== args.excludeId && c.name.toLowerCase() === lower);
  if (dup) {
    throw new ConvexError({
      code: 'COMMAND_NAME_DUPLICATE',
      message: `A command named "${args.name}" already exists in this ${args.scope} scope.`,
    });
  }
}
