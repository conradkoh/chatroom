import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { omitUndefined } from './lib/omitUndefined';
import {
  WorkspaceTaskInboxEventStatus,
  type WorkspaceTaskInboxTaskHeader,
} from '../src/domain/entities/chatroom-workspace-task-inbox';

/**
 * Header-only view of an inbox row for the delivery path. Drops deprecated top-level agent
 * config and every legacy task snapshot field, so pre-slim rows also travel slim on the wire.
 * Heavy task content is loaded from `chatroom_tasks` by the daemon's one-shot loaders.
 */
function toPendingInboxEventView(row: Doc<'chatroomWorkspaceTaskInbox'>) {
  const { task } = row;
  const header: WorkspaceTaskInboxTaskHeader = omitUndefined({
    taskId: task.taskId,
    chatroomId: task.chatroomId,
    status: task.status,
    assignedTo: task.assignedTo,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startInNewSession: task.startInNewSession,
  });
  return omitUndefined({
    _id: row._id,
    machineId: row.machineId,
    chatroomId: row.chatroomId,
    taskId: row.taskId,
    role: row.role,
    assignee: row.assignee,
    eventType: row.eventType,
    status: row.status,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
    task: header,
  });
}

export const listPending = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const rows = await ctx.db
      .query('chatroomWorkspaceTaskInbox')
      .withIndex('by_machine_status_createdAt', (q) =>
        q.eq('machineId', args.machineId).eq('status', WorkspaceTaskInboxEventStatus.Pending)
      )
      .order('asc')
      .collect();
    return rows.map(toPendingInboxEventView);
  },
});

/**
 * Diagnostic history of this machine's task inbox events for one chatroom is
 * served by `daemon:chatroom.debug`, which reports this model alongside the
 * other models a stuck task touches. `listPending` stays the only inbox read on
 * the delivery path so acknowledged work can never replay.
 */
export const markProcessed = mutation({
  args: { ...SessionIdArg, machineId: v.string(), eventId: v.id('chatroomWorkspaceTaskInbox') },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const event = await ctx.db.get('chatroomWorkspaceTaskInbox', args.eventId);
    if (!event || event.machineId !== args.machineId) return { processed: false };
    if (event.status === WorkspaceTaskInboxEventStatus.Processed) return { processed: false };
    await ctx.db.patch('chatroomWorkspaceTaskInbox', args.eventId, {
      status: WorkspaceTaskInboxEventStatus.Processed,
      processedAt: Date.now(),
    });
    return { processed: true };
  },
});
