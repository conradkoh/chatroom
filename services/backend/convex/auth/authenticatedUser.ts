/** Centralized authentication helper for resolving the current user from a session. */

import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { validateSession } from './cliSessionAuth';

/** Discriminated union for authentication results. */
export type AuthResult =
  | { ok: true; user: Doc<'users'>; userId: Id<'users'> }
  | { ok: false; reason: string };

/** Authenticated result (non-null user and userId). */
export type AuthenticatedResult = Extract<AuthResult, { ok: true }>;

/**
 * Resolve the authenticated user from a session ID.
 *
 * Validates the session via {@link validateSession}, then looks up the full
 * user document. Returns a discriminated union so callers can branch on
 * `isAuthenticated`.
 */
export async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<AuthResult> {
  const result = await validateSession(ctx, sessionId);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  const user = await ctx.db.get(result.userId);
  if (!user) {
    return { ok: false, reason: 'User not found' };
  }
  return { ok: true, user, userId: result.userId };
}

/**
 * Require an authenticated user from a session ID.
 *
 * Like {@link getAuthenticatedUser} but throws a ConvexError if the session
 * is invalid or the user is not found. Use this when authentication is
 * mandatory and you don't need to handle the unauthenticated case.
 */
export async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<AuthenticatedResult> {
  const auth = await getAuthenticatedUser(ctx, sessionId);
  if (!auth.ok) {
    throw new ConvexError('Not authenticated');
  }
  return auth;
}
