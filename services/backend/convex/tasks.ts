import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  NON_FATAL_ERROR_CODES,
  type BackendError,
  type BackendErrorCode,
} from '../config/errorCodes';
import { RECOVERY_GRACE_PERIOD_MS } from '../config/reliability';
import { mutation, query } from './_generated/server';
import {
  areAllAgentsWaiting,
  getAndIncrementQueuePosition,
  requireChatroomAccess,
  validateSession,
} from './auth/cliSessionAuth';
import { createTask as createTaskUsecase } from '../src/domain/usecase/task/create-task';
import { promoteNextTask as promoteNextTaskUsecase } from '../src/domain/usecase/task/promote-next-task';
import { promoteQueuedMessage } from '../src/domain/usecase/task/promote-queued-message';
import { transitionTask, type TransitionTaskOptions } from '../src/domain/usecase/task/transition-task';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { patchParticipantStatus } from '../src/domain/entities/participant';

/** Maximum number of active tasks per chatroom. */
const MAX_ACTIVE_TASKS = 100;

/** Maximum number of tasks to return in list queries. */
const MAX_TASK_LIST_LIMIT = 100;

/** Creates a new task in a chatroom (pending status). */
export const createTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    createdBy: v.string(),
    sourceMessageId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access - need chatroom for queue position
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check active task limit
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) => q.neq(q.field('status'), 'completed'))
      .collect();

    if (activeTasks.length >= MAX_ACTIVE_TASKS) {
      throw new Error(
        `Task limit reached (${MAX_ACTIVE_TASKS}). Complete or cancel existing tasks before adding more.`
      );
    }

    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    const { taskId } = await createTaskUsecase(ctx, {
      chatroomId: args.chatroomId,
      createdBy: args.createdBy,
      content: args.content,
      forceStatus: 'pending',
      sourceMessageId: args.sourceMessageId,
      queuePosition,
    });

    return { taskId, status: 'pending', queuePosition };
  },
});

/** Claims a pending task for a role (pending → acknowledged). */
export const claimTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.optional(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new Error('Chatroom not found');
    }

    const normalizedRole = args.role.toLowerCase();
    const normalizedEntryPoint = (getTeamEntryPoint(chatroom) ?? 'builder').toLowerCase();
    const isRelevantForRole = (task: { assignedTo?: string; createdBy: string }) => {
      if (task.assignedTo) {
        return task.assignedTo.toLowerCase() === normalizedRole;
      }
      return normalizedRole === normalizedEntryPoint;
    };

    let pendingTask;
    if (args.taskId) {
      pendingTask = await ctx.db.get('chatroom_tasks', args.taskId);
      if (!pendingTask) {
        throw new Error('Task not found');
      }
      if (pendingTask.chatroomId !== args.chatroomId) {
        throw new Error('Task does not belong to this chatroom');
      }
      if (pendingTask.status !== 'pending') {
        throw new Error(`Task must be pending to claim (current status: ${pendingTask.status})`);
      }
      if (!isRelevantForRole(pendingTask)) {
        throw new Error(`Task is not claimable by role ${args.role}`);
      }
    } else {
      // Legacy behavior: find a pending task relevant for this role.
      const pendingTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
        )
        .collect();

      pendingTask = pendingTasks
        .filter(isRelevantForRole)
        .sort((a, b) => a.queuePosition - b.queuePosition)[0];

      if (!pendingTask) {
        throw new Error('No pending task to claim');
      }
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

    // Emit task.acknowledged event so UI can derive agent status from event stream
    await ctx.db.insert('chatroom_eventStream', {
      type: 'task.acknowledged',
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: pendingTask._id,
      timestamp: now,
    });
    await patchParticipantStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');

    return { taskId: pendingTask._id, content: pendingTask.content };
  },
});

