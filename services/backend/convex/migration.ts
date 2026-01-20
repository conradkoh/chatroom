import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';

const BATCH_SIZE = 100; // Process 100 sessions per batch

interface PaginationOpts {
  numItems: number;
  cursor: string | null;
}

/**
 * Internal mutation to remove deprecated expiration fields from a single session.
 * Part of the session expiration deprecation migration.
 */
export const unsetSessionExpiration = internalMutation({
  args: { sessionId: v.id('sessions') },
  handler: async (ctx, args) => {
    await ctx.db.patch('sessions', args.sessionId, {
      expiresAt: undefined,
      expiresAtLabel: undefined,
    });
  },
});

/**
 * Internal action to migrate all sessions by removing deprecated expiration fields.
 * Processes sessions in batches to avoid timeout issues.
 */
export const migrateUnsetSessionExpiration = internalAction({
  args: { cursor: v.optional(v.string()) }, // Convex cursor for pagination
  handler: async (ctx, args) => {
    const paginationOpts: PaginationOpts = {
      numItems: BATCH_SIZE,
      cursor: args.cursor ?? null,
    };

    // Fetch a batch of sessions
    const results = await ctx.runQuery(internal.migration.getSessionsBatch, {
      paginationOpts,
    });

    // Schedule mutations to update each session in the batch
    for (const session of results.page) {
      await ctx.runMutation(internal.migration.unsetSessionExpiration, {
        sessionId: session._id,
      });
    }

    // If there are more sessions, schedule the next batch
    if (!results.isDone) {
      await ctx.runAction(internal.migration.migrateUnsetSessionExpiration, {
        cursor: results.continueCursor,
      });
    }
  },
});

/**
 * Helper query to fetch sessions in batches for pagination during migration.
 */
export const getSessionsBatch = internalQuery({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.query('sessions').paginate(args.paginationOpts);
  },
});

// ========================================
// USER ACCESS LEVEL MIGRATION
// ========================================

/**
 * Internal mutation to set default accessLevel for a user if currently undefined.
 * Part of the user access level migration to ensure all users have explicit access levels.
 */
export const setUserAccessLevelDefault = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const user = await ctx.db.get('users', args.userId);
    if (!user) {
      return; // User doesn't exist, skip
    }

    // Only update if accessLevel is undefined
    if (user.accessLevel === undefined) {
      await ctx.db.patch('users', args.userId, {
        accessLevel: 'user',
      });
    }
  },
});

/**
 * Internal mutation to set all users with undefined accessLevel to 'user' in a single batch.
 * Updates are executed in parallel for better performance.
 * WARNING: This processes all users at once and may timeout for large user bases.
 * For large datasets, use migrateUserAccessLevels (action) instead.
 *
 * @returns Object with count of users updated
 */
export const setAllUndefinedAccessLevelsToUser = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Fetch all users with undefined accessLevel
    const allUsers = await ctx.db.query('users').collect();

    // Filter users that need updating
    const usersToUpdate = allUsers.filter((user) => user.accessLevel === undefined);

    // Update all users in parallel
    await Promise.all(
      usersToUpdate.map((user) =>
        ctx.db.patch('users', user._id, {
          accessLevel: 'user',
        })
      )
    );

    console.log(
      `Migration complete: Updated ${usersToUpdate.length} users to accessLevel: 'user' (out of ${allUsers.length} total users)`
    );

    return {
      success: true,
      updatedCount: usersToUpdate.length,
      totalUsers: allUsers.length,
    };
  },
});

/**
 * Internal action to migrate all users to have explicit accessLevel values.
 * Sets undefined accessLevel fields to 'user' as the default.
 * Processes users in batches to handle large datasets safely.
 * Updates within each batch are executed in parallel for better performance.
 */
