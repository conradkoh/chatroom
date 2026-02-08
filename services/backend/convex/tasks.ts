import { v } from 'convex/values';

import { internalMutation, mutation, query } from './_generated/server';
import {
  areAllAgentsReady,
  getAndIncrementQueuePosition,
  requireChatroomAccess,
  validateSession,
} from './auth/cliSessionAuth';
import { recoverOrphanedTasks } from './lib/taskRecovery';
import { transitionTask } from './lib/taskStateMachine';

/**
 * Maximum number of active tasks per chatroom.
 * Active = pending + in_progress + queued + backlog (excludes completed/closed)
 */
const MAX_ACTIVE_TASKS = 100;

/**
 * Maximum number of tasks to return in list queries.
 * This is a server-side limit to prevent excessive data transfer.
 */
const MAX_TASK_LIST_LIMIT = 100;

/**
 * Create a new task in a chatroom.
 * If isBacklog is true, creates a backlog task.
 * Otherwise, creates as pending if no pending/in_progress exists, else queued.
 * Enforces 100 active task limit.
 * Requires CLI session authentication and chatroom access.
 */
export const createTask = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    createdBy: v.string(),
    isBacklog: v.optional(v.boolean()),
    sourceMessageId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access - need chatroom for queue position
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check active task limit
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.and(q.neq(q.field('status'), 'completed'), q.neq(q.field('status'), 'closed'))
      )
      .collect();

    if (activeTasks.length >= MAX_ACTIVE_TASKS) {
      throw new Error(
        `Task limit reached (${MAX_ACTIVE_TASKS}). Complete or cancel existing tasks before adding more.`
      );
    }

    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    const now = Date.now();

    // Determine status
    let status: 'pending' | 'queued' | 'backlog';
    if (args.isBacklog) {
      status = 'backlog';
    } else {
      // Check if any task is pending or in_progress
      const hasPendingOrInProgress = activeTasks.some(
        (t) => t.status === 'pending' || t.status === 'in_progress'
      );
      status = hasPendingOrInProgress ? 'queued' : 'pending';
    }

    // Set origin field based on whether this is a backlog task
    const origin = args.isBacklog ? ('backlog' as const) : ('chat' as const);

    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy: args.createdBy,
      content: args.content,
      status,
      origin,
      sourceMessageId: args.sourceMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition,
    });

    return { taskId, status, queuePosition, origin };
  },
});

/**
 * Claim a pending task (acknowledge it without starting work yet).
 * Transitions: pending → acknowledged
 * This is called by wait-for-task to reserve a task for an agent.
 * Requires CLI session authentication and chatroom access.
 */
export const claimTask = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Find the pending task
    const pendingTask = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .first();

    if (!pendingTask) {
      throw new Error('No pending task to claim');
    }

    const now = Date.now();

    // Transition: pending → acknowledged using FSM
    await transitionTask(ctx, pendingTask._id, 'acknowledged', 'claimTask', {
      assignedTo: args.role,
    });

    // Set acknowledgedAt on the source message (if not already set)
    if (pendingTask.sourceMessageId) {
      const sourceMessage = await ctx.db.get('chatroom_messages', pendingTask.sourceMessageId);
      if (sourceMessage && !sourceMessage.acknowledgedAt) {
        await ctx.db.patch('chatroom_messages', pendingTask.sourceMessageId, {
          acknowledgedAt: now,
        });
      }
    }

    return { taskId: pendingTask._id, content: pendingTask.content };
  },
});

/**
 * Start working on an acknowledged task.
 * Transitions: acknowledged → in_progress
 * This is called when agent begins actual work (sends task-started message).
 * Requires CLI session authentication and chatroom access.
 */
