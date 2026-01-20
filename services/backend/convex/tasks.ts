import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import {
  areAllAgentsReady,
  getAndIncrementQueuePosition,
  requireChatroomAccess,
} from './lib/cliSessionAuth';

/**
 * Maximum number of active tasks per chatroom.
 * Active = pending + in_progress + queued + backlog (excludes completed/cancelled)
 */
const MAX_ACTIVE_TASKS = 100;

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
        q.and(q.neq(q.field('status'), 'completed'), q.neq(q.field('status'), 'cancelled'))
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

    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy: args.createdBy,
      content: args.content,
      status,
      sourceMessageId: args.sourceMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition,
      // Initialize backlog lifecycle tracking for backlog tasks
      ...(args.isBacklog && { backlog: { status: 'not_started' as const } }),
    });

    return { taskId, status, queuePosition };
  },
});

/**
 * Start working on a task.
 * Finds the pending task and transitions it to in_progress.
 * Requires CLI session authentication and chatroom access.
 */
export const startTask = mutation({
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
      throw new Error('No pending task to start');
    }

    const now = Date.now();
    await ctx.db.patch('chatroom_tasks', pendingTask._id, {
      status: 'in_progress',
      assignedTo: args.role,
      startedAt: now,
      updatedAt: now,
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
 * Complete ALL in_progress tasks in the chatroom.
 * Transitions all in_progress tasks to completed and promotes the next queued task to pending.
 * This ensures resilience - when an agent completes, any orphaned in_progress tasks are cleaned up.
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
      return { completed: false, completedCount: 0, promoted: null };
    }

    const now = Date.now();

    // Complete ALL in_progress tasks
    for (const task of inProgressTasks) {
      await ctx.db.patch('chatroom_tasks', task._id, {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      });
    }

    // Log if multiple tasks were completed (indicates a stuck state that was cleaned up)
    if (inProgressTasks.length > 1) {
      console.warn(
        `[Task Cleanup] Completed ${inProgressTasks.length} in_progress tasks in chatroom ${args.chatroomId}. ` +
          `Task IDs: ${inProgressTasks.map((t) => t._id).join(', ')}`
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
        await ctx.db.patch('chatroom_tasks', nextTask._id, {
          status: 'pending',
          updatedAt: now,
        });
        return { completed: true, completedCount: inProgressTasks.length, promoted: nextTask._id };
      }
    } else {
      console.warn(
        `[Task Complete] Skipping queue promotion - some agents are still active in chatroom ${args.chatroomId}`
      );
    }

    return { completed: true, completedCount: inProgressTasks.length, promoted: null };
  },
});

/**
 * Cancel a task.
 * Only allowed for pending, queued and backlog tasks.
 * If a pending task is cancelled, promotes the next queued task.
 * Requires CLI session authentication and chatroom access.
 */
