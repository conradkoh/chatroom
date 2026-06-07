/**
 * Session-level auth helpers.
 *
 * Naming convention (matches the rest of the codebase):
 *   - `get…`     → returns `null` on miss (non-throwing, fail-open).
 *   - `require…` → throws `ConvexError NOT_AUTHENTICATED` on miss (fail-closed).
 *
 * Cost-aware variants:
 *   - `…AuthUserId` → 1× `sessions` read, 0× `users` reads.
 *                     Use this whenever the caller only needs `userId`
 *                     (ownership checks, indexed lookups, audit fields).
 *   - `…AuthUser`   → 1× `sessions` read + 1× `users` read.
 *                     Use only when the caller actually reads fields off
 *                     the user document (e.g. `name`, `accessLevel`).
 *
 * Forks that introduce additional session sources (CLI tokens, API keys,
 * machine-scoped sessions, etc.) should use {@link createAuthHelpers} with
 * an ordered list of {@link SessionResolver}s — see the JSDoc on that
 * function for a worked example.
 */

import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../convex/_generated/server';

// ─── Resolver extension point ────────────────────────────────────────────────

/**
 * A session resolver maps a `sessionId` to a `userId`, or returns `null` if
 * it does not recognize the session. Resolvers are tried in order and the
 * first non-null result wins.
 */
export type SessionResolver = (
  ctx: QueryCtx | MutationCtx,
  sessionId: SessionId
) => Promise<Id<'users'> | null>;

/** Default resolver — reads the upstream `sessions` table only. */
// fallow-ignore-next-line unused-export
export const defaultSessionResolver: SessionResolver = async (ctx, sessionId) => {
  const session = await ctx.db
    .query('sessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
  return session?.userId ?? null;
};

// ─── Helper factory ──────────────────────────────────────────────────────────

/**
 * Bundle of auth helpers bound to a specific list of session resolvers.
 *
 * Forks that need extra session types can build their own bundle:
 *
 * ```ts
 * // fork: services/backend/modules/auth/cli-session.ts
 * export const cliSessionResolver: SessionResolver = async (ctx, sessionId) => {
 *   const session = await ctx.db
 *     .query('cliSessions')
 *     .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
 *     .first();
 *   if (!session?.isActive) return null;
 *   if (session.expiresAt && Date.now() > session.expiresAt) return null;
 *   return session.userId;
 * };
 *
 * export const { getAuthUserId, requireAuthUserId, getAuthUser, requireAuthUser } =
 *   createAuthHelpers([cliSessionResolver, defaultSessionResolver]);
 * ```
 *
 * The upstream defaults exported below are equivalent to
 * `createAuthHelpers([defaultSessionResolver])`.
 */
export interface AuthHelpers {
  /** Resolve `sessionId → userId` in 1 DB read. Returns `null` on miss. */
  getAuthUserId(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Id<'users'> | null>;
  /** Resolve `sessionId → userId` in 1 DB read. Throws `NOT_AUTHENTICATED` on miss. */
  requireAuthUserId(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Id<'users'>>;
  /** Resolve `sessionId → user doc` in 2 DB reads. Returns `null` on miss. */
  getAuthUser(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Doc<'users'> | null>;
  /** Resolve `sessionId → user doc` in 2 DB reads. Throws `NOT_AUTHENTICATED` on miss. */
  requireAuthUser(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Doc<'users'>>;
}

function throwUnauthenticated(): never {
  throw new ConvexError({ code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
}

/**
 * Builds an {@link AuthHelpers} bundle bound to the given resolver chain.
 * Resolvers are tried in order; the first non-null `userId` wins.
 *
 * Pass `[defaultSessionResolver]` (the default) for upstream-only behavior.
 */
// fallow-ignore-next-line unused-export
export function createAuthHelpers(
  resolvers: readonly SessionResolver[] = [defaultSessionResolver]
): AuthHelpers {
  async function getAuthUserId(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Id<'users'> | null> {
    for (const resolve of resolvers) {
      const id = await resolve(ctx, args.sessionId);
      if (id) return id;
    }
    return null;
  }
  async function requireAuthUserId(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Id<'users'>> {
    const id = await getAuthUserId(ctx, args);
    if (!id) throwUnauthenticated();
    return id;
  }
  async function getAuthUser(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Doc<'users'> | null> {
    const id = await getAuthUserId(ctx, args);
    if (!id) return null;
    return ctx.db.get('users', id);
  }
  async function requireAuthUser(
    ctx: QueryCtx | MutationCtx,
    args: { sessionId: SessionId }
  ): Promise<Doc<'users'>> {
    const user = await getAuthUser(ctx, args);
    if (!user) throwUnauthenticated();
    return user;
  }
  return { getAuthUserId, requireAuthUserId, getAuthUser, requireAuthUser };
}

// ─── Default exports (upstream behavior) ─────────────────────────────────────

const _defaults = createAuthHelpers([defaultSessionResolver]);

/**
 * Resolve a `sessionId` to a `userId` in a single `sessions` read.
 * Returns `null` if the session does not exist or is unlinked from a user.
 *
 * Prefer this over {@link getAuthUser} whenever the caller only needs
 * `userId` (ownership checks, indexed lookups, audit fields) — most
 * authenticated endpoints fall into this category and the saved `users`
 * read adds up on hot paths.
 */
// fallow-ignore-next-line unused-export
export const getAuthUserId = _defaults.getAuthUserId;

/**
 * Like {@link getAuthUserId} but throws `ConvexError NOT_AUTHENTICATED`
 * when no `userId` can be resolved.
 */
// fallow-ignore-next-line unused-export
export const requireAuthUserId = _defaults.requireAuthUserId;

/**
 * Resolve a `sessionId` to the full user document (`sessions` + `users` read).
 * Returns `null` if the session or user is missing.
 *
 * Use only when the caller actually reads fields off the user document
 * (e.g. `name`, `accessLevel`). For ownership checks, prefer
 * {@link getAuthUserId}.
 */
export const getAuthUser = _defaults.getAuthUser;

/**
 * Like {@link getAuthUser} but throws `ConvexError NOT_AUTHENTICATED`
 * when no user can be resolved.
 */
// fallow-ignore-next-line unused-export
export const requireAuthUser = _defaults.requireAuthUser;