export const startTask = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.optional(v.id('chatroom_tasks')), // Optional: specific task to start
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    let acknowledgedTask;

    if (args.taskId) {
      // Start a specific task (used by task-started command)
      acknowledgedTask = await ctx.db.get('chatroom_tasks', args.taskId);

      if (!acknowledgedTask) {
        throw new Error(`Task ${args.taskId} not found`);
      }

      if (acknowledgedTask.chatroomId !== args.chatroomId) {
        throw new Error('Task does not belong to this chatroom');
      }

      if (acknowledgedTask.status !== 'acknowledged') {
        throw new Error(
          `Task must be acknowledged to start (current status: ${acknowledgedTask.status})`
        );
      }

      if (acknowledgedTask.assignedTo !== args.role) {
        throw new Error(`Task is assigned to ${acknowledgedTask.assignedTo}, not ${args.role}`);
      }
    } else {
      // Find any acknowledged task for this role (legacy behavior)
      acknowledgedTask = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
        )
        .filter((q) => q.eq(q.field('assignedTo'), args.role))
        .first();

      if (!acknowledgedTask) {
        throw new Error('No acknowledged task to start for this role');
      }
    }

    // Transition: acknowledged → in_progress using FSM

    await transitionTask(ctx, acknowledgedTask._id, 'in_progress', 'startTask');

    return { taskId: acknowledgedTask._id, content: acknowledgedTask.content };
  },
});

/**
 * Complete ALL in_progress tasks in the chatroom.
 * For backlog-origin tasks: transitions to pending_user_review (user must confirm).
 * For chat-origin tasks: transitions to completed directly.
 * Promotes the next queued task to pending when all agents are ready.
 * Requires CLI session authentication and chatroom access.
 */
export const completeTask = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Find ALL in_progress tasks (there should typically be only one, but complete all for resilience)
    const inProgressTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
      )
      .collect();

    if (inProgressTasks.length === 0) {
      // No tasks to complete - this is okay, just return
      return { completed: false, completedCount: 0, promoted: null, pendingReview: [] };
    }

    const pendingReview: string[] = [];

    // Load FSM once for all transitions

    // Complete ALL in_progress tasks based on their origin
    for (const task of inProgressTasks) {
      // Determine the new status based on origin:
      // - backlog-origin tasks → pending_user_review (user must confirm completion)
      // - chat-origin tasks → completed
      const newStatus: 'pending_user_review' | 'completed' =
        task.origin === 'backlog' ? 'pending_user_review' : 'completed';

      // Use FSM for transition
      await transitionTask(ctx, task._id, newStatus, 'completeTask');

      if (newStatus === 'pending_user_review') {
        pendingReview.push(task._id);
      }
    }

    // Log if multiple tasks were completed (indicates a stuck state that was cleaned up)
    if (inProgressTasks.length > 1) {
      console.warn(
        `[Task Cleanup] Processed ${inProgressTasks.length} in_progress tasks in chatroom ${args.chatroomId}. ` +
          `Task IDs: ${inProgressTasks.map((t) => t._id).join(', ')}, Pending review: ${pendingReview.length}`
      );
    }

    // Only promote from queue if all agents are ready (not active)
    // This ensures the entry point can pick up the next task from the queue
    const allAgentsReady = await areAllAgentsReady(ctx, args.chatroomId);

    if (allAgentsReady) {
      // Find the oldest queued task to promote
      const queuedTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
        )
        .collect();

      // Sort by queuePosition to get oldest
      queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
      const nextTask = queuedTasks[0];

      if (nextTask) {
        await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');
        return {
          completed: true,
          completedCount: inProgressTasks.length,
          promoted: nextTask._id,
          pendingReview,
        };
      }
    } else {
      console.warn(
        `[Task Complete] Skipping queue promotion - some agents are still active in chatroom ${args.chatroomId}`
      );
    }

    return {
      completed: true,
      completedCount: inProgressTasks.length,
      promoted: null,
      pendingReview,
    };
  },
});

