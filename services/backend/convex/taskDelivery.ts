// fallow-ignore-file code-duplication
/**
 * Daemon-owned task-delivery signal feed.
 *
 * Cursor-based, bounded, per-chatroom, and content-free: the reactive query
 * returns only routing/status metadata and callers hydrate task content
 * imperatively from `chatroom_machineAssignedTaskSnapshots`.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query, mutation } from './_generated/server';
import { getMachineOwner, requireMachineOwner } from './auth/cli/machineAccess';
import { machineTaskDeliverySignalScopeValidator } from '../src/domain/entities/machine-task-delivery-signal';
import { ackMachineTaskDeliverySignals } from '../src/domain/usecase/agent/ack-machine-task-delivery-signals';
import { listTasksForMachineSignalRange } from '../src/domain/usecase/machine/list-tasks-for-machine-signal-range';

const DEFAULT_TASK_DELIVERY_SIGNALS_LIMIT = 100;
const MAX_TASK_DELIVERY_SIGNALS_LIMIT = 500;
const MAX_TASK_DELIVERY_HYDRATION_LIMIT = 500;

/**
 * Reactive cursor-pinned subscription: daemon task-delivery signals for one
 * machine and chatroom strictly after `afterKey`. Returns null when idle to
 * suppress subscription bandwidth.
 *
 * Scoped per chatroom (not machine-wide) so task transitions in one room do
 * not invalidate other rooms' subscriptions on the same machine.
 */
export const subscribeTaskDeliverySignalsSince = query({
  args: {
    ...SessionIdArg,
    ...machineTaskDeliverySignalScopeValidator,
    afterKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) return null;

    const limit = Math.min(
      Math.max(args.limit ?? DEFAULT_TASK_DELIVERY_SIGNALS_LIMIT, 1),
      MAX_TASK_DELIVERY_SIGNALS_LIMIT
    );
    const page = await ctx.db
      .query('chatroom_machineTaskDeliverySignals')
      .withIndex('by_machineId_chatroomId_signalKey', (q) =>
        q
          .eq('machineId', args.machineId)
          .eq('chatroomId', args.chatroomId)
          .gt('signalKey', args.afterKey)
      )
      .order('asc')
      .take(limit + 1);

    const hasMore = page.length > limit;
    const rows = page.slice(0, limit);
    const items = rows.map((row) => ({
      chatroomId: row.chatroomId,
      taskId: row.taskId,
      targetRole: row.targetRole,
      taskStatus: row.taskStatus,
      signalKey: row.signalKey,
      taskUpdatedAt: row.taskUpdatedAt,
    }));
    const lastItem = items.at(-1);
    if (!lastItem) return null;
    return { items, highKey: lastItem.signalKey, hasMore };
  },
});

/**
 * Imperative hydration for a task-delivery signal-key range.
 *
 * Reads only the new delivery signal table plus existing assigned-task
 * snapshots; task content is never returned by the signal query itself.
 */
export const listTasksForMachineTaskDeliverySignalRange = query({
  args: {
    ...SessionIdArg,
    ...machineTaskDeliverySignalScopeValidator,
    afterSignalKey: v.string(),
    throughSignalKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) return { snapshots: [], nextSignalKey: null, hasMore: false };

    const limit = Math.min(
      Math.max(args.limit ?? MAX_TASK_DELIVERY_HYDRATION_LIMIT, 1),
      MAX_TASK_DELIVERY_HYDRATION_LIMIT
    );

    return listTasksForMachineSignalRange(ctx, {
      machineId: args.machineId,
      chatroomId: String(args.chatroomId),
      userId: auth.userId,
      afterSignalKey: args.afterSignalKey,
      throughSignalKey: args.throughSignalKey,
      limit,
      signalTable: 'chatroom_machineTaskDeliverySignals',
    });
  },
});

/** Bounded acknowledgement/cleanup for daemon task-delivery signals. */
export const ackTaskDeliverySignals = mutation({
  args: {
    ...SessionIdArg,
    ...machineTaskDeliverySignalScopeValidator,
    throughSignalKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return ackMachineTaskDeliverySignals(ctx, {
      machineId: args.machineId,
      chatroomId: args.chatroomId,
      throughSignalKey: args.throughSignalKey,
    });
  },
});
