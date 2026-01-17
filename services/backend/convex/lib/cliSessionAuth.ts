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

import type { Id } from '../_generated/dataModel';
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
 * Returns true only if the user is the owner of the chatroom
 */
export async function checkChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>
): Promise<{ hasAccess: boolean; reason?: string }> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);

  if (!chatroom) {
    return { hasAccess: false, reason: 'Chatroom not found' };
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
  chatroomId: Id<'chatroom_rooms'>
): Promise<ValidatedSession> {
  // Validate session (tries CLI session, then web session)
  const sessionResult = await validateSession(ctx, sessionId);
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
    sessionType: sessionResult.sessionType,
  };
}

/**
 * Check if all agents in the chatroom are ready (idle or waiting, not active).
 * An agent is considered "active" if they are currently working on a task.
 * Returns true if no agents are active (all are idle/waiting).
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
 */
export async function getEntryPointRole(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<string | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom) {
    return null;
  }
  return chatroom.teamEntryPoint || chatroom.teamRoles?.[0] || null;
}
