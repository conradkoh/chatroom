import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { WorkspaceAgentConfigInboxStatus } from '../../src/domain/entities/chatroom-workspace-agent-config-inbox';
import { mutation, query } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';

export const listPending = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return await ctx.db
      .query('chatroomWorkspaceAgentConfigInbox')
      .withIndex('by_machine_status_createdAt', (q) =>
        q.eq('machineId', args.machineId).eq('status', WorkspaceAgentConfigInboxStatus.Pending)
      )
      .order('asc')
      .collect();
  },
});

export const listLatest = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const rows = await ctx.db
      .query('chatroomWorkspaceAgentConfigInbox')
      .withIndex('by_machine_status_createdAt', (q) =>
        q.eq('machineId', args.machineId).eq('status', WorkspaceAgentConfigInboxStatus.Processed)
      )
      .order('desc')
      .collect();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.chatroomId}:${row.role.toLowerCase()}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return [...latest.values()];
  },
});

export const markProcessed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    eventId: v.id('chatroomWorkspaceAgentConfigInbox'),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const event = await ctx.db.get('chatroomWorkspaceAgentConfigInbox', args.eventId);
    if (!event || event.machineId !== args.machineId) return { processed: false };
    if (event.status === WorkspaceAgentConfigInboxStatus.Processed) return { processed: false };
    await ctx.db.patch('chatroomWorkspaceAgentConfigInbox', args.eventId, {
      status: WorkspaceAgentConfigInboxStatus.Processed,
      processedAt: Date.now(),
    });
    return { processed: true };
  },
});
