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
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { str } from '../../utils/types';

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
