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

import { transitionTask } from './transition-task';
import { fetchTaskSourceAttachments } from './fetch-task-source-attachments';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { loadCurrentContext } from '../context/load-current-context';

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
  };
  attachedBacklogItems?: {
    id: string;
    content: string;
    status: string;
  }[];
  attachedSnippets?: {
    reference: string;
    fileSource: string;
    selectedContent: string;
  }[];
  attachedTasks?: {
    _id: string;
    content: string;
    status: string;
  }[];
  attachedMessages?: {
    _id: string;
    content: string;
    senderRole: string;
    _creationTime: number;
  }[];
}

// ============================================================================
// USECASE
// ============================================================================

/**
 * Reads a task and transitions it from acknowledged → in_progress.
 *
 * This is the primary way to transition a task from acknowledged → in_progress.
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
export async function readTask(ctx: MutationCtx, args: ReadTaskArgs): Promise<ReadTaskResult> {
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

  // 3. Validate: task is assigned to role (case-insensitive — handoff may use different casing)
  if (task.assignedTo && task.assignedTo.toLowerCase() !== role.toLowerCase()) {
    throw new Error(`Task is assigned to ${task.assignedTo}, not ${role}`);
  }

  const now = Date.now();

  // 4. IDEMPOTENCY: If task is already in_progress, accept it
  //    This is a recovering agent picking up where a dead agent left off.
  //    Update assignedTo if needed, emit event, patch participant status.
  if (task.status === 'in_progress') {
    if (task.assignedTo && task.assignedTo.toLowerCase() !== role.toLowerCase()) {
      await ctx.db.patch('chatroom_tasks', taskId, {
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
    await transitionAgentStatus(ctx, chatroomId, role, 'task.inProgress');

    return buildReadTaskResult(ctx, chatroomId, task, taskId);
  }

  // 5. If status is not acknowledged → error
  if (task.status !== 'acknowledged') {
    throw new Error(`Task must be acknowledged to read (current status: ${task.status})`);
  }

  // 6. Transition: acknowledged → in_progress via FSM
  // Note: transitionTask now emits task.inProgress directly, so no duplicate needed here.
  await transitionTask(ctx, taskId, 'in_progress', 'readTask');

  // 7. Update participant status
  await transitionAgentStatus(ctx, chatroomId, role, 'task.inProgress');

  // 8–10. Fetch context/attachments and return
  return buildReadTaskResult(ctx, chatroomId, task, taskId);
}
// ============================================================================
// HELPERS
// ============================================================================

async function buildReadTaskResult(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  task: { content: string; sourceMessageId?: Id<'chatroom_messages'> },
  taskId: Id<'chatroom_tasks'>
): Promise<ReadTaskResult> {
  const context = await fetchCurrentContext(ctx, chatroomId);
  const attachments = await fetchTaskSourceAttachments(ctx, task);
  return {
    taskId,
    content: task.content,
    status: 'in_progress',
    ...(context && { context }),
    ...attachments,
  };
}

/**
 * Fetches the current pinned context for a chatroom, including the trigger
 * message content and time-based staleness (elapsed hours since creation).
 *
 * Staleness is purely time-based — no message-doc reads — so this is O(1)
 * regardless of chatroom message volume.
 */
async function fetchCurrentContext(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ReadTaskResult['context'] | null> {
  const snapshot = await loadCurrentContext(ctx, chatroomId);
  if (!snapshot) {
    return null;
  }

  // The shared loader covers chatroom + context + elapsedHours; we still
  // need the trigger message details that this caller surfaces, so fetch
  // the underlying context record once more to read `triggerMessageId`.
  const context = await ctx.db.get('chatroom_contexts', snapshot._id as Id<'chatroom_contexts'>);
  let triggerMessageContent: string | undefined;
  let triggerMessageSenderRole: string | undefined;
  if (context?.triggerMessageId) {
    const triggerMessage = await ctx.db.get('chatroom_messages', context.triggerMessageId);
    if (triggerMessage) {
      triggerMessageContent = triggerMessage.content;
      triggerMessageSenderRole = triggerMessage.senderRole;
    }
  }

  return {
    content: snapshot.content,
    triggerMessageContent,
    triggerMessageSenderRole,
    elapsedHours: snapshot.elapsedHours,
  };
}
