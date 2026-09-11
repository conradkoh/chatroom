import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireMachineOwner } from './auth/cli/machineAccess';
import {
  requestChatroomWorkspaceAgentStop,
  requestWorkspaceAgentStop,
} from '../src/domain/usecase/agent/request-chatroom-workspace-agent-stop';

export const requestStopAll = mutation({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms') },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return requestChatroomWorkspaceAgentStop(ctx, { chatroomId: args.chatroomId });
  },
});

export const requestStopAgent = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return requestWorkspaceAgentStop(ctx, args);
  },
});

export const listPending = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return ctx.db
      .query('chatroomWorkspaceAgentCommandsInbox')
      .withIndex('by_machine_status_createdAt', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .order('asc')
      .collect();
  },
});

export const watchNext = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const row = await ctx.db
      .query('chatroomWorkspaceAgentCommandsInbox')
      .withIndex('by_machine_status_createdAt', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .order('asc')
      .first();
    return row?._id ?? null;
  },
});

export const claimNext = mutation({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const row = await ctx.db
      .query('chatroomWorkspaceAgentCommandsInbox')
      .withIndex('by_machine_status_createdAt', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .order('asc')
      .first();
    if (!row) return null;
    await ctx.db.patch('chatroomWorkspaceAgentCommandsInbox', row._id, {
      status: 'processing',
      processingAt: Date.now(),
    });
    return { ...row, status: 'processing' as const, processingAt: Date.now() };
  },
});
