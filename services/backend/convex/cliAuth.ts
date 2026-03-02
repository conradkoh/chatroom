/** Device authorization flow for CLI authentication — creates requests, polls for approval, and manages sessions. */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';

// Auth request expires after 5 minutes
const AUTH_REQUEST_EXPIRY_MS = 5 * 60 * 1000;

// CLI session expires after 30 days (optional, can be null for no expiry)
const CLI_SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically random ID
 */
function generateId(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i]! % chars.length];
  }
  return result;
}

/** Creates a new CLI auth request and returns its ID and expiry. */
export const createAuthRequest = mutation({
  args: {
    deviceName: v.optional(v.string()),
    cliVersion: v.optional(v.string()),
  },
  returns: v.object({
    requestId: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const requestId = generateId(32);
    const expiresAt = now + AUTH_REQUEST_EXPIRY_MS;

    await ctx.db.insert('cliAuthRequests', {
      requestId,
      status: 'pending',
      deviceName: args.deviceName,
      cliVersion: args.cliVersion,
      createdAt: now,
      expiresAt,
    });

    return { requestId, expiresAt };
  },
});

/** Returns the current status of a CLI auth request. */
export const getAuthRequestStatus = query({
  args: {
    requestId: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal('pending'),
      expiresAt: v.number(),
    }),
    v.object({
      status: v.literal('approved'),
      sessionId: v.string(),
    }),
    v.object({
      status: v.literal('denied'),
    }),
    v.object({
      status: v.literal('expired'),
    }),
    v.object({
      status: v.literal('not_found'),
    })
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query('cliAuthRequests')
      .withIndex('by_requestId', (q) => q.eq('requestId', args.requestId))
      .unique();

    if (!request) {
      return { status: 'not_found' as const };
    }

    // Check if expired
    if (request.status === 'pending' && Date.now() > request.expiresAt) {
      return { status: 'expired' as const };
    }

    if (request.status === 'approved' && request.sessionId) {
      return {
        status: 'approved' as const,
        sessionId: request.sessionId,
      };
    }

    if (request.status === 'denied') {
      return { status: 'denied' as const };
    }

    if (request.status === 'expired') {
      return { status: 'expired' as const };
    }

    return {
      status: 'pending' as const,
      expiresAt: request.expiresAt,
    };
  },
});

/** Returns the details of a CLI auth request for display on the approval page. */
export const getAuthRequestDetails = query({
  args: {
    requestId: v.string(),
  },
  returns: v.union(
    v.object({
      found: v.literal(true),
      status: v.string(),
      deviceName: v.optional(v.string()),
      cliVersion: v.optional(v.string()),
      createdAt: v.number(),
      expiresAt: v.number(),
      isExpired: v.boolean(),
    }),
    v.object({
      found: v.literal(false),
    })
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query('cliAuthRequests')
      .withIndex('by_requestId', (q) => q.eq('requestId', args.requestId))
      .unique();

    if (!request) {
      return { found: false as const };
    }

    return {
      found: true as const,
      status: request.status,
      deviceName: request.deviceName,
      cliVersion: request.cliVersion,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      isExpired: Date.now() > request.expiresAt,
    };
  },
});

/** Approves a CLI auth request and generates a CLI session for the authenticated user. */
export const approveAuthRequest = mutation({
  args: {
    requestId: v.string(),
    ...SessionIdArg, // The user's web session ID for auth verification
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Verify the user is authenticated
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .unique();

    if (!session) {
      return { success: false as const, error: 'Not authenticated' };
    }

    // Get the auth request
    const request = await ctx.db
      .query('cliAuthRequests')
      .withIndex('by_requestId', (q) => q.eq('requestId', args.requestId))
      .unique();

    if (!request) {
      return { success: false as const, error: 'Auth request not found' };
    }

    if (request.status !== 'pending') {
      return { success: false as const, error: `Auth request already ${request.status}` };
    }

    if (Date.now() > request.expiresAt) {
      // Mark as expired
      await ctx.db.patch('cliAuthRequests', request._id, { status: 'expired' });
      return { success: false as const, error: 'Auth request expired' };
    }

    // Generate CLI session
    const now = Date.now();
    const cliSessionId = generateId(64);

    // Create CLI session
    await ctx.db.insert('cliSessions', {
      sessionId: cliSessionId,
      userId: session.userId,
      isActive: true,
      deviceName: request.deviceName,
      cliVersion: request.cliVersion,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + CLI_SESSION_EXPIRY_MS,
    });

    // Update auth request
    await ctx.db.patch('cliAuthRequests', request._id, {
      status: 'approved',
      sessionId: cliSessionId,
      approvedBy: session.userId,
      approvedAt: now,
    });

    return { success: true as const };
  },
});

