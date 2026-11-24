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
 *   4. Return the updated task
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

import { fetchTaskSourceAttachments } from './fetch-task-source-attachments';
import { transitionTask } from './transition-task';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeMarkdownContent } from '../../entities/markdown-content';

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
  attachedBacklogItems?:
    | {
        id: string;
        content: string;
        status: string;
      }[]
    | undefined;
  attachedSnippets?:
    | {
        reference: string;
        fileSource: string;
        selectedContent: string;
      }[]
    | undefined;
  attachedTasks?:
    | {
        _id: string;
        content: string;
        status: string;
      }[]
    | undefined;
  attachedMessages?:
    | {
        _id: string;
        content: string;
        senderRole: string;
        _creationTime: number;
      }[]
    | undefined;
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
 * @throws Error if task not found, wrong chatroom, wrong assignment, or a terminal state
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

  // 4. IDEMPOTENCY: If task is already in_progress, accept it — the reader is
  //    the owner recovering or re-reading; no transition needed.
  if (task.status === 'in_progress') {
    return buildReadTaskResult(ctx, task, taskId);
  }

  // 5. Pending and acknowledged tasks start on read (owner verified above);
  //    the daemon owns state consistency, so the backend applies the read
  //    intent instead of gating on status.
  await transitionTask(ctx, taskId, 'in_progress', 'readTask');

  // 7–9. Fetch attachments and return
  return buildReadTaskResult(ctx, task, taskId);
}
// ============================================================================
// HELPERS
// ============================================================================

async function buildReadTaskResult(
  ctx: MutationCtx,
  task: { content: string; sourceMessageId?: Id<'chatroom_messages'> | undefined },
  taskId: Id<'chatroom_tasks'>
): Promise<ReadTaskResult> {
  const attachments = await fetchTaskSourceAttachments(ctx, task);
  return {
    taskId,
    content: normalizeMarkdownContent(task.content),
    status: 'in_progress',
    ...attachments,
  };
}
