/**
 * Raw session validation — the internal implementation layer.
 *
 * Validates sessions against both CLI and web session tables.
 * Used internally by session.ts and chatroomAccess.ts — not intended
 * for direct use in endpoint handlers (use the higher-level helpers instead).
 */

import {
  checkSession as checkSessionPure,
  type CheckSessionDeps,
} from '../../../src/domain/usecase/auth/extensions/validate-session';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { str } from '../../utils/types';

export interface ValidatedSession {
  sessionId: string;
  userId: Id<'users'>;
  userName?: string;
  sessionType: 'cli' | 'web';
  /**
   * The full user document loaded during validation.
   *
   * Validation already reads the user doc (to confirm existence and resolve the
   * name), so we surface it here to let callers (e.g. getSession) reuse it
   * instead of issuing a second identical `ctx.db.get('users', ...)`.
   */
  user: Doc<'users'>;
}

export interface ValidationError {
  ok: false;
  reason: string;
}

export type SessionValidationResult = ({ ok: true } & ValidatedSession) | ValidationError;

/** Mutable holder used to capture the full user doc read inside the deps closure. */
interface UserDocHolder {
  current: Doc<'users'> | null;
}

/** Builds CheckSessionDeps from Convex DB context, capturing the loaded user doc. */
function buildCheckSessionDeps(
  ctx: QueryCtx | MutationCtx,
  userHolder: UserDocHolder
): CheckSessionDeps {
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
      // Stash the full doc so validateSession can return it without a re-read.
      userHolder.current = user;
      return { id: str(user._id), name: user.name };
    },
  };
}

/** Validates a session, trying CLI session first then web session. */
export async function validateSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<SessionValidationResult> {
  const userHolder: UserDocHolder = { current: null };
  const deps = buildCheckSessionDeps(ctx, userHolder);
  const result = await checkSessionPure(deps, sessionId);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  // On success, checkSession only returns ok after getUser resolved a user,
  // so the holder is guaranteed populated. Guard defensively for type safety.
  if (!userHolder.current) {
    return { ok: false, reason: 'User not found' };
  }
  return {
    ok: true,
    sessionId: result.sessionId,
    userId: result.userId as Id<'users'>,
    userName: result.userName,
    sessionType: result.sessionType,
    user: userHolder.current,
  };
}