/**
 * Cancel a task.
 * Allowed for pending, acknowledged, queued, backlog, backlog_acknowledged, pending_user_review, and in_progress tasks.
 * For in_progress tasks, requires force: true to prevent accidental cancellation.
 * If a pending task is cancelled, promotes the next queued task.
 * Uses 'closed' status for all cancelled tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const cancelTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Allow cancellation of most task statuses except completed/closed
    // For in_progress tasks, require force flag to prevent accidental cancellation
    const allowedStatuses = [
      'pending',
      'acknowledged',
      'queued',
      'backlog',
      'backlog_acknowledged',
      'pending_user_review',
      'in_progress',
    ];
    if (!allowedStatuses.includes(task.status)) {
      throw new Error(`Cannot cancel task with status: ${task.status}`);
    }

    // For in_progress tasks, require force flag
    if (task.status === 'in_progress' && !args.force) {
      throw new Error(
        `Task is in_progress. This task is currently being worked on. ` +
          `Use --force to cancel an active task.`
      );
    }

    const wasPending = task.status === 'pending';
    const wasInProgress = task.status === 'in_progress';

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'closed', 'cancelTask');

    // Log force cancellation for in_progress tasks
    if (wasInProgress) {
      console.warn(
        `[Force Cancel] Task ${args.taskId} force-cancelled from in_progress. ` +
          `Content: "${task.content.substring(0, 50)}${task.content.length > 50 ? '...' : ''}"`
      );
    }

    // If we cancelled a pending or in_progress task, promote the next queued task only if all agents are ready
    let promoted = null;
    if (wasPending || wasInProgress) {
      const allAgentsReady = await areAllAgentsReady(ctx, task.chatroomId);

      if (allAgentsReady) {
        const queuedTasks = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', task.chatroomId).eq('status', 'queued')
          )
          .collect();

        if (queuedTasks.length > 0) {
          // Sort by queuePosition to get oldest
          queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
          const nextTask = queuedTasks[0];

          await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');

          // Log the automatic promotion
          console.warn(
            `[Queue Promotion] Auto-promoted task ${nextTask._id} after cancellation of ${task.status} task ${args.taskId}. ` +
              `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
          );

          promoted = nextTask._id;
        }
      } else {
        console.warn(
          `[Queue Promotion Deferred] Cancelled ${task.status} task ${args.taskId} but some agents are still active. ` +
            `Queue promotion deferred until all agents are ready.`
        );
      }
    }

    return { success: true, promoted, status: 'closed' };
  },
});

/**
 * Complete a specific task by ID.
 * Allowed for backlog, queued, pending, and in_progress tasks.
 * For pending/in_progress tasks, use `force: true` to complete and auto-promote the next queued task.
 * Requires CLI session authentication and chatroom access.
 */
export const completeTaskById = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // For active tasks (pending, in_progress, acknowledged, backlog_acknowledged), require force flag
    if (
      task.status === 'pending' ||
      task.status === 'in_progress' ||
      task.status === 'acknowledged' ||
      task.status === 'backlog_acknowledged'
    ) {
      if (!args.force) {
        throw new Error(
          `Task is ${task.status}. Use --force to complete an active task. ` +
            `This will mark it as completed and promote the next queued task.`
        );
      }

      // Use FSM for transition

      await transitionTask(ctx, args.taskId, 'completed', 'completeTaskById');

      // Log force completion (suppress during testing)
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[Force Complete] Task ${args.taskId} force-completed from ${task.status}. ` +
            `Content: "${task.content.substring(0, 50)}${task.content.length > 50 ? '...' : ''}"`
        );
      }

      // Auto-promote the next queued task only if all agents are ready
      let promoted = null;
      const allAgentsReady = await areAllAgentsReady(ctx, task.chatroomId);

      if (allAgentsReady) {
        const queuedTasks = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', task.chatroomId).eq('status', 'queued')
          )
          .collect();

        if (queuedTasks.length > 0) {
          // Sort by queuePosition to get oldest
          queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
          const nextTask = queuedTasks[0];

          await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');

          console.warn(
            `[Queue Promotion] Auto-promoted task ${nextTask._id} after force-completing ${args.taskId}. ` +
              `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
          );

          promoted = nextTask._id;
        }
      } else {
        console.warn(
          `[Queue Promotion Deferred] Force-completed task ${args.taskId} but some agents are still active. ` +
            `Queue promotion deferred until all agents are ready.`
        );
      }

      return { success: true, taskId: args.taskId, promoted, wasForced: true };
    }

    // For backlog and queued tasks, complete normally (no promotion needed)
    if (task.status !== 'backlog' && task.status !== 'queued') {
      throw new Error(
        `Cannot complete task with status: ${task.status}. Only backlog, queued, pending, in_progress, acknowledged, and backlog_acknowledged tasks can be completed.`
      );
    }

    await transitionTask(ctx, args.taskId, 'completed', 'completeTaskById');

    return { success: true, taskId: args.taskId, promoted: null, wasForced: false };
  },
});

