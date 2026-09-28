import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import {
  findOpenDeliveryReceipt,
  markDeliveryReceiptStarted,
  recordTaskDelivery,
} from '../src/domain/usecase/task/record-task-delivery';

export const record = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    taskId: v.id('chatroom_tasks'),
    role: v.string(),
    deliveryKind: v.union(v.literal('native_inject'), v.literal('cli_get_next_task')),
    harnessSessionId: v.optional(v.string()),
    // @deprecated Legacy enhancer job linkage (job table deleted); kept
    // optional as a plain string so historical rows still validate.
    jobId: v.optional(v.string()),
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

/**
 * Marks an open delivery receipt as started (the receiving agent began
 * processing the delivered task). Idempotent no-op when no open receipt
 * exists — the daemon's task service drives this after turn-start evidence.
 */
export const markStarted = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    taskId: v.id('chatroom_tasks'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const receipt = await findOpenDeliveryReceipt(ctx, args.chatroomId, args.role, args.taskId);
    if (!receipt) return { marked: false };
    await markDeliveryReceiptStarted(ctx, receipt._id);
    return { marked: true };
  },
});
