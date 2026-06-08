/**
 * Fork extension: CLI-session-aware auth helpers.
 *
 * Composes upstream's resolver chain (`modules/auth/session.ts`) with a
 * resolver for this fork's `cliSessions` table, so authenticated endpoints
 * resolve `sessionId → userId` in a SINGLE table read and accept BOTH CLI
 * tokens and web sessions (CLI first, then web).
 *
 * The bundle exposes only the cost-aware userId resolvers — see
 * `modules/auth/session.ts` for `getAuthUser` / `requireAuthUser` if a
 * caller legitimately needs the user document.
 *
 * @see docs/developer/auth-session-helpers.md
 */

import { createAuthHelpers, defaultSessionResolver, type SessionResolver } from './session';

/** Resolves a fork CLI session (`cliSessions`) to a userId, honoring isActive + expiry. */
// fallow-ignore-next-line complexity
const cliSessionResolver: SessionResolver = async (ctx, sessionId) => {
  const session = await ctx.db
    .query('cliSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
  if (!session?.isActive) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) return null;
  return session.userId;
};

const cliAware = createAuthHelpers([cliSessionResolver, defaultSessionResolver]);

/** Resolve sessionId → userId in 1 read (CLI or web). Returns null on miss. */
export const getAuthUserId = cliAware.getAuthUserId;
/** Resolve sessionId → userId in 1 read (CLI or web). Throws NOT_AUTHENTICATED on miss. */
export const requireAuthUserId = cliAware.requireAuthUserId;