/**
 * Update a task's content.
 * Only allowed for queued and backlog tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const updateTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Only allow editing of queued, backlog, pending, acknowledged, and backlog_acknowledged tasks
    if (
      !['queued', 'backlog', 'pending', 'acknowledged', 'backlog_acknowledged'].includes(
        task.status
      )
    ) {
      throw new Error(`Cannot edit task with status: ${task.status}`);
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      content: args.content,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Move a backlog task to the queue (chat).
 * Optionally specify a custom message to send instead of the task content.
 * Requires CLI session authentication and chatroom access.
 */
export const moveToQueue = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
    // Optional custom message to send instead of task content
    customMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access - need chatroom for entry point
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Allow moving:
    // 1. Backlog tasks (status === 'backlog')
    // 2. Pending review tasks (status === 'pending_user_review')
    const isBacklogTask = task.status === 'backlog';
    const isPendingReview = task.status === 'pending_user_review';

    if (!isBacklogTask && !isPendingReview) {
      throw new Error(
        'Can only move backlog tasks or pending review tasks to queue. ' +
          'Task must have status "backlog" or "pending_user_review".'
      );
    }

    // Check if there's a pending or in_progress task
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    // If no pending/in_progress, this becomes pending
    // Otherwise, it goes to the queue
    const newStatus: 'queued' | 'pending' = activeTasks.length > 0 ? 'queued' : 'pending';

    const now = Date.now();

    // Use custom message if provided, otherwise use task content
    const messageContent = args.customMessage?.trim() || task.content;

    // Create a message from 'user' with the message content
    // This makes the task visible in the chat message list
    const targetRole = chatroom.teamEntryPoint || chatroom.teamRoles?.[0] || 'builder';
    const messageId = await ctx.db.insert('chatroom_messages', {
      chatroomId: task.chatroomId,
      senderRole: 'user',
      content: messageContent,
      targetRole,
      type: 'message',
      // Always attach the backlog task for context
      attachedTaskIds: [args.taskId],
    });

    // Update task with new status and link to the message using FSM

    await transitionTask(ctx, args.taskId, newStatus, 'moveToQueue');

    // Update sourceMessageId separately (not part of FSM transition)
    await ctx.db.patch('chatroom_tasks', args.taskId, {
      sourceMessageId: messageId,
      updatedAt: now,
    });

    // Link message to task
    await ctx.db.patch('chatroom_messages', messageId, { taskId: args.taskId });

    // Update chatroom's lastActivityAt for sorting by recent activity
    await ctx.db.patch('chatroom_rooms', task.chatroomId, {
      lastActivityAt: now,
    });

    return { success: true, newStatus, messageId };
  },
});

/**
 * Mark a backlog task as complete.
 * User confirms the issue is resolved.
 * Allowed for:
 * - Tasks in 'pending_user_review' status (normal flow after agent completes)
 * - Tasks in 'backlog' status (force complete from backlog tab)
 * Requires CLI session authentication and chatroom access.
 */
export const markBacklogComplete = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Cannot complete already completed/closed items
    if (task.status === 'completed' || task.status === 'closed') {
      throw new Error(`Task is already ${task.status}`);
    }

    // Allow completion from pending_user_review (normal flow) or backlog (force complete)
    if (task.status !== 'pending_user_review' && task.status !== 'backlog') {
      throw new Error(`Cannot complete task with status: ${task.status}`);
    }

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'completed', 'markBacklogComplete');

    return { success: true };
  },
});

/**
 * Mark a backlog task as ready for user review.
 * Agent indicates they've completed work on this backlog item.
 * Only allowed for backlog-origin tasks in 'backlog' status.
 * Requires CLI session authentication and chatroom access.
 */
export const markBacklogForReview = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Only allowed for tasks in 'backlog' status
    if (task.status !== 'backlog') {
      throw new Error(
        `Cannot mark task for review with status: ${task.status}. Task must be in 'backlog' status.`
      );
    }

    // Use FSM for transition
    await transitionTask(ctx, args.taskId, 'pending_user_review', 'markForReview');

    return { success: true };
  },
});

