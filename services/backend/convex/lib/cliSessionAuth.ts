/**
 * CLI Session Authentication Helper
 *
 * Provides utilities for validating CLI sessions and checking chatroom access.
 * Used by chatroom-related mutations and queries to enforce security.
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx, MutationCtx } from '../_generated/server';

export interface ValidatedSession {
  sessionId: string;
  userId: Id<'users'>;
  userName?: string;
}

export interface ValidationError {
  valid: false;
  reason: string;
}

export type SessionValidationResult = ({ valid: true } & ValidatedSession) | ValidationError;

/**
 * Validate a CLI session and return user information
 */
export async function validateCliSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await ctx.db
    .query('cliSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .unique();

  if (!session) {
    return { valid: false, reason: 'Session not found' };
  }

  if (!session.isActive) {
    return { valid: false, reason: 'Session revoked' };
  }

  if (session.expiresAt && Date.now() > session.expiresAt) {
    return { valid: false, reason: 'Session expired' };
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
  };
}

/**
 * Check if a user has access to a chatroom
 * Returns true if:
 * - The chatroom has no owner (legacy chatroom)
 * - The user is the owner of the chatroom
 */
export async function checkChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatrooms'>,
  userId: Id<'users'>
): Promise<{ hasAccess: boolean; reason?: string }> {
  const chatroom = await ctx.db.get('chatrooms', chatroomId);

  if (!chatroom) {
    return { hasAccess: false, reason: 'Chatroom not found' };
  }

  // Legacy chatrooms without owner are accessible to all authenticated users
  if (!chatroom.ownerId) {
    return { hasAccess: true };
  }

  // Check if user is the owner
  if (chatroom.ownerId === userId) {
    return { hasAccess: true };
  }

  return { hasAccess: false, reason: 'Access denied: You do not own this chatroom' };
}

/**
 * Combined helper: Validate session and check chatroom access
 * Throws an error if validation or access check fails
 */
export async function requireChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  chatroomId: Id<'chatrooms'>
): Promise<ValidatedSession> {
  // Validate session
  const sessionResult = await validateCliSession(ctx, sessionId);
  if (!sessionResult.valid) {
    throw new Error(`Authentication failed: ${sessionResult.reason}`);
  }

  // Check chatroom access
  const accessResult = await checkChatroomAccess(ctx, chatroomId, sessionResult.userId);
  if (!accessResult.hasAccess) {
    throw new Error(accessResult.reason || 'Access denied');
  }

  return {
    sessionId: sessionResult.sessionId,
    userId: sessionResult.userId,
    userName: sessionResult.userName,
  };
}
