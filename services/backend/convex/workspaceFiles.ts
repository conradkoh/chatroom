/**
 * Convex functions for workspace file tree and on-demand file content.
 *
 * - File tree: daemon syncs a JSON blob of the file tree per workspace
 * - File content: frontend requests content; daemon fulfills; cached in DB
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internalMutation, mutation, query } from './_generated/server';
import type { QueryCtx, MutationCtx } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<{ isAuthenticated: true; userId: any } | { isAuthenticated: false }> {
  const result = await validateSession(ctx, sessionId);
  if (!result.valid) {
    return { isAuthenticated: false };
  }
  return { isAuthenticated: true, userId: result.userId };
}

// ─── File Tree Sync (daemon → backend) ──────────────────────────────────────

/**
 * Upserts the file tree for a workspace.
 * Called by the daemon after scanning the working directory.
 */
export const syncFileTree = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    treeJson: v.string(),
    scannedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    const existing = await ctx.db
      .query('chatroom_workspaceFileTree')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    const data = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      treeJson: args.treeJson,
      scannedAt: args.scannedAt,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert('chatroom_workspaceFileTree', data);
    }
  },
});

// ─── File Tree Query (frontend) ─────────────────────────────────────────────

/**
 * Returns the file tree for a workspace.
 * Auth-gated: verifies user owns the machine.
 */
export const getFileTree = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return null;
    }

    // Verify machine ownership
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q: any) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.userId) {
      return null;
    }

    const tree = await ctx.db
      .query('chatroom_workspaceFileTree')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (!tree) {
      return null;
    }

    return {
      treeJson: tree.treeJson,
      scannedAt: tree.scannedAt,
    };
  },
});

// ─── File Content Request (frontend → daemon) ──────────────────────────────

/**
 * Requests file content for a specific file.
 * Returns cached content if fresh, otherwise creates a pending request.
 */
export const requestFileContent = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    // Security: prevent path traversal
    if (args.filePath.includes('..') || args.filePath.startsWith('/')) {
      throw new Error('Invalid file path');
    }

    // Check for cached content (fresh if < 5 minutes old)
    const cached = await ctx.db
      .query('chatroom_workspaceFileContent')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    const FIVE_MINUTES = 5 * 60 * 1000;
    if (cached && Date.now() - cached.fetchedAt < FIVE_MINUTES) {
      return { status: 'cached' as const };
    }

    // Check for existing pending request
    const existingRequest = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    if (existingRequest && existingRequest.status === 'pending') {
      return { status: 'pending' as const };
    }

    const now = Date.now();

    if (existingRequest) {
      // Re-use existing request row
      await ctx.db.patch(existingRequest._id, {
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_workspaceFileContentRequests', {
        machineId: args.machineId,
        workingDir: args.workingDir,
        filePath: args.filePath,
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    }

    return { status: 'requested' as const };
  },
});

// ─── File Content Query (frontend) ──────────────────────────────────────────

/**
 * Returns cached file content if available.
 */
export const getFileContent = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return null;
    }

    // Verify machine ownership
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q: any) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.userId) {
      return null;
    }

    const content = await ctx.db
      .query('chatroom_workspaceFileContent')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    if (!content) {
      return null;
    }

    return {
      content: content.content,
      encoding: content.encoding,
      truncated: content.truncated,
      fetchedAt: content.fetchedAt,
    };
  },
});

// ─── File Content Upload (daemon → backend) ─────────────────────────────────

/**
 * Uploads file content from the daemon.
 * Internal mutation — called by daemon after reading the file.
 */
export const uploadFileContent = internalMutation({
  args: {
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),
    content: v.string(),
    encoding: v.string(),
    truncated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Upsert file content
    const existing = await ctx.db
      .query('chatroom_workspaceFileContent')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    const data = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      filePath: args.filePath,
      content: args.content,
      encoding: args.encoding,
      truncated: args.truncated,
      fetchedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert('chatroom_workspaceFileContent', data);
    }

    // Mark the request as done
    const request = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    if (request) {
      await ctx.db.patch(request._id, {
        status: 'done',
        updatedAt: now,
      });
    }
  },
});

// ─── Daemon: Pending File Content Requests ──────────────────────────────────

/**
 * Returns pending file content requests for a machine.
 * Daemon polls this to discover what files to read.
 */
export const getPendingFileContentRequests = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      return [];
    }

    const requests = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_status', (q: any) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .collect();

    return requests.map((r) => ({
      _id: r._id,
      workingDir: r.workingDir,
      filePath: r.filePath,
    }));
  },
});

// ─── Daemon: Fulfill File Content ───────────────────────────────────────────

/**
 * Uploads file content from the daemon (session-authed).
 * Upserts content and marks the request as done.
 */
export const fulfillFileContent = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),
    content: v.string(),
    encoding: v.string(),
    truncated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.isAuthenticated) {
      throw new Error('Authentication required');
    }

    const now = Date.now();

    // Upsert file content
    const existing = await ctx.db
      .query('chatroom_workspaceFileContent')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    const data = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      filePath: args.filePath,
      content: args.content,
      encoding: args.encoding,
      truncated: args.truncated,
      fetchedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert('chatroom_workspaceFileContent', data);
    }

    // Mark request as done
    const request = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    if (request) {
      await ctx.db.patch(request._id, {
        status: 'done' as const,
        updatedAt: now,
      });
    }
  },
});