/**
 * Close a backlog task without completing.
 * Used for won't fix, duplicate, or no longer relevant items.
 * Only allowed for backlog-origin tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const closeBacklogTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Cannot close already completed/closed items
    if (task.status === 'completed' || task.status === 'closed') {
      throw new Error(`Task is already ${task.status}`);
    }

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'closed', 'cancelTask');

    return { success: true };
  },
});

/**
 * Reopen a completed or closed backlog task.
 * Returns the task to pending_user_review status (ready for user to review again).
 * Only allowed for backlog-origin tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const reopenBacklogTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Can only reopen completed or closed items
    if (task.status !== 'completed' && task.status !== 'closed') {
      throw new Error(`Task is ${task.status}, not completed or closed`);
    }

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'pending_user_review', 'reopenBacklogTask');

    return { success: true };
  },
});

/**
 * Send a task back for re-work.
 * Transitions task from pending_user_review back to the queue.
 * User can attach an optional message with feedback for the agent.
 * Only allowed for backlog-origin tasks in pending_user_review status.
 * Requires CLI session authentication and chatroom access.
 */
export const sendBackForRework = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
    // Optional feedback message for the agent
    feedback: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Only allowed for tasks in pending_user_review status
    if (task.status !== 'pending_user_review') {
      throw new Error(
        `Cannot send back task with status: ${task.status}. Must be pending_user_review.`
      );
    }

    const now = Date.now();

    // Check if there's a pending or in_progress task
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    // Determine new status: queued if active task exists, pending otherwise
    const newStatus: 'queued' | 'pending' = activeTasks.length > 0 ? 'queued' : 'pending';

    // If feedback provided, create a message from user
    let messageId = null;
    if (args.feedback?.trim()) {
      const targetRole = chatroom.teamEntryPoint || chatroom.teamRoles?.[0] || 'builder';
      messageId = await ctx.db.insert('chatroom_messages', {
        chatroomId: task.chatroomId,
        senderRole: 'user',
        content: args.feedback.trim(),
        targetRole,
        type: 'message',
        attachedTaskIds: [args.taskId],
      });

      // Update chatroom's lastActivityAt
      await ctx.db.patch('chatroom_rooms', task.chatroomId, {
        lastActivityAt: now,
      });
    }

    // Update task status back to queue using FSM

    await transitionTask(ctx, args.taskId, newStatus, 'sendBackForRework');

    // Update sourceMessageId separately (not part of FSM transition)
    await ctx.db.patch('chatroom_tasks', args.taskId, {
      sourceMessageId: messageId || task.sourceMessageId,
      updatedAt: now,
    });

    return { success: true, newStatus, messageId };
  },
});

/**
 * Patch a task's scoring fields (complexity, value, priority).
 * Idempotent - accepts all requests regardless of task status.
 * Designed for agents to score backlog tasks for prioritization.
 * Requires CLI session authentication and chatroom access.
 */
export const patchTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
    complexity: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    value: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Build patch object with only provided fields
    const patch: {
      complexity?: 'low' | 'medium' | 'high';
      value?: 'low' | 'medium' | 'high';
      priority?: number;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.complexity !== undefined) {
      patch.complexity = args.complexity;
    }
    if (args.value !== undefined) {
      patch.value = args.value;
    }
    if (args.priority !== undefined) {
      patch.priority = args.priority;
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, patch);

    return {
      success: true,
      taskId: args.taskId,
      updated: {
        complexity: args.complexity,
        value: args.value,
        priority: args.priority,
      },
    };
  },
});

/**
 * Reset a stuck in_progress task back to pending.
 * Used for manual recovery when an agent crashes without completing.
 * Requires CLI session authentication and chatroom access.
 */
