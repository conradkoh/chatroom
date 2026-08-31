import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';
import { enqueueCapabilitiesRefresh } from '../../machines';

/** Request capability discovery through the machine command inbox. */
export const refreshCapabilities = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);
    return enqueueCapabilitiesRefresh(ctx, {
      userId: session.userId,
      chatroomId: workspace.chatroomId,
      machineId: workspace.machineId,
    });
  },
});
