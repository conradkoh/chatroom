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
 */
// fallow-ignore-file duplicate-export
// (Intentional name collision with `./session::getAuthUser` for the
//  one-release deprecation window. Removed when the shim is deleted.)

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
 */
// fallow-ignore-next-line unused-export
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
 */
export const getAuthUserOptional = async (
  ctx: QueryCtx | MutationCtx,
  args: { sessionId: SessionId }
): Promise<Doc<'users'> | null> => {
  return getAuthUserNullable(ctx, args);
};
