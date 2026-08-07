import { ConvexError } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';

/**
 * E2E-only seeding mutation — dev tooling, not a real feature.
 *
 * Promotes the user bound to the given session to `system_admin` so e2e
 * specs can exercise the admin UI. It is gated by the deployment environment
 * variable `E2E_SEEDING_ENABLED` (must be `"true"`), which is only ever set on
 * local/dev deployments — never on production.
 *
 * When the gate is off (the safe default), the mutation throws FORBIDDEN.
 */
export const promoteSessionToSystemAdmin = mutation({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    if (process.env.E2E_SEEDING_ENABLED !== 'true') {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message:
          'E2E seeding is disabled. Run: cd services/backend && npx convex env set E2E_SEEDING_ENABLED true',
      });
    }

    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .first();

    if (!session?.userId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Session has no user' });
    }

    await ctx.db.patch('users', session.userId, {
      accessLevel: 'system_admin',
      roleNames: undefined,
    });

    return { success: true as const };
  },
});
