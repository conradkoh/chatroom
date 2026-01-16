import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './lib/cliSessionAuth';

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
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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

    // Determine next queue position
    const allTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    const maxPosition = allTasks.reduce((max, t) => Math.max(max, t.queuePosition), 0);
    const queuePosition = maxPosition + 1;

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
    // Validate session and check chatroom access
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

    return { taskId: pendingTask._id, content: pendingTask.content };
  },
});

/**
 * Complete the current in_progress task.
 * Transitions to completed and promotes the next queued task to pending.
 * Requires CLI session authentication and chatroom access.
 */
export const completeTask = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Find the in_progress task
    const inProgressTask = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
      )
      .first();

    if (!inProgressTask) {
      // No task to complete - this is okay, just return
      return { completed: false, promoted: null };
    }

    const now = Date.now();

    // Complete the task
    await ctx.db.patch('chatroom_tasks', inProgressTask._id, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    });

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
      return { completed: true, promoted: nextTask._id };
    }

    return { completed: true, promoted: null };
  },
});

/**
 * Cancel a task.
 * Only allowed for queued and backlog tasks.
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

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Only allow cancellation of queued and backlog tasks
    if (task.status !== 'queued' && task.status !== 'backlog') {
      throw new Error(`Cannot cancel task with status: ${task.status}`);
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      status: 'cancelled',
      updatedAt: Date.now(),
    });

    return { success: true };
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

    // Validate session and check chatroom access
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
 * Move a backlog task to the queue.
 * Requires CLI session authentication and chatroom access.
 */
export const moveToQueue = mutation({
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

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      status: newStatus,
      updatedAt: Date.now(),
    });

    return { success: true, newStatus };
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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
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

    // Sort by queuePosition
    tasks.sort((a, b) => a.queuePosition - b.queuePosition);

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
    // Validate session and check chatroom access
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
 * Get task counts by status.
 * Requires CLI session authentication and chatroom access.
 */
export const getTaskCounts = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
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
