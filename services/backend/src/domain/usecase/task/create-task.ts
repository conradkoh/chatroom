/**
 * create-task usecase
 *
 * Single entry point for all task creation in a chatroom.
 * Encapsulates status determination (pending vs queued vs backlog)
 * and DB insertion.
 *
 * Callers:
 *   - messages.ts _sendMessageHandler (user message tasks)
 *   - messages.ts _handoffHandler (handoff tasks)
 *   - tasks.ts createTask mutation (direct task creation)
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export interface CreateTaskArgs {
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  /** If provided, forces this status instead of auto-detecting pending vs queued */
  forceStatus?: 'pending' | 'queued' | 'backlog';
  assignedTo?: string;
  sourceMessageId?: Id<'chatroom_messages'>;
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  queuePosition: number;
  origin?: 'chat' | 'backlog';
}

export interface CreateTaskResult {
  taskId: Id<'chatroom_tasks'>;
  status: 'pending' | 'queued' | 'backlog';
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

  // Determine status
  let status: 'pending' | 'queued' | 'backlog';
  if (args.forceStatus) {
    status = args.forceStatus;
  } else {
    // Check if any task is pending or in_progress
    const activeTask = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .first();
    const inProgressTask = !activeTask
      ? await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
          )
          .first()
      : null;
    status = activeTask || inProgressTask ? 'queued' : 'pending';
  }

  const taskId = await ctx.db.insert('chatroom_tasks', {
    chatroomId: args.chatroomId,
    createdBy: args.createdBy,
    content: args.content,
    status,
    origin: args.origin ?? 'chat',
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

  return { taskId, status };
}