export const resetStuckTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Only allow resetting in_progress tasks
    if (task.status !== 'in_progress') {
      throw new Error(
        `Cannot reset task with status: ${task.status}. Only in_progress tasks can be reset.`
      );
    }

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'pending', 'resetStuckTask');

    // Log manual reset (suppress during testing)
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[Manual Reset] chatroomId=${task.chatroomId} taskId=${args.taskId} ` +
          `previousAssignee=${task.assignedTo || 'unknown'} action=reset_to_pending`
      );
    }

    return { success: true, previousAssignee: task.assignedTo };
  },
});

/**
 * List tasks in a chatroom.
 * Optionally filter by status.
 * Backlog tasks are sorted by priority descending (higher = first), then by createdAt descending.
 * Tasks without priority sort to the end.
 * Requires CLI session authentication and chatroom access.
 */
export const listTasks = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    statusFilter: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('in_progress'),
        v.literal('queued'),
        v.literal('backlog'),
        v.literal('completed'),
        v.literal('closed'),
        v.literal('pending_user_review'),
        v.literal('active'), // pending + acknowledged + in_progress + queued + backlog + backlog_acknowledged
        v.literal('pending_review'), // pending_user_review status
        v.literal('archived') // completed + closed
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    let tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter by status
    if (args.statusFilter) {
      if (args.statusFilter === 'active') {
        tasks = tasks.filter(
          (t) =>
            t.status === 'pending' ||
            t.status === 'acknowledged' ||
            t.status === 'in_progress' ||
            t.status === 'queued' ||
            t.status === 'backlog' ||
            t.status === 'backlog_acknowledged'
        );
      } else if (args.statusFilter === 'pending_review') {
        // Pending review: tasks in pending_user_review status
        tasks = tasks.filter((t) => t.status === 'pending_user_review');
      } else if (args.statusFilter === 'archived') {
        // Archived: completed or closed tasks
        tasks = tasks.filter((t) => t.status === 'completed' || t.status === 'closed');
      } else {
        tasks = tasks.filter((t) => t.status === args.statusFilter);
      }
    }

    // Sort based on filter type
    if (args.statusFilter === 'archived') {
      // Archived: sort by updatedAt descending
      tasks.sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (args.statusFilter === 'backlog') {
      // Backlog: sort by priority descending (higher first), then by createdAt descending
      // Tasks without priority sort to the end
      tasks.sort((a, b) => {
        const aPriority = a.priority ?? -Infinity;
        const bPriority = b.priority ?? -Infinity;
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        return b.createdAt - a.createdAt; // Newer first as tiebreaker
      });
    } else {
      // Default: sort by queuePosition for active queue items
      tasks.sort((a, b) => a.queuePosition - b.queuePosition);
    }

    // Apply limit (capped at MAX_TASK_LIST_LIMIT)
    const limit = args.limit ? Math.min(args.limit, MAX_TASK_LIST_LIMIT) : MAX_TASK_LIST_LIMIT;
    return tasks.slice(0, limit);
  },
});

/**
 * List active tasks in a chatroom (all tasks that are not completed or closed).
 * Active tasks include: pending, acknowledged, in_progress, queued, backlog, backlog_acknowledged, pending_user_review.
 * Sorted by queuePosition ascending for active queue items.
 * No hard limit applied - returns all active tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const listActiveTasks = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get all tasks for this chatroom
    let tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter for active tasks (not completed or closed)
    tasks = tasks.filter(
      (t) =>
        t.status === 'pending' ||
        t.status === 'acknowledged' ||
        t.status === 'in_progress' ||
        t.status === 'queued' ||
        t.status === 'backlog' ||
        t.status === 'backlog_acknowledged' ||
        t.status === 'pending_user_review'
    );

    // Sort by queuePosition for active queue items
    tasks.sort((a, b) => a.queuePosition - b.queuePosition);

    // Apply limit if specified
    if (args.limit) {
      return tasks.slice(0, args.limit);
    }

    return tasks;
  },
});

/**
 * List archived tasks in a chatroom (completed or closed tasks).
 * Sorted by updatedAt descending (most recently updated first).
 * No hard limit applied - returns all archived tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const listArchivedTasks = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get all tasks for this chatroom
    let tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter for archived tasks (completed or closed)
    tasks = tasks.filter((t) => t.status === 'completed' || t.status === 'closed');

    // Sort by updatedAt descending (most recently updated first)
    tasks.sort((a, b) => b.updatedAt - a.updatedAt);

    // Apply limit if specified
    if (args.limit) {
      return tasks.slice(0, args.limit);
    }

    return tasks;
  },
});

/**
 * Get the active task (pending or in_progress).
 * Returns at most one task.
 * Requires CLI session authentication and chatroom access.
 */
export const getActiveTask = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // First check for in_progress
    const inProgress = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
      )
      .first();

    if (inProgress) {
      return inProgress;
    }

    // Then check for pending
    const pending = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .first();

    return pending || null;
  },
});

/**
 * Manually promote the next queued task to pending.
 * Use when the queue is stuck (queued tasks exist but no pending/in_progress).
 * Only promotes if all agents are ready (not active).
 * Logs when automatic promotion occurs.
 * Requires CLI session authentication and chatroom access.
 */
export const promoteNextTask = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check if there's already a pending or in_progress task
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    if (activeTasks.length > 0) {
      // Already have an active task - no promotion needed
      return { promoted: false, reason: 'active_task_exists', taskId: null };
    }

    // Check if all agents are ready (not active)
    const allAgentsReady = await areAllAgentsReady(ctx, args.chatroomId);
    if (!allAgentsReady) {
      return { promoted: false, reason: 'agents_still_active', taskId: null };
    }

    // Find the oldest queued task to promote
    const queuedTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
      )
      .collect();

    if (queuedTasks.length === 0) {
      // No queued tasks to promote
      return { promoted: false, reason: 'no_queued_tasks', taskId: null };
    }

    // Sort by queuePosition to get oldest
    queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
    const nextTask = queuedTasks[0];

    // Use FSM for transition

    await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');

    // Log the promotion
    console.warn(
      `[Queue Promotion] Promoted task ${nextTask._id} to pending in chatroom ${args.chatroomId}. ` +
        `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
    );

    return { promoted: true, reason: 'success', taskId: nextTask._id };
  },
});

