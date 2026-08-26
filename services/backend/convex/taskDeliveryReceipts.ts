import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { recordTaskDelivery } from '../src/domain/usecase/task/record-task-delivery';

export const record = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    taskId: v.id('chatroom_tasks'),
    role: v.string(),
    deliveryKind: v.union(
      v.literal('native_inject'),
      v.literal('enhancer_claim'),
      v.literal('cli_get_next_task')
    ),
    harnessSessionId: v.optional(v.string()),
    jobId: v.optional(v.id('chatroom_enhancerJobs')),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const receiptId = await recordTaskDelivery(ctx, {
      chatroomId: args.chatroomId,
      taskId: args.taskId,
      role: args.role,
      deliveryKind: args.deliveryKind,
      harnessSessionId: args.harnessSessionId,
      jobId: args.jobId,
      startedAt: args.startedAt,
    });
    return { receiptId };
  },
});