export const cancelTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Only allow cancellation of pending, queued and backlog tasks (not in_progress)
    if (task.status !== 'pending' && task.status !== 'queued' && task.status !== 'backlog') {
      throw new Error(`Cannot cancel task with status: ${task.status}`);
    }

    const now = Date.now();
    const wasPending = task.status === 'pending';

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      status: 'cancelled',
      updatedAt: now,
    });

    // If we cancelled a pending task, promote the next queued task only if all agents are ready
    let promoted = null;
    if (wasPending) {
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

          await ctx.db.patch('chatroom_tasks', nextTask._id, {
            status: 'pending',
            updatedAt: now,
          });

          // Log the automatic promotion
          console.warn(
            `[Queue Promotion] Auto-promoted task ${nextTask._id} after cancellation of pending task ${args.taskId}. ` +
              `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
          );

          promoted = nextTask._id;
        }
      } else {
        console.warn(
          `[Queue Promotion Deferred] Cancelled pending task ${args.taskId} but some agents are still active. ` +
            `Queue promotion deferred until all agents are ready.`
        );
      }
    }

    return { success: true, promoted };
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

    const now = Date.now();

    // For pending/in_progress tasks, require force flag
    if (task.status === 'pending' || task.status === 'in_progress') {
      if (!args.force) {
        throw new Error(
          `Task is ${task.status}. Use --force to complete an active task. ` +
            `This will mark it as completed and promote the next queued task.`
        );
      }

      // Complete the task
      await ctx.db.patch('chatroom_tasks', args.taskId, {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      });

      // Log force completion
      console.warn(
        `[Force Complete] Task ${args.taskId} force-completed from ${task.status}. ` +
          `Content: "${task.content.substring(0, 50)}${task.content.length > 50 ? '...' : ''}"`
      );

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

          await ctx.db.patch('chatroom_tasks', nextTask._id, {
            status: 'pending',
            updatedAt: now,
          });

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
        `Cannot complete task with status: ${task.status}. Only backlog, queued, pending, and in_progress tasks can be completed.`
      );
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    });

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

    // Only allow editing of queued and backlog tasks
    if (task.status !== 'queued' && task.status !== 'backlog') {
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

    // Only allow moving backlog tasks
    if (task.status !== 'backlog') {
      throw new Error('Can only move backlog tasks to queue');
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
    const newStatus = activeTasks.length > 0 ? 'queued' : 'pending';

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

    // Update task with new status and link to the message
    await ctx.db.patch('chatroom_tasks', args.taskId, {
      status: newStatus,
      updatedAt: now,
      // Update backlog lifecycle to 'started' when moving to queue
      backlog: { status: 'started' as const },
      // Link task to the message
      sourceMessageId: messageId,
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
 * Only allowed for tasks with backlog lifecycle tracking.
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

    // Task must have backlog lifecycle tracking
    if (!task.backlog) {
      throw new Error('Task is not a backlog item');
    }

    // Cannot complete already completed/closed items
    if (task.backlog.status === 'complete' || task.backlog.status === 'closed') {
      throw new Error(`Task is already ${task.backlog.status}`);
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      backlog: { status: 'complete' as const },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Close a backlog task without completing.
 * Used for won't fix, duplicate, or no longer relevant items.
 * Only allowed for tasks with backlog lifecycle tracking.
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

    // Task must have backlog lifecycle tracking
    if (!task.backlog) {
      throw new Error('Task is not a backlog item');
    }

    // Cannot close already completed/closed items
    if (task.backlog.status === 'complete' || task.backlog.status === 'closed') {
      throw new Error(`Task is already ${task.backlog.status}`);
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      backlog: { status: 'closed' as const },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Reopen a completed or closed backlog task.
 * Returns the task to 'started' status.
 * Only allowed for tasks with backlog lifecycle tracking.
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

    // Task must have backlog lifecycle tracking
    if (!task.backlog) {
      throw new Error('Task is not a backlog item');
    }

    // Can only reopen completed or closed items
    if (task.backlog.status !== 'complete' && task.backlog.status !== 'closed') {
      throw new Error(`Task is ${task.backlog.status}, not completed or closed`);
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      backlog: { status: 'started' as const },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * List tasks in a chatroom.
 * Optionally filter by status.
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
        v.literal('cancelled'),
        v.literal('active') // pending + in_progress + queued + backlog
      )
    ),
    // Filter for backlog lifecycle status
    backlogStatusFilter: v.optional(
      v.union(
        v.literal('active'), // not_started + started (shown in main backlog list)
        v.literal('archived') // complete + closed (hidden from main list)
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
            t.status === 'in_progress' ||
            t.status === 'queued' ||
            t.status === 'backlog'
        );
      } else {
        tasks = tasks.filter((t) => t.status === args.statusFilter);
      }
    }

    // Filter by backlog lifecycle status
    if (args.backlogStatusFilter) {
      if (args.backlogStatusFilter === 'active') {
        // Active: tasks without backlog field OR with not_started/started status
        tasks = tasks.filter(
          (t) => !t.backlog || t.backlog.status === 'not_started' || t.backlog.status === 'started'
        );
      } else if (args.backlogStatusFilter === 'archived') {
        // Archived: only tasks with complete/closed status
        tasks = tasks.filter(
          (t) => t.backlog?.status === 'complete' || t.backlog?.status === 'closed'
        );
      }
    }

    // Sort by queuePosition for active, by updatedAt desc for archived
    if (args.backlogStatusFilter === 'archived') {
      tasks.sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      tasks.sort((a, b) => a.queuePosition - b.queuePosition);
    }

    // Apply limit
    const limit = args.limit ? Math.min(args.limit, 100) : 100;
    return tasks.slice(0, limit);
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

    const now = Date.now();
    await ctx.db.patch('chatroom_tasks', nextTask._id, {
      status: 'pending',
      updatedAt: now,
    });

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
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      queued: tasks.filter((t) => t.status === 'queued').length,
      backlog: tasks.filter((t) => t.status === 'backlog').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length,
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
 * Requires CLI session authentication and validates chatroom access for each task.
 */
export const getTasksByIds = query({
  args: {
    sessionId: v.string(),
    taskIds: v.array(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    // Validate session
    const session = await ctx.db
      .query('cli_sessions')
      .withIndex('by_session_id', (q) => q.eq('sessionId', args.sessionId))
      .first();

    if (!session || !session.isValid || !session.userId) {
      return [];
    }

    // Fetch tasks
    const tasks = await Promise.all(
      args.taskIds.map(async (taskId) => {
        const task = await ctx.db.get('chatroom_tasks', taskId);
        if (!task) return null;

        // Verify user has access to the chatroom this task belongs to
        const participant = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
          .filter((q) => q.eq(q.field('userId'), session.userId))
          .first();

        if (!participant) return null;

        return {
          _id: task._id,
          content: task.content,
          status: task.status,
          createdAt: task.createdAt,
          createdBy: task.createdBy,
          backlog: task.backlog,
        };
      })
    );

    return tasks.filter((t) => t !== null);
  },
});
