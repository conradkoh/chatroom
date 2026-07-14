import { ConvexError } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { validateSession } from './auth/sessionValidation';
import { effectiveSavedCommandScope } from './savedCommandValidation';

type SavedCommandDoc = Doc<'chatroom_savedCommands'>;

export async function requireSavedCommandAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  command: SavedCommandDoc
): Promise<{ userId: string }> {
  const scope = effectiveSavedCommandScope(command);

  if (scope === 'user') {
    const sessionResult = await validateSession(ctx, sessionId);
    if (!sessionResult.ok) {
      throw new ConvexError({
        code: 'AUTH_FAILED',
        message: `Authentication failed: ${sessionResult.reason}`,
      });
    }
    if (command.ownerId !== sessionResult.userId) {
      throw new ConvexError({
        code: 'ACCESS_DENIED',
        message: 'You can only modify your own user-scoped commands.',
      });
    }
    return { userId: sessionResult.userId };
  }

  if (!command.chatroomId) {
    throw new ConvexError({
      code: 'SAVED_COMMAND_INVALID',
      message: 'Chatroom-scoped command is missing chatroomId.',
    });
  }
  const { session } = await requireChatroomAccess(ctx, sessionId, command.chatroomId);
  return { userId: session.userId };
}
