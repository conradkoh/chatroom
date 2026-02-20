/**
 * Agent Desired State — Convex query for daemon to read desired state.
 *
 * The upsert logic lives in the domain layer (see src/domain/usecase/agent/upsert-desired-state.ts)
 * since it's called from other use cases that already have a MutationCtx.
 *
 * This file exposes a public query for the CLI daemon to validate start commands.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';

/**
 * Get the current desired state for a chatroom+role.
 *
 * Used by the daemon (via CLI query) to validate start commands before processing.
 * Returns null if no desired state exists or session is invalid.
 */
export const getDesiredState = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await validateSession(ctx, args.sessionId);
    if (!result.valid) {
      return null;
    }

    return await ctx.db
      .query('chatroom_agentDesiredState')
      .withIndex('by_chatroom_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .first();
  },
});