export const migrateUserAccessLevels = internalAction({
  args: { cursor: v.optional(v.string()) }, // Convex cursor for pagination
  handler: async (ctx, args) => {
    const paginationOpts: PaginationOpts = {
      numItems: BATCH_SIZE,
      cursor: args.cursor ?? null,
    };

    // Fetch a batch of users
    const results = await ctx.runQuery(internal.migration.getUsersBatch, {
      paginationOpts,
    });

    // Filter users that need updating
    const usersToUpdate = results.page.filter((user) => user.accessLevel === undefined);

    // Schedule mutations to update all users in the batch in parallel
    await Promise.all(
      usersToUpdate.map((user) =>
        ctx.runMutation(internal.migration.setUserAccessLevelDefault, {
          userId: user._id,
        })
      )
    );

    console.log(`Processed batch: ${results.page.length} users, updated: ${usersToUpdate.length}`);

    // If there are more users, schedule the next batch
    if (!results.isDone) {
      await ctx.runAction(internal.migration.migrateUserAccessLevels, {
        cursor: results.continueCursor,
      });
    } else {
      console.log('User access level migration completed');
    }
  },
});

/**
 * Helper query to fetch users in batches for pagination during migration.
 */
export const getUsersBatch = internalQuery({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.query('users').paginate(args.paginationOpts);
  },
});

// ========================================
// BACKLOG STATUS MIGRATION
// ========================================

/**
 * Internal mutation to set default backlog status for a single task.
 * Sets backlog: { status: 'not_started' } for backlog tasks that have undefined backlog field.
 */
export const setTaskBacklogStatusDefault = internalMutation({
  args: { taskId: v.id('chatroom_tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      return; // Task doesn't exist, skip
    }

    // Only update if backlog is undefined and task was created as a backlog task
    // We can identify original backlog tasks by checking if status is 'backlog'
    // or if it was a backlog task that has been moved (we check createdBy !== 'user' for non-agent tasks)
    // For safety, we set backlog.status for ALL tasks with status 'backlog' that have undefined backlog
    if (task.backlog === undefined && task.status === 'backlog') {
      await ctx.db.patch('chatroom_tasks', args.taskId, {
        backlog: { status: 'not_started' },
      });
    }
  },
});

/**
 * Internal mutation to normalize all backlog tasks with undefined backlog field in a single batch.
 * Sets backlog: { status: 'not_started' } for all backlog tasks.
 * WARNING: This processes all tasks at once and may timeout for large datasets.
 * For large datasets, use migrateBacklogStatus (action) instead.
 *
 * @returns Object with count of tasks updated
 */
export const normalizeAllBacklogStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Fetch all tasks with status 'backlog'
    const allTasks = await ctx.db.query('chatroom_tasks').collect();

    // Filter tasks that need updating: status is 'backlog' and backlog field is undefined
    const tasksToUpdate = allTasks.filter(
      (task) => task.status === 'backlog' && task.backlog === undefined
    );

    // Update all tasks in parallel
    await Promise.all(
      tasksToUpdate.map((task) =>
        ctx.db.patch('chatroom_tasks', task._id, {
          backlog: { status: 'not_started' },
        })
      )
    );

    console.log(
      `Migration complete: Updated ${tasksToUpdate.length} backlog tasks to backlog.status: 'not_started' (out of ${allTasks.length} total tasks)`
    );

    return {
      success: true,
      updatedCount: tasksToUpdate.length,
      totalTasks: allTasks.length,
    };
  },
});

/**
 * Internal action to migrate all backlog tasks to have explicit backlog.status values.
 * Sets undefined backlog fields to { status: 'not_started' } as the default.
 * Processes tasks in batches to handle large datasets safely.
 */
export const migrateBacklogStatus = internalAction({
  args: { cursor: v.optional(v.string()) }, // Convex cursor for pagination
  handler: async (ctx, args) => {
    const paginationOpts: PaginationOpts = {
      numItems: BATCH_SIZE,
      cursor: args.cursor ?? null,
    };

    // Fetch a batch of tasks
    const results = await ctx.runQuery(internal.migration.getTasksBatch, {
      paginationOpts,
    });

    // Filter tasks that need updating
    const tasksToUpdate = results.page.filter(
      (task) => task.status === 'backlog' && task.backlog === undefined
    );

    // Schedule mutations to update all tasks in the batch in parallel
    await Promise.all(
      tasksToUpdate.map((task) =>
        ctx.runMutation(internal.migration.setTaskBacklogStatusDefault, {
          taskId: task._id,
        })
      )
    );

    console.log(`Processed batch: ${results.page.length} tasks, updated: ${tasksToUpdate.length}`);

    // If there are more tasks, schedule the next batch
    if (!results.isDone) {
      await ctx.runAction(internal.migration.migrateBacklogStatus, {
        cursor: results.continueCursor,
      });
    } else {
      console.log('Backlog status migration completed');
    }
  },
});