/**
 * Check queue health and promotion eligibility.
 * Returns queue status and whether promotion is possible.
 * Promotion requires: no active tasks AND all agents are ready (not active).
 * Requires CLI session authentication and chatroom access.
 */
export const checkQueueHealth = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check for pending or in_progress tasks
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    // Check for queued tasks
    const queuedTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
      )
      .collect();

    // Check if all agents are ready
    const allAgentsReady = await areAllAgentsReady(ctx, args.chatroomId);

    const hasActiveTask = activeTasks.length > 0;
    const hasQueuedTasks = queuedTasks.length > 0;
    // Promotion is possible only if no active tasks, there are queued tasks, AND all agents are ready
    const needsPromotion = !hasActiveTask && hasQueuedTasks && allAgentsReady;

    return {
      hasActiveTask,
      queuedCount: queuedTasks.length,
      allAgentsReady,
      needsPromotion,
    };
  },
});

/**
 * Get task counts by status.
 * Requires CLI session authentication and chatroom access.
 */
export const getTaskCounts = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return {
      pending: tasks.filter((t) => t.status === 'pending').length,
      acknowledged: tasks.filter((t) => t.status === 'acknowledged').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      queued: tasks.filter((t) => t.status === 'queued').length,
      backlog: tasks.filter((t) => t.status === 'backlog').length,
      backlog_acknowledged: tasks.filter((t) => t.status === 'backlog_acknowledged').length,
      pending_user_review: tasks.filter((t) => t.status === 'pending_user_review').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      closed: tasks.filter((t) => t.status === 'closed').length,
    };
  },
});

/**
 * Get all pending tasks for a role.
 * Returns tasks in queue order (oldest first).
 * Used by wait-for-task to find work items.
 * Requires CLI session authentication and chatroom access.
 */
export const getPendingTasksForRole = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed) - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Determine the entry point role for user messages
    const entryPoint = chatroom.teamEntryPoint || chatroom.teamRoles?.[0];
    const normalizedRole = args.role.toLowerCase();
    const normalizedEntryPoint = entryPoint?.toLowerCase();

    // Get all pending tasks
    const pendingTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .collect();

    // Filter for tasks assigned to this role or user-created tasks routed to entry point
    // Status is now the single source of truth - no need to check timestamps
    const relevantTasks = pendingTasks.filter((task) => {
      // If task has explicit assignment, check it matches
      if (task.assignedTo) {
        return task.assignedTo.toLowerCase() === normalizedRole;
      }
      // User-created tasks go to entry point
      if (task.createdBy === 'user') {
        return normalizedRole === normalizedEntryPoint;
      }
      // Backlog/manual tasks without assignment - entry point handles
      return normalizedRole === normalizedEntryPoint;
    });

    // Sort by queuePosition (oldest first)
    relevantTasks.sort((a, b) => a.queuePosition - b.queuePosition);

    // For each task, get the source message if available
    const tasksWithMessages = await Promise.all(
      relevantTasks.map(async (task) => {
        let message = null;
        if (task.sourceMessageId) {
          message = await ctx.db.get('chatroom_messages', task.sourceMessageId);
        }
        return { task, message };
      })
    );

    return tasksWithMessages;
  },
});

