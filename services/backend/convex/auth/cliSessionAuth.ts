/**
 * Session authentication helpers for validating CLI and web sessions.
 *
 * Non-auth chatroom utilities (areAllAgentsWaiting, getEntryPointRole, getAndIncrementQueuePosition)
 * live here for historical reasons.
 *
 * Chatroom access checks have been moved to ./chatroomAccess.ts.
 */

import { isActiveParticipant } from '../../src/domain/entities/participant';
import { getTeamEntryPoint } from '../../src/domain/entities/team';
import {
  checkSession as checkSessionPure,
  type CheckSessionDeps,
} from '../../src/domain/usecase/auth/extensions/validate-session';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { str } from '../utils/types';

/** Convert a Convex Id to a plain string for the pure-function layer. */

export interface ValidatedSession {
  sessionId: string;
  userId: Id<'users'>;
  userName?: string;
  sessionType: 'cli' | 'web';
}

export interface ValidationError {
  ok: false;
  reason: string;
}

export type SessionValidationResult = ({ ok: true } & ValidatedSession) | ValidationError;

/** Builds CheckSessionDeps from Convex DB context. */
function buildCheckSessionDeps(ctx: QueryCtx | MutationCtx): CheckSessionDeps {
  return {
    queryCliSession: async (sessionId: string) => {
      const session = await ctx.db
        .query('cliSessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .unique();
      if (!session) return null;
      return {
        userId: str(session.userId),
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
      return { userId: str(session.userId) };
    },
    getUser: async (userId: string) => {
      const user = await ctx.db.get('users', userId as Id<'users'>);
      if (!user) return null;
      return { id: str(user._id), name: user.name };
    },
  };
}

/** Validates a session, trying CLI session first then web session. */
export async function validateSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionValidationResult> {
  const deps = buildCheckSessionDeps(ctx);
  const result = await checkSessionPure(deps, sessionId);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return {
    ok: true,
    sessionId: result.sessionId,
    userId: result.userId as Id<'users'>,
    userName: result.userName,
    sessionType: result.sessionType,
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