/** Transitions an acknowledged task to in_progress for the assigned role. */
export const startTask = mutation({
  args: {
    ...SessionIdArg,
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

      // IDEMPOTENCY: If task is already in_progress, accept it — this is a recovering agent
      // picking up where a dead agent left off. The old agent's process is gone; we update
      // assignedTo to reflect the new agent and emit task.inProgress for UI consistency.
      if (acknowledgedTask.status === 'in_progress') {
        const now = Date.now();
        if (acknowledgedTask.assignedTo !== args.role) {
          await ctx.db.patch('chatroom_tasks', acknowledgedTask._id, {
            assignedTo: args.role,
            updatedAt: now,
          });
        }
        await ctx.db.insert('chatroom_eventStream', {
          type: 'task.inProgress',
          chatroomId: args.chatroomId,
          role: args.role,
          taskId: acknowledgedTask._id,
          timestamp: now,
        });
        await patchParticipantStatus(ctx, args.chatroomId, args.role, 'task.inProgress');
        return { taskId: acknowledgedTask._id, content: acknowledgedTask.content };
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

    // Emit task.inProgress event so UI can derive agent status from event stream
    await ctx.db.insert('chatroom_eventStream', {
      type: 'task.inProgress',
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: acknowledgedTask._id,
      timestamp: Date.now(),
    });
    await patchParticipantStatus(ctx, args.chatroomId, args.role, 'task.inProgress');

    return { taskId: acknowledgedTask._id, content: acknowledgedTask.content };
  },
});

/** Completes all in_progress tasks in the chatroom. */
export const completeTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Find ALL in_progress and acknowledged tasks (there should typically be only one, but complete all for resilience)
    const [inProgressTasks, acknowledgedTasks] = await Promise.all([
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
        )
        .collect(),
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
        )
        .collect(),
    ]);
    const allTasksToComplete = [...inProgressTasks, ...acknowledgedTasks];

    if (allTasksToComplete.length === 0) {
      // No tasks to complete - this is okay, just return
      return { completed: false, completedCount: 0 };
    }

    // Complete ALL tasks (in_progress + acknowledged) → completed
    for (const task of allTasksToComplete) {
      await transitionTask(ctx, task._id, 'completed', 'completeTask');
    }

    // Log if multiple tasks were completed (indicates a stuck state that was cleaned up)
    if (allTasksToComplete.length > 1) {
      console.warn(
        `[Task Cleanup] Processed ${allTasksToComplete.length} tasks (in_progress + acknowledged) in chatroom ${args.chatroomId}. ` +
          `Task IDs: ${allTasksToComplete.map((t) => t._id).join(', ')}`
      );
    }

    // Queue promotion is now handled automatically by the transitionTask usecase
    // whenever a task transitions to 'completed'. No inline promotion needed here.

    return {
      completed: true,
      completedCount: allTasksToComplete.length,
    };
  },
});



