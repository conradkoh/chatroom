/**
 * Session-level authentication helpers.
 *
 * Resolve a sessionId → userId in a single table read (CLI or web session),
 * with NO users-doc read. Most authenticated endpoints only need `userId`
 * for ownership checks / indexed lookups. Endpoints that need fields off the
 * user document should read it explicitly (see `convex/auth.ts` getState).
 *
 * - `requireSession` — fail-closed: throws ConvexError NOT_AUTHENTICATED.
 * - `getSession`     — fail-open: returns null on miss.
 */
import type { SessionId } from 'convex-helpers/server/sessions';

import { getAuthUserId, requireAuthUserId } from '../../../modules/auth/cli-session';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';

/** The result of a successful session auth check. */
export type SessionAuth = {
  userId: Id<'users'>;
};

export async function requireSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionAuth> {
  const userId = await requireAuthUserId(ctx, { sessionId: sessionId as SessionId });
  return { userId };
}

export async function getSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionAuth | null> {
  const userId = await getAuthUserId(ctx, { sessionId: sessionId as SessionId });
  return userId ? { userId } : null;
}
