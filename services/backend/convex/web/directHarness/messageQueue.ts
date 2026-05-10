/**
 * Web-facing message queue endpoints.
 *
 * Exposes the pending queue so the frontend can show messages that are
 * waiting to be sent to the agent (i.e. sent while work was in flight).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getSessionWithAccess, requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { query } from '../../_generated/server.js';

// ─── subscribe ────────────────────────────────────────────────────────────────

export const subscribe = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    return ctx.db
      .query('chatroom_harnessMessageQueue')
      .withIndex('by_session_status', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).eq('status', 'queued')
      )
      .order('asc')
      .collect();
  },
});