/** Completes a specific task by ID, requiring force for active tasks. */
export const completeTaskById = mutation({
  args: {
    ...SessionIdArg,
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

    // For active tasks (pending, in_progress, acknowledged), require force flag
    if (
      task.status === 'pending' ||
      task.status === 'in_progress' ||
      task.status === 'acknowledged'
    ) {
      if (!args.force) {
        throw new Error(
          `Task is ${task.status}. Use --force to complete an active task. ` +
            `This will mark it as completed and promote the next message from the queue.`
        );
      }

      // Use FSM for transition.
      // Pass skipAgentStatusUpdate=true to suppress the task.completed event and participant
      // status patch. The agent process may still be running — it will update its own status
      // naturally when it calls get-next-task (→ agent.waiting) or crashes (→ agent.exited).
      // Emitting agent status events here would mislead the UI.
      await transitionTask(ctx, args.taskId, 'completed', 'completeTaskById', undefined, {
        skipAgentStatusUpdate: true,
      } satisfies TransitionTaskOptions);

      // Log force completion (suppress during testing)
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[Force Complete] Task ${args.taskId} force-completed from ${task.status}. ` +
            `Content: "${task.content.substring(0, 50)}${task.content.length > 50 ? '...' : ''}"`
        );
      }

      // Queue promotion is now handled automatically by the transitionTask usecase
      // whenever a task transitions to 'completed'. No inline promotion needed here.

      return { success: true, taskId: args.taskId, wasForced: true };
    }

    throw new Error(
      `Cannot complete task with status: ${task.status}. Only pending, in_progress, and acknowledged tasks can be completed.`
    );
  },
});

/** Updates the content of a pending or acknowledged task. */
export const updateTask = mutation({
  args: {
    ...SessionIdArg,
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

    // Only allow editing of pending and acknowledged tasks
    if (
      !['pending', 'acknowledged'].includes(
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





/** Lists tasks in a chatroom, optionally filtered by status and sorted by priority or queue position. */
export const listTasks = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    statusFilter: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('in_progress'),
        v.literal('active'), // pending + acknowledged + in_progress
        v.literal('all'),    // all active (not historical)
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    let tasks;

    // Use by_chatroom_status index for single-status filters to avoid full table scans.
    // Fall back to by_chatroom (full scan) for multi-status filters (active, all)
    // or when no filter is specified.
    if (
      args.statusFilter &&
      args.statusFilter !== 'active' &&
      args.statusFilter !== 'all'
    ) {
      // Single concrete statuses (pending, in_progress)
      tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq(
            'status',
            // At this branch, statusFilter is a concrete DB status (not a virtual filter like
            // 'active' or 'all'). The cast is safe — TypeScript cannot infer the subtype
            // relationship between the statusFilter union and the schema status union.
            args.statusFilter as 'pending' | 'in_progress'
          )
        )
        .collect();
    } else {
      tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .collect();

      // Apply in-memory filter for multi-status cases
      if (args.statusFilter === 'active') {
        tasks = tasks.filter(
          (t) =>
            t.status === 'pending' ||
            t.status === 'acknowledged' ||
            t.status === 'in_progress'
        );
      } else if (args.statusFilter === 'all') {
        // All active (not historical): exclude completed
        tasks = tasks.filter((t) => t.status !== 'completed');
      }
    }

    // Sort by queuePosition for all task types
    tasks.sort((a, b) => a.queuePosition - b.queuePosition);

    // Apply limit (capped at MAX_TASK_LIST_LIMIT)
    const limit = args.limit ? Math.min(args.limit, MAX_TASK_LIST_LIMIT) : MAX_TASK_LIST_LIMIT;
    return tasks.slice(0, limit);
  },
});

/** Returns all active (pending, acknowledged, in_progress) tasks in a chatroom, sorted by queue position. */
export const listActiveTasks = query({
  args: {
    ...SessionIdArg,
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

    // Filter for active tasks (not completed)
    tasks = tasks.filter(
      (t) =>
        t.status === 'pending' ||
        t.status === 'acknowledged' ||
        t.status === 'in_progress'
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

/** Returns completed tasks in a chatroom, sorted by most recently updated. */
export const listArchivedTasks = query({
  args: {
    ...SessionIdArg,
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

    // Filter for archived tasks (completed)
    tasks = tasks.filter((t) => t.status === 'completed');

    // Sort by updatedAt descending (most recently updated first)
    tasks.sort((a, b) => b.updatedAt - a.updatedAt);

    // Apply limit if specified
    if (args.limit) {
      return tasks.slice(0, args.limit);
    }

    return tasks;
  },
});

/** Returns the current in_progress or pending task for a chatroom. */
export const getActiveTask = query({
  args: {
    ...SessionIdArg,
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

/** Promotes the oldest queued task to pending if no active task exists and all agents are ready. */
export const promoteNextTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Delegate to the promote-next-task usecase with deps wired from ctx
    const result = await promoteNextTaskUsecase(args.chatroomId, {
      areAllAgentsWaiting: (chatroomId) => areAllAgentsWaiting(ctx, chatroomId),
      getOldestQueuedMessage: async (chatroomId) => {
        return await ctx.db
          .query('chatroom_messageQueue')
          .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
          .order('asc')
          .first();
      },
      promoteQueuedMessage: (queuedMessageId) => promoteQueuedMessage(ctx, queuedMessageId),
    });

    return result.promoted
      ? { promoted: true, reason: 'success', taskId: result.promoted }
      : { promoted: false, reason: result.reason, taskId: null };
  },
});

/**
 * Promotes a specific queued message to an active pending task.
 * User-triggered, bypasses areAllAgentsWaiting check.
 * Fails gracefully if there is already a pending or in_progress task.
 */
export const promoteSpecificTask = mutation({
  args: {
    ...SessionIdArg,
    queuedMessageId: v.id('chatroom_messageQueue'),
  },
  handler: async (ctx, args) => {
    const queueRecord = await ctx.db.get('chatroom_messageQueue', args.queuedMessageId);
    if (!queueRecord) {
      throw new ConvexError({ code: 'QUEUED_MESSAGE_NOT_FOUND', message: 'Queued message not found' });
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, queueRecord.chatroomId);

    // Check for active tasks — cannot promote if another task is pending/in_progress
    const [pendingTask, inProgressTask] = await Promise.all([
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', queueRecord.chatroomId).eq('status', 'pending')
        )
        .first(),
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', queueRecord.chatroomId).eq('status', 'in_progress')
        )
        .first(),
    ]);

    if (pendingTask || inProgressTask) {
      return {
        promoted: false,
        reason: 'active_task_exists' as const,
      };
    }

    // Promote: queue record → message + task (bypass areAllAgentsWaiting)
    await promoteQueuedMessage(ctx, args.queuedMessageId);

    return {
      promoted: true,
      reason: 'success' as const,
    };
  },
});

/** Returns queue health status including active task presence, queued count, and promotion eligibility. */
export const checkQueueHealth = query({
  args: {
    ...SessionIdArg,
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

    // Check for queued messages (from chatroom_messageQueue, not tasks)
    const queuedMessages = await ctx.db
      .query('chatroom_messageQueue')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Check if all agents are waiting for a task
    const allAgentsWaiting = await areAllAgentsWaiting(ctx, args.chatroomId);

    const hasActiveTask = activeTasks.length > 0;
    const hasQueuedTasks = queuedMessages.length > 0;
    // Promotion is possible only if no active tasks, there are queued messages, AND all agents are waiting
    const needsPromotion = !hasActiveTask && hasQueuedTasks && allAgentsWaiting;

    return {
      hasActiveTask,
      queuedCount: queuedMessages.length,
      allAgentsReady: allAgentsWaiting,
      needsPromotion,
    };
  },
});

/** Returns task counts grouped by status for a chatroom. */
export const getTaskCounts = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Queued messages are now in chatroom_messageQueue, not tasks
    const queuedMessages = await ctx.db
      .query('chatroom_messageQueue')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Backlog items are now in chatroom_backlog, not chatroom_tasks
    const backlogItems = await ctx.db
      .query('chatroom_backlog')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return {
      pending: tasks.filter((t) => t.status === 'pending').length,
      acknowledged: tasks.filter((t) => t.status === 'acknowledged').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      queued: queuedMessages.length, // Count from chatroom_messageQueue
      backlog: backlogItems.filter((i) => i.status === 'backlog').length,
      pendingUserReview: backlogItems.filter((i) => i.status === 'pending_user_review').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
    };
  },
});

/** Returns pending, acknowledged, and in_progress tasks relevant to a role, or a typed status response. */
export const getPendingTasksForRole = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    connectionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Validate session and check chatroom access
      const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

      // Check for superseded connection before processing tasks
      if (args.connectionId) {
        const participant = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('role', args.role)
          )
          .unique();

        if (participant?.connectionId && participant.connectionId !== args.connectionId) {
          return {
            type: 'superseded' as const,
            newConnectionId: participant.connectionId,
          };
        }
      }

      // Determine the entry point role for user messages
      const entryPoint = getTeamEntryPoint(chatroom);
      const normalizedRole = args.role.toLowerCase();
      const normalizedEntryPoint = entryPoint?.toLowerCase();

      // Helper to check if a task is relevant for this role
      const isRelevantForRole = (task: { assignedTo?: string; createdBy: string }) => {
        if (task.assignedTo) {
          return task.assignedTo.toLowerCase() === normalizedRole;
        }
        if (task.createdBy === 'user') {
          return normalizedRole === normalizedEntryPoint;
        }
        return normalizedRole === normalizedEntryPoint;
      };

      // Get all pending tasks
      const pendingTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
        )
        .collect();

      // Also get acknowledged tasks for recovery
      // An acknowledged task may be orphaned if the agent that claimed it died
      const acknowledgedTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
        )
        .collect();

      // Also get in_progress tasks for recovery
      // If an agent died mid-task, the task remains in_progress.
      // Returning it here allows the recovered agent to resume work
      // without losing context or requiring manual intervention.
      const inProgressTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
        )
        .collect();

      // Filter for tasks relevant to this role
      const relevantPending = pendingTasks.filter(isRelevantForRole);
      const relevantAcknowledged = acknowledgedTasks.filter(isRelevantForRole);
      const relevantInProgress = inProgressTasks.filter(isRelevantForRole);

      // Combine: pending first, then acknowledged, then in_progress
      // Priority order ensures fresh tasks are picked up before resuming in-flight ones
      const relevantTasks = [...relevantPending, ...relevantAcknowledged, ...relevantInProgress];

      // Sort by queuePosition (oldest first)
      relevantTasks.sort((a, b) => a.queuePosition - b.queuePosition);

      // Check for grace period on acknowledged tasks
      if (relevantTasks.length > 0 && relevantTasks[0].status === 'acknowledged') {
        const task = relevantTasks[0];
        const acknowledgedAt = task.acknowledgedAt ?? task._creationTime;
        const elapsedMs = Date.now() - acknowledgedAt;

        if (elapsedMs < RECOVERY_GRACE_PERIOD_MS) {
          const remainingMs = RECOVERY_GRACE_PERIOD_MS - elapsedMs;
          return {
            type: 'grace_period' as const,
            taskId: task._id as string,
            remainingMs,
          };
        }
      }

      // No tasks found
      if (relevantTasks.length === 0) {
        return { type: 'no_tasks' as const };
      }

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

      return { type: 'tasks' as const, tasks: tasksWithMessages };
    } catch (error) {
      if (error instanceof ConvexError) {
        const data = error.data as BackendError;
        const isFatal = !NON_FATAL_ERROR_CODES.includes(data.code);
        return {
          type: 'error' as const,
          code: data.code,
          message: data.message,
          fatal: isFatal,
        };
      }
      // Unknown error — treat as fatal
      return {
        type: 'error' as const,
        code: 'SESSION_INVALID' as BackendErrorCode,
        message: (error as Error).message || 'Unknown error',
        fatal: true,
      };
    }
  },
});

/** Fetches multiple tasks by ID, enforcing chatroom-level access control. */
export const getTasksByIds = query({
  args: {
    ...SessionIdArg,
    taskIds: v.array(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    // Validate session using the standard helper
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      return [];
    }

    // Fetch tasks by ID first, then enforce chatroom-level access before returning data.
    const fetchedTasks = (
      await Promise.all(args.taskIds.map((taskId) => ctx.db.get('chatroom_tasks', taskId)))
    ).filter((task): task is NonNullable<typeof task> => task !== null);

    const uniqueChatroomIds = [...new Set(fetchedTasks.map((task) => task.chatroomId))];
    const allowedChatroomIds = new Set<string>();
    await Promise.all(
      uniqueChatroomIds.map(async (chatroomId) => {
        try {
          await requireChatroomAccess(ctx, args.sessionId, chatroomId);
          allowedChatroomIds.add(chatroomId);
        } catch {
          // Skip unauthorized chatrooms instead of leaking task details.
        }
      })
    );

    return fetchedTasks
      .filter((task) => allowedChatroomIds.has(task.chatroomId))
      .map((task) => ({
        _id: task._id,
        content: task.content,
        status: task.status,
        createdAt: task.createdAt,
        createdBy: task.createdBy,
      }));
  },
});

/** Returns a single task by ID, verifying it belongs to the specified chatroom. */
export const getTask = query({
  args: {
    ...SessionIdArg,
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
      createdAt: task.createdAt,
      createdBy: task.createdBy,
    };
  },
});

/** Returns the configured task count and list limits. */
export const getTaskLimits = query({
  args: {},
  handler: async () => {
    return {
      maxActiveTasks: MAX_ACTIVE_TASKS,
      maxTaskListLimit: MAX_TASK_LIST_LIMIT,
    };
  },
});

/** Returns completed tasks in a chatroom, filtered by date range. */
export const listHistoricalTasks = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    from: v.optional(v.number()), // epoch ms, defaults to 30 days ago
    to: v.optional(v.number()),   // epoch ms, defaults to now
    status: v.optional(v.literal('completed')), // omit = completed
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const now = Date.now();
    const fromMs = args.from ?? (now - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const toMs = args.to ?? now;

    let tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter to completed
    tasks = tasks.filter(t => t.status === 'completed');

    // Apply date range filter (use completedAt if available, fall back to updatedAt)
    tasks = tasks.filter(t => {
      const ts = t.completedAt ?? t.updatedAt;
      return ts >= fromMs && ts <= toMs;
    });

    // Sort by completedAt/updatedAt descending (most recent first)
    tasks.sort((a, b) => {
      const aTs = a.completedAt ?? a.updatedAt;
      const bTs = b.completedAt ?? b.updatedAt;
      return bTs - aTs;
    });

    const limit = args.limit ? Math.min(args.limit, MAX_TASK_LIST_LIMIT) : MAX_TASK_LIST_LIMIT;
    return tasks.slice(0, limit);
  },
});

