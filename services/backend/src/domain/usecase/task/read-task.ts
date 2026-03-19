/**
 * read-task usecase
 *
 * Business logic for reading a task and transitioning it from
 * acknowledged → in_progress.
 *
 * This usecase encapsulates:
 *   1. Task retrieval and validation
 *   2. Idempotent handling of already-in_progress tasks
 *   3. FSM transition via transitionTask
 *   4. Event emission to chatroom_eventStream
 *   5. Participant status update
 *
 * ## Callers
 *
 *   - tasks.ts readTask mutation (primary caller)
 *
 * ## Design
 *
 * The usecase follows the clean architecture pattern used by transition-task.ts
 * and create-task.ts: domain logic lives here, while Convex mutations are thin
 * wrappers that handle auth and delegate to the usecase.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionTask } from './transition-task';
import { patchParticipantStatus } from '../../entities/participant';

// ============================================================================
// TYPES
// ============================================================================

export interface ReadTaskArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
}

export interface ReadTaskResult {
  taskId: Id<'chatroom_tasks'>;
  content: string;
  status: 'in_progress';
  context?: {
    content: string;
    triggerMessageContent?: string;
    triggerMessageSenderRole?: string;
    elapsedHours: number;
    messagesSinceContext: number;
  };
}

// ============================================================================
// USECASE
// ============================================================================

/**
 * Reads a task and transitions it from acknowledged → in_progress.
 *
 * This is the primary way to transition a task from acknowledged → in_progress,
 * replacing the legacy task-started CLI command.
 *
 * Idempotency: If the task is already in_progress, this function accepts it —
 * this handles recovery scenarios where a new agent process picks up where a
 * dead agent left off. The task status remains in_progress, assignedTo is
 * updated if needed, and the inProgress event is emitted for UI consistency.
 *
 * @param ctx - Convex mutation context
 * @param args - Task identification (chatroomId, role, taskId)
 * @returns Task ID, content, and status
 * @throws Error if task not found, wrong chatroom, or wrong assignment
 */
export async function readTask(
  ctx: MutationCtx,
  args: ReadTaskArgs
): Promise<ReadTaskResult> {
  const { chatroomId, role, taskId } = args;

  // 1. Fetch the task by ID
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  // 2. Validate: task belongs to chatroomId
  if (task.chatroomId !== chatroomId) {
    throw new Error('Task does not belong to this chatroom');
  }

  // 3. Validate: task is assigned to role
  if (task.assignedTo !== role) {
    throw new Error(`Task is assigned to ${task.assignedTo}, not ${role}`);
  }

  const now = Date.now();

  // 4. IDEMPOTENCY: If task is already in_progress, accept it
  //    This is a recovering agent picking up where a dead agent left off.
  //    Update assignedTo if needed, emit event, patch participant status.
  if (task.status === 'in_progress') {
    if (task.assignedTo !== role) {
      await ctx.db.patch(taskId, {
        assignedTo: role,
        updatedAt: now,
      });
    }
    await ctx.db.insert('chatroom_eventStream', {
      type: 'task.inProgress',
      chatroomId,
      role,
      taskId,
      timestamp: now,
    });
    await patchParticipantStatus(ctx, chatroomId, role, 'task.inProgress');

    const context = await fetchCurrentContext(ctx, chatroomId);
    return { taskId, content: task.content, status: 'in_progress', ...(context && { context }) };
  }

  // 5. If status is not acknowledged → error
  if (task.status !== 'acknowledged') {
    throw new Error(
      `Task must be acknowledged to read (current status: ${task.status})`
    );
  }

  // 6. Transition: acknowledged → in_progress via FSM
  await transitionTask(ctx, taskId, 'in_progress', 'readTask');

  // 7. Emit task.inProgress event to chatroom_eventStream
  await ctx.db.insert('chatroom_eventStream', {
    type: 'task.inProgress',
    chatroomId,
    role,
    taskId,
    timestamp: now,
  });

  // 8. Update participant status
  await patchParticipantStatus(ctx, chatroomId, role, 'task.inProgress');

  // 9. Fetch current context for inclusion in result
  const context = await fetchCurrentContext(ctx, chatroomId);

  // 10. Return result
  return { taskId, content: task.content, status: 'in_progress', ...(context && { context }) };
}
// ============================================================================
// HELPERS
// ============================================================================

/**
 * Fetches the current pinned context for a chatroom, including
 * trigger message content and staleness metrics.
 *
 * Uses chatroom.messageCount (atomic counter) when available to avoid
 * expensive .collect() calls on large chatrooms.
 */
async function fetchCurrentContext(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ReadTaskResult['context'] | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.currentContextId) {
    return null;
  }

  const context = await ctx.db.get('chatroom_contexts', chatroom.currentContextId);
  if (!context) {
    return null;
  }

  // Compute staleness: time elapsed since context creation
  const elapsedMs = Date.now() - context.createdAt;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  // Compute messages since context creation
  // Use message count from DB query (same approach as taskDelivery.ts)
  const allMessages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const currentMessageCount = allMessages.length;
  const messagesSinceContext = currentMessageCount - (context.messageCountAtCreation ?? 0);

  // Fetch trigger message if available
  let triggerMessageContent: string | undefined;
  let triggerMessageSenderRole: string | undefined;
  if (context.triggerMessageId) {
    const triggerMessage = await ctx.db.get('chatroom_messages', context.triggerMessageId);
    if (triggerMessage) {
      triggerMessageContent = triggerMessage.content;
      triggerMessageSenderRole = triggerMessage.senderRole;
    }
  }

  return {
    content: context.content,
    triggerMessageContent,
    triggerMessageSenderRole,
    elapsedHours,
    messagesSinceContext,
  };
}
