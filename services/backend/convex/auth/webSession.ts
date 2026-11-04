/**
 * Web-session authentication helpers.
 *
 * Files and storage settings are web-only. CLI sessions are user-scoped, not
 * chatroom-scoped, so an agent must never be able to read another chatroom's
 * bytes or settings through them.
 *
 * - `requireWebSession` — fail-closed: throws when the session is not a web session.
 * - `requireWebCaller`  — validates the session, then requires the web app.
 */

import { ConvexError } from 'convex/values';

import { validateSession } from './sessionValidation';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * Rejects non-web sessions before any chatroom or ownership check.
 *
 * CLI sessions are user-scoped, not chatroom-scoped, so an agent must never be
 * able to read another chatroom's bytes or settings through them.
 */
export function requireWebSession(access: { session: { sessionType: string } }): void {
  if (access.session.sessionType !== 'web') {
    throw new ConvexError({
      code: 'WEB_SESSION_REQUIRED',
      message: 'Files can only be read or managed from the web app.',
    });
  }
}

/** Validates the session and requires the web app as the caller. */
export async function requireWebCaller(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<{ userId: Id<'users'>; sessionId: string }> {
  const session = await validateSession(ctx, sessionId);
  if (!session.ok) {
    throw new ConvexError({
      code: 'AUTH_FAILED',
      message: `Authentication failed: ${session.reason}`,
    });
  }
  requireWebSession({ session });
  return { userId: session.userId, sessionId: session.sessionId };
}
