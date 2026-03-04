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
  /** If provided, forces this status instead of auto-detecting pending vs backlog */
  forceStatus?: 'pending' | 'backlog';
  assignedTo?: string;
  sourceMessageId?: Id<'chatroom_messages'>;
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  queuePosition: number;
  origin?: 'chat' | 'backlog';
}

export interface CreateTaskResult {
  taskId: Id<'chatroom_tasks'>;
  status: 'pending' | 'backlog';
}

/**
 * Determines if a new task should be pending or queued.
 * Returns 'pending' if no active task exists, 'queued' to signal caller should enqueue message.
 */
export async function determineTaskStatus(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<'pending' | 'queued'> {
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

  // Determine status: pending or backlog (never queued — queue messages are separate)
  let status: 'pending' | 'backlog';
  if (args.forceStatus === 'backlog') {
    status = 'backlog';
  } else if (args.forceStatus === 'pending') {
    status = 'pending';
  } else {
    // Auto-detect: always pending for direct task creation (caller handles queuing via messageQueue)
    status = 'pending';
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
