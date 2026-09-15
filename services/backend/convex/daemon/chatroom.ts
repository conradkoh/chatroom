/**
 * Server-centric snapshot of every model that decides whether a chatroom task
 * reaches its agent.
 *
 * `chatroom debug` merges this with the daemon's local state so a reader can
 * tell which side of the boundary a value came from. Every entry under `models`
 * is keyed by table name, so the dump states which model was queried.
 *
 * The statuses here are independent and are deliberately not collapsed:
 *
 * - `chatroom_tasks.status` — `pending → acknowledged → in_progress → completed`,
 *   advanced by the **agent** via `claimTask` / `startTask` / `completeTask`.
 * - `chatroomWorkspaceTaskInbox.status` — `pending → processed`, advanced by the
 *   **daemon** when it takes a notification off its own queue.
 *
 * A processed notification next to a pending task is therefore the "notified but
 * silently dropped" signature, not a contradiction. `chatroom_taskDeliveryReceipts`
 * is what distinguishes "never delivered" from "delivered but never started"
 * (`deliveredAt` set, `startedAt` unset).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { requireChatroomAccess } from '../auth/chatroomAccess';
import { requireMachineOwner } from '../auth/cli/machineAccess';

const DEFAULT_ROW_LIMIT = 10;
const MAX_ROW_LIMIT = 50;
const CONTENT_PREVIEW_CHARS = 160;

/** Always returned in full — a stuck task must never be truncated out of the dump. */
const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;

/** Bounded per-model snapshot counts, kept small so the dump stays readable. */
type ModelSnapshot<T> = {
  /** Total rows that exist for this model in scope, before `rows` was truncated. */
  count: number;
  rows: T[];
};

function bounded<T>(count: number, rows: T[], limit: number): ModelSnapshot<T> {
  return { count, rows: rows.slice(0, limit) };
}

/** Task content can be large; keep a preview and be explicit that it was trimmed. */
function toTaskRow(task: Doc<'chatroom_tasks'>) {
  const { content, ...rest } = task;
  return {
    ...rest,
    contentPreview:
      content.length > CONTENT_PREVIEW_CHARS
        ? `${content.slice(0, CONTENT_PREVIEW_CHARS)}…`
        : content,
    contentLength: content.length,
  };
}

export const debug = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const limit = Math.min(args.limit ?? DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT);

    const [activeTasksByStatus, recentCompletedTasks, launchRequests, desiredConfigs] =
      await Promise.all([
        Promise.all(
          ACTIVE_TASK_STATUSES.map((status) =>
            ctx.db
              .query('chatroom_tasks')
              .withIndex('by_chatroom_status', (q) =>
                q.eq('chatroomId', args.chatroomId).eq('status', status)
              )
              .collect()
          )
        ),
        ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('status', 'completed')
          )
          .order('desc')
          .take(limit),
        ctx.db
          .query('chatroom_agentLastSentLaunchRequests')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
          .collect(),
        ctx.db
          .query('chatroom_agentDesiredConfigs')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
          .collect(),
      ]);

    const activeTasks = activeTasksByStatus
      .flat()
      .sort((a, b) => a.queuePosition - b.queuePosition);

    // Notification events and delivery receipts are looked up per task rather
    // than per chatroom, so the snapshot stays bounded by the tasks above and
    // every row here correlates with a task row above.
    const taskIds = [...activeTasks, ...recentCompletedTasks].map((task) => task._id);
    const [inboxEventsByTask, receiptsByTask] = await Promise.all([
      Promise.all(
        taskIds.map((taskId) =>
          ctx.db
            .query('chatroomWorkspaceTaskInbox')
            .withIndex('by_chatroom_taskId', (q) =>
              q.eq('chatroomId', args.chatroomId).eq('taskId', taskId)
            )
            .collect()
        )
      ),
      Promise.all(
        taskIds.map((taskId) =>
          ctx.db
            .query('chatroom_taskDeliveryReceipts')
            .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
            .collect()
        )
      ),
    ]);

    // Inbox events are reported for every machine, not just the calling one:
    // "no event for my machine" is itself the answer when a task was routed
    // elsewhere, and each row carries its own machineId.
    const inboxEvents = inboxEventsByTask.flat().sort((a, b) => b.createdAt - a.createdAt);
    const receipts = receiptsByTask.flat().sort((a, b) => b.deliveredAt - a.deliveredAt);

    const [pendingCommands, processingCommands] = await Promise.all([
      ctx.db
        .query('chatroom_machineCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', args.machineId).eq('status', 'pending')
        )
        .collect(),
      ctx.db
        .query('chatroom_machineCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', args.machineId).eq('status', 'processing')
        )
        .collect(),
    ]);
    const machineCommands = [...pendingCommands, ...processingCommands]
      .filter((row) => 'chatroomId' in row.command && row.command.chatroomId === args.chatroomId)
      .sort((a, b) => a.createdAt - b.createdAt);

    const taskRows = [...activeTasks, ...recentCompletedTasks].map(toTaskRow);

    return {
      queriedAt: Date.now(),
      machineId: args.machineId,
      chatroomId: args.chatroomId,
      models: {
        chatroom_tasks: {
          count: taskRows.length,
          /** Active tasks are never limited; `rows` continues with recent completions. */
          activeCount: activeTasks.length,
          rows: taskRows,
        },
        chatroomWorkspaceTaskInbox: bounded(inboxEvents.length, inboxEvents, limit),
        chatroom_taskDeliveryReceipts: bounded(receipts.length, receipts, limit),
        chatroom_agentLastSentLaunchRequests: bounded(
          launchRequests.length,
          [...launchRequests].sort((a, b) => b.requestedAt - a.requestedAt),
          limit
        ),
        chatroom_agentDesiredConfigs: bounded(
          desiredConfigs.length,
          [...desiredConfigs].sort((a, b) => a.role.localeCompare(b.role)),
          limit
        ),
        chatroom_machineCommandInbox: bounded(machineCommands.length, machineCommands, limit),
      },
    };
  },
});
