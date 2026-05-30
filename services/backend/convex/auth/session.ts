/**
 * Session-level authentication helpers.
 *
 * These are the base building blocks for all resource-scoped auth helpers.
 * Use these when you only need to verify the caller is authenticated, without
 * checking ownership of a specific resource (machine, chatroom, workspace).
 *
 * ## Naming convention
 * - `requireSession` — fail-closed: throws ConvexError NOT_AUTHENTICATED if invalid.
 * - `getSession`     — fail-open: returns null if invalid.
 */

import { ConvexError } from 'convex/values';

import { validateSession } from './cliSessionAuth';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/** The result of a successful session auth check. */
export type SessionAuth = {
  userId: Id<'users'>;
  user: Doc<'users'>;
};

/**
 * Require a valid authenticated session.
 * Throws ConvexError NOT_AUTHENTICATED if the session is invalid or the user is not found.
 * Use for endpoints where authentication is mandatory.
 */
export async function requireSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionAuth> {
  const auth = await getSession(ctx, sessionId);
  if (!auth) {
    throw new ConvexError({ code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
  }
  return auth;
}

/**
 * Get authenticated session, returning null if invalid.
 * Use for fail-open endpoints that return empty results for unauthenticated callers.
 */
export async function getSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionAuth | null> {
  const result = await validateSession(ctx, sessionId);
  if (!result.ok) {
    return null;
  }
  const user = await ctx.db.get('users', result.userId);
  if (!user) {
    return null;
  }
  return { userId: result.userId, user };
}
