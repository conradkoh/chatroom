/**
 * Back-compat shim for the original `modules/auth/getAuthUser.ts` surface.
 *
 * @deprecated Import from `./session` instead. This module preserves the
 *   original API (`getAuthUser` throws, `getAuthUserOptional` returns null)
 *   to avoid breaking downstream callers in one release.
 *
 *   Migration:
 *     `getAuthUser`         → `requireAuthUser` (same throwing semantics, clearer name)
 *     `getAuthUserOptional` → `getAuthUser`     (`get…` now returns null on miss)
 *
 *   Better still, switch to `getAuthUserId` / `requireAuthUserId` if the
 *   caller only needs `userId` — that avoids the extra `users` read
 *   altogether and is the most common case.
 *
 * @see docs/developer/auth-session-helpers.md for the full migration guide.
 */
// Intentional back-compat bridge kept for one deprecation release. Nothing in
// this repo imports it anymore (call sites moved to ./session), but downstream
// forks may still import these names, so the file is retained until the shim
// is deleted next release.
// fallow-ignore-file unused-file

import type { SessionId } from 'convex-helpers/server/sessions';

import { getAuthUser as getAuthUserNullable } from './session';
import type { Doc } from '../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../convex/_generated/server';

/**
 * @deprecated Use `requireAuthUser` from `./session` instead.
 * Throwing variant kept for backward compatibility.
 *
 * Intentional name collision with `./session::getAuthUser` for the
 * one-release deprecation window — see file-level @deprecated note.
 *
 * @see docs/developer/auth-session-helpers.md for the migration guide.
 */
export const getAuthUser = async (
  ctx: QueryCtx | MutationCtx,
  args: { sessionId: SessionId }
): Promise<Doc<'users'>> => {
  const session = await ctx.db
    .query('sessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
    .first();
  if (!session) {
    throw new Error('Session not found');
  }

  const user = await ctx.db.get('users', session.userId);

  if (!user) {
    throw new Error('User not found');
  }

  return user;
};

/**
 * @deprecated Use `getAuthUser` from `./session` instead — it now returns
 * `null` on miss with no need for the try/catch wrapper.
 *
 * @see docs/developer/auth-session-helpers.md for the migration guide.
 */
export const getAuthUserOptional = async (
  ctx: QueryCtx | MutationCtx,
  args: { sessionId: SessionId }
): Promise<Doc<'users'> | null> => {
  return getAuthUserNullable(ctx, args);
};
