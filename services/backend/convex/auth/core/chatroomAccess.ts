/**
 * Chatroom-scoped authentication and authorization helpers.
 *
 * Use these when an endpoint requires the caller to have access to a specific chatroom.
 *
 * ## Naming convention
 * - `requireChatroomAccess` — fail-closed: throws ConvexError if session or chatroom access fails.
 * - `getChatroomAccess`     — fail-open: returns null if auth fails.
 */

import { ConvexError } from 'convex/values';

import { validateSession, type ValidatedSession } from './sessionValidation';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';

/** Authenticated chatroom access result containing session and chatroom document. */
export interface AuthenticatedChatroomAccess {
  session: ValidatedSession;
  chatroom: Doc<'chatroom_rooms'>;
}

/** Checks if a user has access to a chatroom and returns the chatroom document. */
async function checkChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>
): Promise<{ ok: true; chatroom: Doc<'chatroom_rooms'> } | { ok: false; reason: string }> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);

  if (!chatroom) {
    return { ok: false, reason: 'Chatroom not found' };
  }

  if (chatroom.ownerId !== userId) {
    return { ok: false, reason: 'Access denied: You do not own this chatroom' };
  }

  return { ok: true, chatroom };
}

/** Validates session and chatroom access, returning both session info and chatroom document. */
export async function requireChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>
): Promise<AuthenticatedChatroomAccess> {
  // Validate session (tries CLI session, then web session)
  const sessionResult = await validateSession(ctx, sessionId);
  if (!sessionResult.ok) {
    throw new ConvexError({
      code: 'AUTH_FAILED',
      message: `Authentication failed: ${sessionResult.reason}`,
    });
  }

  // Check chatroom access - now returns the chatroom document
  const accessResult = await checkChatroomAccess(ctx, chatroomId, sessionResult.userId);
  if (!accessResult.ok) {
    throw new ConvexError({
      code: 'ACCESS_DENIED',
      message: accessResult.reason,
    });
  }

  return {
    session: {
      sessionId: sessionResult.sessionId,
      userId: sessionResult.userId,
      userName: sessionResult.userName,
      sessionType: sessionResult.sessionType,
      user: sessionResult.user,
    },
    chatroom: accessResult.chatroom,
  };
}

/**
 * Like requireChatroomAccess but returns null instead of throwing when auth fails.
 * Use for optional-auth queries that return empty results for unauthenticated users.
 */
export async function getChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ userId: Id<'users'>; chatroom: Doc<'chatroom_rooms'> } | null> {
  try {
    const result = await requireChatroomAccess(ctx, sessionId, chatroomId);
    return { userId: result.session.userId, chatroom: result.chatroom };
  } catch {
    return null;
  }
}
