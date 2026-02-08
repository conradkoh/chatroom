/**
 * Session Authentication Helper
 *
 * Provides utilities for validating sessions and checking chatroom access.
 * Used by chatroom-related mutations and queries to enforce security.
 *
 * Supports both session types:
 * - CLI sessions: stored in `cliSessions` table (from ~/.chatroom/auth.jsonc)
 * - Web sessions: stored in `sessions` table (from convex-helpers SessionProvider)
 *
 * The validation tries CLI sessions first, then falls back to web sessions.
 */

import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export interface ValidatedSession {
  sessionId: string;
  userId: Id<'users'>;
  userName?: string;
  sessionType: 'cli' | 'web';
}

/**
 * Result of requireChatroomAccess - includes both session info and chatroom document.
 * This eliminates the need to re-fetch the chatroom after authentication.
 */
export interface AuthenticatedChatroomAccess {
  session: ValidatedSession;
  chatroom: Doc<'chatroom_rooms'>;
}

export interface ValidationError {
  valid: false;
  reason: string;
}

export type SessionValidationResult = ({ valid: true } & ValidatedSession) | ValidationError;

/**
 * Validate a CLI session and return user information
 */
async function validateCliSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await ctx.db
    .query('cliSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .unique();

  if (!session) {
    return { valid: false, reason: 'CLI session not found' };
  }

  if (!session.isActive) {
    return { valid: false, reason: 'CLI session revoked' };
  }

  if (session.expiresAt && Date.now() > session.expiresAt) {
    return { valid: false, reason: 'CLI session expired' };
  }

  // Get user info
  const user = await ctx.db.get('users', session.userId);
  if (!user) {
    return { valid: false, reason: 'User not found' };
  }

  return {
    valid: true,
    sessionId,
    userId: session.userId,
    userName: user.name,
    sessionType: 'cli',
  };
}

/**
 * Validate a web session and return user information
 */
async function validateWebSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await ctx.db
    .query('sessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .unique();

  if (!session) {
    return { valid: false, reason: 'Web session not found' };
  }

  // Get user info
  const user = await ctx.db.get('users', session.userId);
  if (!user) {
    return { valid: false, reason: 'User not found' };
  }

  return {
    valid: true,
    sessionId,
    userId: session.userId,
    userName: user.name,
    sessionType: 'web',
  };
}

/**
 * Validate a session (tries CLI session first, then web session)
 */
export async function validateSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionValidationResult> {
  // Try CLI session first
  const cliResult = await validateCliSession(ctx, sessionId);
  if (cliResult.valid) {
    return cliResult;
  }

  // Fall back to web session
  const webResult = await validateWebSession(ctx, sessionId);
  if (webResult.valid) {
    return webResult;
  }

  // Both failed - return a combined error
  return { valid: false, reason: 'Session not found or invalid' };
}

/**
 * Check if a user has access to a chatroom
 * Returns the chatroom document if access is granted
 */
export async function checkChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>
): Promise<
  { hasAccess: true; chatroom: Doc<'chatroom_rooms'> } | { hasAccess: false; reason: string }
> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);

  if (!chatroom) {
    return { hasAccess: false, reason: 'Chatroom not found' };
  }

  // Check if user is the owner
  if (chatroom.ownerId === userId) {
    return { hasAccess: true, chatroom };
  }

  return { hasAccess: false, reason: 'Access denied: You do not own this chatroom' };
}

/**
 * Combined helper: Validate session and check chatroom access
 * Throws an error if validation or access check fails
 * Returns both the session info and chatroom document to avoid re-fetching
 */
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

/**
 * Check if all agents in the chatroom are ready (waiting, not active).
 * An agent is considered "active" if they are currently working on a task.
 * Returns true if no agents are active (all are waiting).
 */
export async function areAllAgentsReady(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  // Check if any participant is active (working on a task)
  const hasActiveParticipant = participants.some((p) => p.status === 'active');

  return !hasActiveParticipant;
}

/**
 * Get the entry point role for a chatroom.
 * The entry point is the primary agent that receives user messages and queue promotions.
 *
 * @param chatroom - The chatroom document (to avoid re-fetching)
 */
export function getEntryPointRole(chatroom: Doc<'chatroom_rooms'>): string | null {
  return chatroom.teamEntryPoint || chatroom.teamRoles?.[0] || null;
}

/**
 * Get and atomically increment the next queue position for a chatroom.
 * This prevents race conditions when multiple tasks are created concurrently.
 *
 * For new chatrooms without nextQueuePosition, we initialize from the current max
 * task queue position to ensure backward compatibility.
 *
 * @param ctx - Mutation context (must be mutation for atomic update)
 * @param chatroom - The chatroom document
 * @returns The next queue position to use for a new task
 */
export async function getAndIncrementQueuePosition(
  ctx: MutationCtx,
  chatroom: Doc<'chatroom_rooms'>
): Promise<number> {
  const currentPosition = chatroom.nextQueuePosition;

  if (currentPosition === undefined) {
    // Migration path: initialize from max existing task position
    const allTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
      .collect();
    const maxPosition = allTasks.reduce((max, t) => Math.max(max, t.queuePosition), 0);
    const nextPosition = maxPosition + 1;

    // Initialize the counter (next task will get nextPosition + 1)
    await ctx.db.patch('chatroom_rooms', chatroom._id, { nextQueuePosition: nextPosition + 1 });

    return nextPosition;
  }

  // Atomic increment: get current value and increment for next use
  await ctx.db.patch('chatroom_rooms', chatroom._id, { nextQueuePosition: currentPosition + 1 });

  return currentPosition;
}