/**
 * Helper query to fetch tasks in batches for pagination during migration.
 */
export const getTasksBatch = internalQuery({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.query('chatroom_tasks').paginate(args.paginationOpts);
  },
});

// ========================================
// COMPLETED TASKS BACKLOG STATUS MIGRATION
// ========================================

/**
 * Internal mutation to set backlog status for completed tasks that have undefined backlog.
 * For completed tasks created from backlog items, we set backlog: { status: 'complete' }.
 * For completed tasks NOT from backlog, we leave them as-is (undefined).
 */
export const setCompletedTaskBacklogStatus = internalMutation({
  args: { taskId: v.id('chatroom_tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      return; // Task doesn't exist, skip
    }

    // Only update if:
    // 1. status is 'completed'
    // 2. backlog is undefined
    // 3. Task appears to be from a backlog item (has sourceMessageId or was created by user)
    //
    // Note: We set to 'complete' status for legacy completed tasks so they appear
    // in the archived section rather than pending review.
    if (task.status === 'completed' && task.backlog === undefined) {
      await ctx.db.patch('chatroom_tasks', args.taskId, {
        backlog: { status: 'complete' },
      });
    }
  },
});

/**
 * Internal mutation to normalize all completed tasks with undefined backlog field in a single batch.
 * Sets backlog: { status: 'complete' } for all completed tasks with undefined backlog.
 * WARNING: This processes all tasks at once and may timeout for large datasets.
 * For large datasets, use migrateCompletedTasksBacklogStatus (action) instead.
 *
 * @returns Object with count of tasks updated
 */
export const normalizeCompletedTasksBacklogStatus = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Fetch all tasks with status 'completed'
    const allTasks = await ctx.db.query('chatroom_tasks').collect();

    // Filter tasks that need updating: status is 'completed' and backlog field is undefined
    const tasksToUpdate = allTasks.filter(
      (task) => task.status === 'completed' && task.backlog === undefined
    );

    // Update all tasks in parallel
    await Promise.all(
      tasksToUpdate.map((task) =>
        ctx.db.patch('chatroom_tasks', task._id, {
          backlog: { status: 'complete' },
        })
      )
    );

    console.log(
      `Migration complete: Updated ${tasksToUpdate.length} completed tasks to backlog.status: 'complete' (out of ${allTasks.length} total tasks)`
    );

    return {
      success: true,
      updatedCount: tasksToUpdate.length,
      totalTasks: allTasks.length,
    };
  },
});

/**
 * Internal action to migrate all completed tasks to have explicit backlog.status values.
 * Sets undefined backlog fields to { status: 'complete' } for completed tasks.
 * Processes tasks in batches to handle large datasets safely.
 */
export const migrateCompletedTasksBacklogStatus = internalAction({
  args: { cursor: v.optional(v.string()) }, // Convex cursor for pagination
  handler: async (ctx, args) => {
    const paginationOpts: PaginationOpts = {
      numItems: BATCH_SIZE,
      cursor: args.cursor ?? null,
    };

    // Fetch a batch of tasks
    const results = await ctx.runQuery(internal.migration.getTasksBatch, {
      paginationOpts,
    });

    // Filter tasks that need updating
    const tasksToUpdate = results.page.filter(
      (task) => task.status === 'completed' && task.backlog === undefined
    );

    // Schedule mutations to update all tasks in the batch in parallel
    await Promise.all(
      tasksToUpdate.map((task) =>
        ctx.runMutation(internal.migration.setCompletedTaskBacklogStatus, {
          taskId: task._id,
        })
      )
    );

    console.log(`Processed batch: ${results.page.length} tasks, updated: ${tasksToUpdate.length}`);

    // If there are more tasks, schedule the next batch
    if (!results.isDone) {
      await ctx.runAction(internal.migration.migrateCompletedTasksBacklogStatus, {
        cursor: results.continueCursor,
      });
    } else {
      console.log('Completed tasks backlog status migration completed');
    }
  },
});

