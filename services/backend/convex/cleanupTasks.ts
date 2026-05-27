import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

// Public interfaces and types
export interface CleanupResult {
  success: boolean;
  deletedCount: number;
}

export interface LoginRequestsCleanupResult extends CleanupResult {
  deletedLoginCount: number;
  deletedConnectCount: number;
}

export interface AllCleanupResults {
  success: boolean;
  results: {
    loginRequests: LoginRequestsCleanupResult;
    loginCodes: CleanupResult;
    loginAttempts: CleanupResult;
  };
}

/**
 * Cleanup task for expired login requests.
 * This can be called periodically to clean up expired OAuth login requests.
 */
export const cleanupExpiredLoginRequests = internalMutation({
  args: {},
  handler: async (ctx, _args): Promise<LoginRequestsCleanupResult> => {
    const now = Date.now();

    // Find expired login requests that haven't been completed
    const expiredLoginRequests = await ctx.db
      .query('auth_loginRequests')
      .filter((q) => q.and(q.lt(q.field('expiresAt'), now), q.neq(q.field('status'), 'completed')))
      .collect();

    // Find expired connect requests that haven't been completed
    const expiredConnectRequests = await ctx.db
      .query('auth_connectRequests')
      .filter((q) => q.and(q.lt(q.field('expiresAt'), now), q.neq(q.field('status'), 'completed')))
      .collect();

    // Delete expired login requests
    let deletedLoginCount = 0;
    for (const request of expiredLoginRequests) {
      await ctx.db.delete('auth_loginRequests', request._id);
      deletedLoginCount++;
    }

    // Delete expired connect requests
    let deletedConnectCount = 0;
    for (const request of expiredConnectRequests) {
      await ctx.db.delete('auth_connectRequests', request._id);
      deletedConnectCount++;
    }

    const totalDeleted = deletedLoginCount + deletedConnectCount;

    return {
      success: true,
      deletedCount: totalDeleted,
      deletedLoginCount,
      deletedConnectCount,
    };
  },
});

/**
 * Cleanup task for expired connect requests.
 * This can be called periodically to clean up expired OAuth connect requests.
 *
 * @deprecated Use cleanupExpiredLoginRequests instead - it now handles both login and connect requests
 */
export const cleanupExpiredConnectRequests = internalMutation({
  args: {},
  handler: async (ctx, _args): Promise<CleanupResult> => {
    const now = Date.now();

    // Find expired connect requests that haven't been completed
    const expiredConnectRequests = await ctx.db
      .query('auth_connectRequests')
      .filter((q) => q.and(q.lt(q.field('expiresAt'), now), q.neq(q.field('status'), 'completed')))
      .collect();

    // Delete expired connect requests
    let deletedCount = 0;
    for (const request of expiredConnectRequests) {
      await ctx.db.delete('auth_connectRequests', request._id);
      deletedCount++;
    }

    return {
      success: true,
      deletedCount,
    };
  },
});

/**
 * Cleanup task for expired login codes.
 * This can be called periodically to clean up expired login codes.
 */
export const cleanupExpiredLoginCodes = internalMutation({
  args: {},
  handler: async (ctx, _args): Promise<CleanupResult> => {
    const now = Date.now();

    // Find expired login codes
    const expiredCodes = await ctx.db
      .query('loginCodes')
      .filter((q) => q.lt(q.field('expiresAt'), now))
      .collect();

    // Delete expired codes
    let deletedCount = 0;
    for (const code of expiredCodes) {
      await ctx.db.delete('loginCodes', code._id);
      deletedCount++;
    }

    return {
      success: true,
      deletedCount,
    };
  },
});

/**
 * Cleanup task for old login attempt records.
 * Removes records where the lockout has expired and the attempt window has passed.
 */
export const cleanupOldLoginAttempts = internalMutation({
  args: {},
  handler: async (ctx, _args): Promise<CleanupResult> => {
    const now = Date.now();
    // Clean up attempts older than 1 hour (well past any lockout or attempt window)
    const cleanupThreshold = now - 60 * 60 * 1000; // 1 hour

    // Find old login attempt records
    const oldAttempts = await ctx.db
      .query('loginAttempts')
      .filter((q) =>
        q.and(
          q.lt(q.field('lastAttemptAt'), cleanupThreshold),
          q.or(q.eq(q.field('lockedUntil'), undefined), q.lt(q.field('lockedUntil'), now))
        )
      )
      .collect();

    // Delete old attempt records
    let deletedCount = 0;
    for (const attempt of oldAttempts) {
      await ctx.db.delete('loginAttempts', attempt._id);
      deletedCount++;
    }

    return {
      success: true,
      deletedCount,
    };
  },
});

/**
 * Master cleanup function that runs all cleanup tasks.
 */
export const runAllCleanupTasks = internalMutation({
  args: {},
  handler: async (ctx, _args): Promise<AllCleanupResults> => {
    const results = {
      loginRequests: await ctx.runMutation(internal.cleanupTasks.cleanupExpiredLoginRequests, {}),
      loginCodes: await ctx.runMutation(internal.cleanupTasks.cleanupExpiredLoginCodes, {}),
      loginAttempts: await ctx.runMutation(internal.cleanupTasks.cleanupOldLoginAttempts, {}),
    };

    return {
      success: true,
      results,
    };
  },
});

// Internal helper functions
/**
 * Registers cron jobs for automatic cleanup of expired authentication data.
 */
const _registerCleanupCronJobs = (): typeof cleanupCronJobs => {
  const cleanupCronJobs = cronJobs();

  // Run cleanup every 10 minutes
  cleanupCronJobs.interval(
    'cleanup expired auth data',
    { minutes: 10 },
    internal.cleanupTasks.runAllCleanupTasks
  );

  return cleanupCronJobs;
};

// Register cron jobs for automatic cleanup
const cleanupCronJobs = _registerCleanupCronJobs();

export default cleanupCronJobs;
