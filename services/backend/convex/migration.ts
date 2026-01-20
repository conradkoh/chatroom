import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';

const BATCH_SIZE = 100; // Process 100 items per batch

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
// TASK ORIGIN FIELD MIGRATION
// ========================================

/**
 * Internal mutation to set origin field for a single task.
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

    // Determine origin based on status - backlog status means backlog origin
    const origin = task.status === 'backlog' ? 'backlog' : 'chat';

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
        const origin = task.status === 'backlog' ? 'backlog' : 'chat';
        return ctx.db.patch('chatroom_tasks', task._id, { origin });
      })
    );

    const backlogCount = tasksToUpdate.filter((t) => t.status === 'backlog').length;

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
// LEGACY FIELD CLEANUP MIGRATION
// ========================================

/**
 * Internal mutation to clean up legacy fields from a single task.
 * - Removes the deprecated 'backlog' field
 * - Changes status 'cancelled' to 'closed'
 */
export const cleanupTaskLegacyFields = internalMutation({
  args: { taskId: v.id('chatroom_tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      return { updated: false }; // Task doesn't exist, skip
    }

    const updates: Record<string, unknown> = {};

    // Remove backlog field if present
    if (task.backlog !== undefined) {
      updates.backlog = undefined;
    }

    // Change cancelled to closed
    if (task.status === 'cancelled') {
      updates.status = 'closed';
    }

    // Only patch if there are updates
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch('chatroom_tasks', args.taskId, updates);
      return {
        updated: true,
        removedBacklog: task.backlog !== undefined,
        changedStatus: task.status === 'cancelled',
      };
    }

    return { updated: false };
  },
});

/**
 * Internal mutation to clean up legacy fields from all tasks in a single batch.
 * - Removes the deprecated 'backlog' field
 * - Changes status 'cancelled' to 'closed'
 *
 * WARNING: This processes all tasks at once and may timeout for large datasets.
 * For large datasets, use migrateCleanupLegacyFields (action) instead.
 *
 * @returns Object with counts of tasks updated
 */
export const cleanupAllTaskLegacyFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allTasks = await ctx.db.query('chatroom_tasks').collect();

    let backlogFieldsRemoved = 0;
    let cancelledToClosedChanged = 0;

    // Update all tasks that need cleanup
    await Promise.all(
      allTasks.map(async (task) => {
        const updates: Record<string, unknown> = {};

        // Remove backlog field if present
        if (task.backlog !== undefined) {
          updates.backlog = undefined;
          backlogFieldsRemoved++;
        }

        // Change cancelled to closed
        if (task.status === 'cancelled') {
          updates.status = 'closed';
          cancelledToClosedChanged++;
        }

        // Only patch if there are updates
        if (Object.keys(updates).length > 0) {
          await ctx.db.patch('chatroom_tasks', task._id, updates);
        }
      })
    );

    console.log(
      `Migration complete: Processed ${allTasks.length} tasks. ` +
        `Removed backlog field from ${backlogFieldsRemoved} tasks. ` +
        `Changed cancelled→closed for ${cancelledToClosedChanged} tasks.`
    );

    return {
      success: true,
      totalTasks: allTasks.length,
      backlogFieldsRemoved,
      cancelledToClosedChanged,
    };
  },
});

/**
 * Internal action to clean up legacy fields from all tasks.
 * Processes tasks in batches to handle large datasets safely.
 */
export const migrateCleanupLegacyFields = internalAction({
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
      (task) => task.backlog !== undefined || task.status === 'cancelled'
    );

    // Schedule mutations to update all tasks in the batch in parallel
    await Promise.all(
      tasksToUpdate.map((task) =>
        ctx.runMutation(internal.migration.cleanupTaskLegacyFields, {
          taskId: task._id,
        })
      )
    );

    console.log(
      `Processed batch: ${results.page.length} tasks, cleaned up: ${tasksToUpdate.length}`
    );

    // If there are more tasks, schedule the next batch
    if (!results.isDone) {
      await ctx.runAction(internal.migration.migrateCleanupLegacyFields, {
        cursor: results.continueCursor,
      });
    } else {
      console.log('Legacy field cleanup migration completed');
    }
  },
});
