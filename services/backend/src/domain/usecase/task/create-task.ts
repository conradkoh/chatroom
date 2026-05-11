/**
 * create-task usecase
 *
 * Single entry point for all task creation in a chatroom.
 * Encapsulates status determination (pending vs backlog)
 * and DB insertion.
 *
 * Callers:
 *   - messages.ts _sendMessageHandler (user message tasks, only for pending)
 *   - messages.ts _handoffHandler (handoff tasks)
 *   - tasks.ts createTask mutation (direct task creation)
 *   - promote-queued-message.ts (creates task at promotion time)
 *
 * Note: Queued messages (chatroom_messageQueue) no longer create tasks at send time.
 * Tasks for queued messages are created at promotion time in promote-queued-message.ts.
 *
 * Note: Agent restart for pending tasks is now handled by the daemon's task monitor
 * instead of a backend ensure-agent handler.
 */

import { adjustTaskCount } from './task-counts';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { ACTIVE_TASK_STATUSES, resolveTaskRole } from '../../entities/task';

export interface CreateTaskArgs {
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  /** If provided, forces this status instead of auto-detecting pending vs backlog */
  forceStatus?: 'pending';
  assignedTo?: string;
  sourceMessageId?: Id<'chatroom_messages'>;
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  queuePosition: number;
}

export interface CreateTaskResult {
  taskId: Id<'chatroom_tasks'>;
  status: 'pending';
}

/**
 * Returns true if the incoming user message should be staged in chatroom_messageQueue
 * (because an active task is already running), or false if it should be sent directly
 * to chatroom_messages with a new task created immediately.
 *
 * A chatroom is considered "busy" when any task is in one of these states:
 * - 'pending': task created but not yet claimed by an agent
 * - 'acknowledged': agent called get-next-task (pending → acknowledged); task is being
 *   processed — the agent will call task read imminently. This state MUST be included
 *   to prevent user messages from slipping through during the claim→start window.
 * - 'in_progress': agent called task read; actively working
 */
export async function shouldEnqueueMessage(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const tasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  return tasks.some((t) => ACTIVE_TASK_STATUSES.has(t.status));
}

/**
 * Creates a new task in the chatroom.
 * Status is auto-detected unless forceStatus is provided.
 */
export async function createTask(
  ctx: MutationCtx,
  args: CreateTaskArgs
): Promise<CreateTaskResult> {
  const now = Date.now();

  // Status is always pending for direct task creation
  const status: 'pending' = 'pending';

  const taskId = await ctx.db.insert('chatroom_tasks', {
    chatroomId: args.chatroomId,
    createdBy: args.createdBy,
    content: args.content,
    status,
    sourceMessageId: args.sourceMessageId,
    createdAt: now,
    updatedAt: now,
    queuePosition: args.queuePosition,
    assignedTo: args.assignedTo,
    ...(args.attachedTaskIds &&
      args.attachedTaskIds.length > 0 && {
        attachedTaskIds: args.attachedTaskIds,
      }),
  });

  // Update materialized task counts
  await adjustTaskCount(ctx, args.chatroomId, 'pending', 1);

  // Note: Agent restart for pending tasks is now handled by the daemon's task monitor.
  // No backend scheduling needed here.

  // Write task.activated event to stream
  const chatroom = args.assignedTo ? null : await ctx.db.get('chatroom_rooms', args.chatroomId);
  const role = resolveTaskRole(args.assignedTo, chatroom);
  await ctx.db.insert('chatroom_eventStream', {
    type: 'task.activated',
    chatroomId: args.chatroomId,
    taskId,
    role,
    taskStatus: 'pending',
    taskContent: args.content,
    timestamp: now,
  });

  return { taskId, status };
}