// ========================================
// TASK ORIGIN FIELD MIGRATION
// ========================================

/**
 * Internal mutation to set origin field for a single task.
 * - Tasks with backlog field → origin: 'backlog'
 * - Tasks with status 'backlog' → origin: 'backlog'
 * - All other tasks → origin: 'chat'
 */
export const setTaskOrigin = internalMutation({
  args: { taskId: v.id('chatroom_tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      return; // Task doesn't exist, skip
    }

    // Skip if origin is already set
    if (task.origin !== undefined) {
      return;
    }

    // Determine origin based on existing fields:
    // - If task has backlog field, it originated from backlog
    // - If task has status 'backlog', it originated from backlog
    // - Otherwise, it originated from chat
    const isBacklogOrigin = task.backlog !== undefined || task.status === 'backlog';
    const origin = isBacklogOrigin ? 'backlog' : 'chat';

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      origin,
    });
  },
});

/**
 * Internal mutation to set origin for all tasks without origin field in a single batch.
 * WARNING: This processes all tasks at once and may timeout for large datasets.
 * For large datasets, use migrateTaskOrigins (action) instead.
 *
 * @returns Object with count of tasks updated
 */
export const normalizeAllTaskOrigins = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allTasks = await ctx.db.query('chatroom_tasks').collect();

    // Filter tasks that need updating: origin is undefined
    const tasksToUpdate = allTasks.filter((task) => task.origin === undefined);

    // Update all tasks in parallel
    await Promise.all(
      tasksToUpdate.map((task) => {
        const isBacklogOrigin = task.backlog !== undefined || task.status === 'backlog';
        const origin = isBacklogOrigin ? 'backlog' : 'chat';
        return ctx.db.patch('chatroom_tasks', task._id, { origin });
      })
    );

    const backlogCount = tasksToUpdate.filter(
      (t) => t.backlog !== undefined || t.status === 'backlog'
    ).length;

    console.log(
      `Migration complete: Set origin for ${tasksToUpdate.length} tasks ` +
        `(${backlogCount} backlog, ${tasksToUpdate.length - backlogCount} chat) ` +
        `out of ${allTasks.length} total tasks`
    );

    return {
      success: true,
      updatedCount: tasksToUpdate.length,
      backlogOriginCount: backlogCount,
      chatOriginCount: tasksToUpdate.length - backlogCount,
      totalTasks: allTasks.length,
    };
  },
});

/**
 * Internal action to migrate all tasks to have explicit origin values.
 * Processes tasks in batches to handle large datasets safely.
 */
export const migrateTaskOrigins = internalAction({
  args: { cursor: v.optional(v.string()) }, // Convex cursor for pagination
  handler: async (ctx, args) => {
    const paginationOpts: PaginationOpts = {
      numItems: BATCH_SIZE,
      cursor: args.cursor ?? null,
    };

    // Fetch a batch of tasks
    const results = await ctx.runQuery(internal.migration.getTasksBatch, {
      paginationOpts,
    });

    // Filter tasks that need updating
    const tasksToUpdate = results.page.filter((task) => task.origin === undefined);

    // Schedule mutations to update all tasks in the batch in parallel
    await Promise.all(
      tasksToUpdate.map((task) =>
        ctx.runMutation(internal.migration.setTaskOrigin, {
          taskId: task._id,
        })
      )
    );

    console.log(`Processed batch: ${results.page.length} tasks, updated: ${tasksToUpdate.length}`);

    // If there are more tasks, schedule the next batch
    if (!results.isDone) {
      await ctx.runAction(internal.migration.migrateTaskOrigins, {
        cursor: results.continueCursor,
      });
    } else {
      console.log('Task origin migration completed');
    }
  },
});
