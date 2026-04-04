/** Session authentication helpers for validating CLI and web sessions and checking chatroom access. */

import { ConvexError } from 'convex/values';

import { isActiveParticipant } from '../../src/domain/entities/participant';
import { getTeamEntryPoint } from '../../src/domain/entities/team';
import {
  validateSession as validateSessionPure,
  type ValidateSessionDeps,
} from '../../src/domain/usecase/auth/validate-session';
import {
  checkChatroomAccess as checkChatroomAccessPure,
  type ChatroomAccessDeps,
} from '../../src/domain/usecase/auth/chatroom-access';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export interface ValidatedSession {
  sessionId: string;
  userId: Id<'users'>;
  userName?: string;
  sessionType: 'cli' | 'web';
}

export interface ValidationError {
  valid: false;
  reason: string;
}

export type SessionValidationResult = ({ valid: true } & ValidatedSession) | ValidationError;

/** Authenticated chatroom access result containing session and chatroom document. */
export interface AuthenticatedChatroomAccess {
  session: ValidatedSession;
  chatroom: Doc<'chatroom_rooms'>;
}

/** Builds ValidateSessionDeps from Convex DB context. */
function buildValidateSessionDeps(ctx: QueryCtx | MutationCtx): ValidateSessionDeps {
  return {
    queryCliSession: async (sessionId: string) => {
      const session = await ctx.db
        .query('cliSessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .unique();
      if (!session) return null;
      return {
        userId: session.userId as string,
        isActive: session.isActive,
        expiresAt: session.expiresAt,
      };
    },
    queryWebSession: async (sessionId: string) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .unique();
      if (!session) return null;
      return { userId: session.userId as string };
    },
    getUser: async (userId: string) => {
      const user = await ctx.db.get('users', userId as Id<'users'>);
      if (!user) return null;
      return { id: user._id as string, name: user.name };
    },
  };
}

/** Validates a session, trying CLI session first then web session. */
export async function validateSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionValidationResult> {
  const deps = buildValidateSessionDeps(ctx);
  const result = await validateSessionPure(deps, sessionId);
  if (!result.valid) {
    return result;
  }
  return {
    ...result,
    userId: result.userId as Id<'users'>,
  };
}

/** Checks if a user has access to a chatroom and returns the chatroom document. */
export async function checkChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>
): Promise<
  { hasAccess: true; chatroom: Doc<'chatroom_rooms'> } | { hasAccess: false; reason: string }
> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);

  const deps: ChatroomAccessDeps = {
    getChatroom: async (id: string) => {
      const doc = await ctx.db.get('chatroom_rooms', id as Id<'chatroom_rooms'>);
      if (!doc) return null;
      return { id: doc._id as string, ownerId: doc.ownerId as string };
    },
  };

  const result = await checkChatroomAccessPure(deps, chatroomId as string, userId as string);

  if (!result.hasAccess) {
    return { hasAccess: false, reason: result.reason };
  }

  // Return the full chatroom doc for backward compatibility
  return { hasAccess: true, chatroom: chatroom! };
}

/** Validates session and chatroom access, returning both session info and chatroom document. */
export async function requireChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>
): Promise<AuthenticatedChatroomAccess> {
  // Validate session (tries CLI session, then web session)
  const sessionResult = await validateSession(ctx, sessionId);
  if (!sessionResult.valid) {
    throw new ConvexError({
      code: 'AUTH_FAILED',
      message: `Authentication failed: ${sessionResult.reason}`,
    });
  }

  // Check chatroom access - now returns the chatroom document
  const accessResult = await checkChatroomAccess(ctx, chatroomId, sessionResult.userId);
  if (!accessResult.hasAccess) {
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
    },
    chatroom: accessResult.chatroom,
  };
}

/** Returns true if all active participants in the chatroom are in the get-next-task wait loop. */
export async function areAllAgentsWaiting(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const activeParticipants = participants.filter(isActiveParticipant);
  if (activeParticipants.length === 0) return false;

  return activeParticipants.every((p) => p.lastSeenAction === 'get-next-task:started');
}

/** Returns the entry point role for a chatroom. */
export function getEntryPointRole(chatroom: Doc<'chatroom_rooms'>): string | null {
  return getTeamEntryPoint(chatroom);
}

/** Atomically retrieves and increments the next queue position for a chatroom. */
export async function getAndIncrementQueuePosition(
  ctx: MutationCtx,
  chatroom: Doc<'chatroom_rooms'>
): Promise<number> {
  const currentPosition = chatroom.nextQueuePosition;

  if (currentPosition === undefined) {
    // Migration path: initialize from max existing task position
    // Use by_chatroom_queue index with desc order to find the highest position efficiently
    const lastTask = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroom._id))
      .order('desc')
      .first();
    const maxPosition = lastTask ? lastTask.queuePosition : 0;
    const nextPosition = maxPosition + 1;

    // Initialize the counter (next task will get nextPosition + 1)
    await ctx.db.patch('chatroom_rooms', chatroom._id, { nextQueuePosition: nextPosition + 1 });

    return nextPosition;
  }

  // Atomic increment: get current value and increment for next use
  await ctx.db.patch('chatroom_rooms', chatroom._id, { nextQueuePosition: currentPosition + 1 });

  return currentPosition;
}
