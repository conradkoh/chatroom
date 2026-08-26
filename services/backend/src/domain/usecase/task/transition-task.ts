/**
 * transitionTask usecase
 *
 * This module is the public API for transitioning task state.
 * It wraps the underlying FSM transition and, after terminal transitions,
 * automatically attempts to promote the next queued task via the
 * promote-next-task usecase.
 *
 * ## Design
 *
 * The usecase exposes the same function signature as the FSM layer so
 * all existing callers remain unchanged. Internally it:
 *
 *   1. Delegates the FSM transition to `lib/taskStateMachine.transitionTask`
 *   2. After transitions to `completed`, calls `promoteNextTask`
 *      using deps wired from the Convex mutation context
 *
 * ## Callers
 *
 * All callers should import from this module:
 *   import { transitionTask } from '../src/domain/usecase/task/transition-task'
 *
 * The FSM rules, type definitions, and helper functions remain in
 * lib/taskStateMachine.ts as the authoritative implementation.
 *
 * Note: Agent restart for active tasks is now handled by the daemon's task monitor
 * instead of a backend ensure-agent handler.
 */

import { maybePromoteNextQueuedTask } from './maybe-promote-next-queued-task';
import { adjustTaskCountsForTransition } from './task-counts';
import { writeTimelineTaskStatusSignal } from './write-timeline-task-status-signal';
import { syncMessageReadModel } from '../message/message-read-model';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { Task, TaskStatus } from '../../../../convex/lib/taskStateMachine';
import { transitionTask as fsmTransitionTask } from '../../../../convex/lib/taskStateMachine';
import { TERMINAL_TASK_STATUSES } from '../../entities/task';
import { projectAssignedTaskSnapshotsAfterTaskChange } from '../machine/machine-assigned-task-snapshot-sync';
import { requestEphemeralAgentRelease } from '../agent/request-ephemeral-agent-release';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for controlling side effects during a task transition.
 */
export interface TransitionTaskOptions {
  /**
   * When true, skips the participant status update
   * and skips updating the participant's lastStatus via transitionAgentStatus.
   *
   * Use this when the task is being externally force-completed (e.g. from the UI)
   * and the actual agent process may still be running. Emitting status events in
   * this case would mislead the UI — the agent will update its own status naturally
   * when it calls get-next-task again or when it crashes and exits.
   */
  skipAgentStatusUpdate?: boolean;

  /**
   * When true, skips automatic queue promotion after terminal transitions.
   *
   * Use this when the caller manages promotion explicitly (e.g. the handoff
   * handler has its own promotion logic in Step 6). Without this flag,
   * transitionTask would auto-promote queued messages immediately after
   * completing a task, which can conflict with the caller's own promotion
   * or task creation logic.
   */
  skipAutoPromotion?: boolean;
}

// ============================================================================
// USECASE
// ============================================================================

/**
 * Transitions a task to a new status via the FSM and, for terminal
 * transitions, automatically promotes the next queued task if all
 * agents are waiting.
 *
 * Exposes the same signature as the underlying FSM function so all
 * callers can use this as a drop-in replacement.
 *
 * @param ctx - Convex mutation context (used to wire `promoteNextTask` deps)
 * @param taskId - The task to transition
 * @param newStatus - The desired target status
 * @param trigger - FSM trigger label (must match a valid transition rule)
 * @param overrides - Optional field overrides applied after transition
 * @param options - Optional behavior flags (e.g. skipAgentStatusUpdate)
 */
export async function transitionTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  newStatus: TaskStatus,
  trigger: string,
  overrides?: Partial<Task>,
  options?: TransitionTaskOptions
): Promise<void> {
  // 0. Read old status before transition for counter adjustment
  const taskBeforeTransition = await ctx.db.get('chatroom_tasks', taskId);
  const oldStatus = taskBeforeTransition?.status;

  // 1. Delegate the FSM transition (validates rules, applies patches, logs)
  await fsmTransitionTask(ctx, taskId, newStatus, trigger, overrides);
  await projectAssignedTaskSnapshotsAfterTaskChange(ctx, taskId);

  // 1a. Write timeline task-status signal for live cursor subscription
  const transitionedTask = await ctx.db.get('chatroom_tasks', taskId);
  if (transitionedTask) {
    await writeTimelineTaskStatusSignal(ctx, transitionedTask);
    if (transitionedTask.sourceMessageId)
      await syncMessageReadModel(ctx, transitionedTask.sourceMessageId);
    const linked = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
      .collect();
    for (const message of linked) await syncMessageReadModel(ctx, message._id);
  }

  // 1b. Update materialized task counts
  if (taskBeforeTransition && oldStatus) {
    await adjustTaskCountsForTransition(ctx, taskBeforeTransition.chatroomId, oldStatus, newStatus);
  }

  // Task row and timeline signals above are authoritative; no audit duplicate is written.

  // 3. After terminal transitions, attempt to promote the next queued task.
  //    We re-fetch the task to get its chatroomId (the transition has already
  //    committed, so the status is now `newStatus`).
  //    Skip when caller manages promotion explicitly (e.g. handoff handler).
  if (TERMINAL_TASK_STATUSES.has(newStatus) && !options?.skipAutoPromotion) {
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (task) {
      await requestEphemeralAgentRelease(ctx, task);
      await maybePromoteNextQueuedTask(ctx, task.chatroomId);
    }
  }

  // Note: Agent restart for active tasks is now handled by the daemon's task monitor.
  // No backend scheduling needed here.
}

// Re-export the TaskStatus type so callers only need one import path
export type { TaskStatus } from '../../../../convex/lib/taskStateMachine';