/** Denies a pending CLI auth request. */
export const denyAuthRequest = mutation({
  args: {
    requestId: v.string(),
    ...SessionIdArg, // The user's web session ID for auth verification
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Verify the user is authenticated
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .unique();

    if (!session) {
      return { success: false as const, error: 'Not authenticated' };
    }

    // Get the auth request
    const request = await ctx.db
      .query('cliAuthRequests')
      .withIndex('by_requestId', (q) => q.eq('requestId', args.requestId))
      .unique();

    if (!request) {
      return { success: false as const, error: 'Auth request not found' };
    }

    if (request.status !== 'pending') {
      return { success: false as const, error: `Auth request already ${request.status}` };
    }

    // Update auth request
    await ctx.db.patch('cliAuthRequests', request._id, {
      status: 'denied',
    });

    return { success: true as const };
  },
});

/** Validates a CLI session and returns user information if active. */
export const validateSession = query({
  args: {
    ...SessionIdArg,
  },
  returns: v.union(
    v.object({
      valid: v.literal(true),
      userId: v.string(),
      userName: v.optional(v.string()),
    }),
    v.object({
      valid: v.literal(false),
      reason: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('cliSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .unique();

    if (!session) {
      return { valid: false as const, reason: 'Session not found' };
    }

    if (!session.isActive) {
      return { valid: false as const, reason: 'Session revoked' };
    }

    if (session.expiresAt && Date.now() > session.expiresAt) {
      return { valid: false as const, reason: 'Session expired' };
    }

    // Get user info
    const user = await ctx.db.get('users', session.userId);
    if (!user) {
      return { valid: false as const, reason: 'User not found' };
    }

    return {
      valid: true as const,
      userId: session.userId,
      userName: user.name,
    };
  },
});

/** Updates lastUsedAt and extends the expiry of a CLI session (sliding window). */
export const touchSession = mutation({
  args: {
    ...SessionIdArg,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('cliSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .unique();

    if (!session || !session.isActive) {
      return false;
    }

    await ctx.db.patch('cliSessions', session._id, {
      lastUsedAt: Date.now(),
      // Extend expiry on each touch (sliding window) so active sessions
      // never expire while in use. The fixed creation-time expiry was
      // causing daemon sessions to silently die after 30 days.
      expiresAt: Date.now() + CLI_SESSION_EXPIRY_MS,
    });

    return true;
  },
});

/** Revokes a CLI session, preventing further use. */
export const revokeSession = mutation({
  args: {
    cliSessionId: v.string(),
    webSessionId: v.string(), // The user's web session ID for auth verification
    reason: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Verify the user is authenticated
    const webSession = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.webSessionId))
      .unique();

    if (!webSession) {
      return { success: false as const, error: 'Not authenticated' };
    }

    // Get the CLI session
    const cliSession = await ctx.db
      .query('cliSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.cliSessionId))
      .unique();

    if (!cliSession) {
      return { success: false as const, error: 'CLI session not found' };
    }

    // Verify ownership
    if (cliSession.userId !== webSession.userId) {
      return { success: false as const, error: 'Not authorized to revoke this session' };
    }

    // Revoke the session
    await ctx.db.patch('cliSessions', cliSession._id, {
      isActive: false,
      revokedAt: Date.now(),
      revokedReason: args.reason || 'Manually revoked',
    });

    return { success: true as const };
  },
});

/** Returns all CLI sessions for the authenticated user. */
export const listUserSessions = query({
  args: {
    ...SessionIdArg, // The user's web session ID for auth verification
  },
  returns: v.array(
    v.object({
      sessionId: v.string(),
      deviceName: v.optional(v.string()),
      cliVersion: v.optional(v.string()),
      createdAt: v.number(),
      lastUsedAt: v.number(),
      isActive: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    // Verify the user is authenticated
    const webSession = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .unique();

    if (!webSession) {
      return [];
    }

    // Get all CLI sessions for this user
    const sessions = await ctx.db
      .query('cliSessions')
      .withIndex('by_userId', (q) => q.eq('userId', webSession.userId))
      .collect();

    return sessions.map((s) => ({
      sessionId: s.sessionId,
      deviceName: s.deviceName,
      cliVersion: s.cliVersion,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      isActive: s.isActive,
    }));
  },
});