/**
 * Get tasks by their IDs.
 * Used by CLI to fetch full task details for attached tasks in messages.
 * Requires CLI session authentication.
 */
export const getTasksByIds = query({
  args: {
    sessionId: v.string(),
    taskIds: v.array(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    // Validate session using the standard helper
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      return [];
    }

    // Fetch tasks - session is authenticated, tasks are accessed by ID
    const tasks = await Promise.all(
      args.taskIds.map(async (taskId) => {
        const task = await ctx.db.get('chatroom_tasks', taskId);
        if (!task) return null;

        return {
          _id: task._id,
          content: task.content,
          status: task.status,
          origin: task.origin,
          createdAt: task.createdAt,
          createdBy: task.createdBy,
        };
      })
    );

    return tasks.filter((t) => t !== null);
  },
});

/**
 * Get a single task by ID.
 * Used by CLI to fetch task details efficiently without listing all tasks.
 * Requires CLI session authentication and validates task belongs to specified chatroom.
 */
export const getTask = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    // Validate session and chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch the task directly by ID
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      return null;
    }

    // Verify task belongs to the specified chatroom
    if (task.chatroomId !== args.chatroomId) {
      return null;
    }

    return {
      _id: task._id,
      content: task.content,
      status: task.status,
      origin: task.origin,
      createdAt: task.createdAt,
      createdBy: task.createdBy,
    };
  },
});

/**
 * Get task system limits.
 * Returns the configured limits for task operations.
 * This allows clients to use the same limits as the server.
 */
export const getTaskLimits = query({
  args: {},
  handler: async () => {
    return {
      maxActiveTasks: MAX_ACTIVE_TASKS,
      maxTaskListLimit: MAX_TASK_LIST_LIMIT,
    };
  },
});

/**
 * Internal mutation to clean up stale agents.
 * Called by cron job every 2 minutes.
 * Detects agents that have exceeded their timeout without disconnecting.
 * Deletes stale participant rows (agents re-join when they reconnect)
 * and recovers any orphaned tasks from active agents that went stale.
 */
export const cleanupStaleAgents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Query active and waiting participants to check for stale timeouts
    const activeParticipants = await ctx.db
      .query('chatroom_participants')
      .filter((q) => q.eq(q.field('status'), 'active'))
      .collect();

    const waitingParticipants = await ctx.db
      .query('chatroom_participants')
      .filter((q) => q.eq(q.field('status'), 'waiting'))
      .collect();

    const candidateParticipants = [...activeParticipants, ...waitingParticipants];

    let cleanedCount = 0;
    const affectedTasks: string[] = [];

    for (const p of candidateParticipants) {
      const isStaleActive = p.status === 'active' && p.activeUntil && now > p.activeUntil;
      const isStaleWaiting = p.status === 'waiting' && p.readyUntil && now > p.readyUntil;

      if (isStaleActive || isStaleWaiting) {
        // If was active, recover their orphaned tasks before deleting
        if (isStaleActive) {
          const recovered = await recoverOrphanedTasks(ctx, p.chatroomId, p.role);
          affectedTasks.push(...recovered);
        }

        // Delete the stale participant — when the agent reconnects it will
        // re-join via join() and register as 'waiting' with fresh timeouts.
        await ctx.db.delete('chatroom_participants', p._id);

        cleanedCount++;
      }
    }

    // Summary log (one per run, includes affected task IDs)
    if (cleanedCount > 0) {
      console.warn(
        `[Stale Cleanup] Cleaned ${cleanedCount} participants, recovered ${affectedTasks.length} tasks. ` +
          `taskIds=${affectedTasks.join(',') || 'none'}`
      );
    }
  },
});
