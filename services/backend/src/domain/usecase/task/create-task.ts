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

import { internal } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { ENSURE_AGENT_FALLBACK_DELAY_MS } from '../../../../config/reliability';
import { getTeamEntryPoint } from '../../entities/team';

export interface CreateTaskArgs {
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  /** If provided, forces this status instead of auto-detecting pending vs queued */
  forceStatus?: 'pending' | 'queued' | 'backlog';
  assignedTo?: string;
  sourceMessageId?: Id<'chatroom_messages'>;
  // NEW: alternative to sourceMessageId for queued messages
  queuedMessageId?: Id<'chatroom_messageQueue'>;
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  queuePosition: number;
  origin?: 'chat' | 'backlog';
}

export interface CreateTaskResult {
  taskId: Id<'chatroom_tasks'>;
  status: 'pending' | 'queued' | 'backlog';
}

/**
 * Determines the task status (pending vs queued) without creating the task.
 * Callers can use this to decide where to write the source message before creating the task.
 */
export async function determineTaskStatus(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  forceStatus?: 'pending' | 'queued' | 'backlog'
): Promise<'pending' | 'queued' | 'backlog'> {
  if (forceStatus) return forceStatus;

  const activeTask = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) =>
      q.eq('chatroomId', chatroomId).eq('status', 'pending')
    )
    .first();
  const inProgressTask = !activeTask
    ? await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'in_progress')
        )
        .first()
    : null;
  return activeTask || inProgressTask ? 'queued' : 'pending';
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

  // Determine status using the extracted helper
  const status = await determineTaskStatus(ctx, args.chatroomId, args.forceStatus);

  const taskId = await ctx.db.insert('chatroom_tasks', {
    chatroomId: args.chatroomId,
    createdBy: args.createdBy,
    content: args.content,
    status,
    origin: args.origin ?? 'chat',
    sourceMessageId: args.sourceMessageId,
    queuedMessageId: args.queuedMessageId,
    createdAt: now,
    updatedAt: now,
    queuePosition: args.queuePosition,
    assignedTo: args.assignedTo,
    ...(args.attachedTaskIds &&
      args.attachedTaskIds.length > 0 && {
        attachedTaskIds: args.attachedTaskIds,
      }),
  });

  // Schedule ensure-agent check for pending tasks
  if (status === 'pending') {
    await ctx.scheduler.runAfter(ENSURE_AGENT_FALLBACK_DELAY_MS, internal.ensureAgentHandler.check, {
      taskId,
      chatroomId: args.chatroomId,
      snapshotUpdatedAt: now,
    });

    // Write task.activated event to stream
    let role = args.assignedTo;
    if (!role) {
      const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
      role = getTeamEntryPoint(chatroom ?? {}) ?? 'unknown';
    }
    await ctx.db.insert('chatroom_eventStream', {
      type: 'task.activated',
      chatroomId: args.chatroomId,
      taskId,
      role,
      taskStatus: 'pending',
      taskContent: args.content,
      timestamp: now,
    });
  }

  return { taskId, status };
}
