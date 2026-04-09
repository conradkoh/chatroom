/**
 * Convex functions for workspace file tree and on-demand file content.
 *
 * - File tree: daemon syncs a JSON blob of the file tree per workspace
 * - File content: frontend requests content; daemon fulfills; cached in DB
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import type { QueryCtx, MutationCtx } from './_generated/server';
import { getAuthenticatedUser } from './auth/authenticatedUser';
import { requireAccess } from './auth/accessCheck';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max treeJson size: 900KB (stay under Convex's 1MB document limit). */
const MAX_TREE_JSON_BYTES = 900 * 1024;

/** Max file content size: 512KB. */
const MAX_CONTENT_BYTES = 512 * 1024;

/** Max pending requests returned per query (prevent unbounded reads). */
const MAX_PENDING_REQUESTS = 50;

/** Max file path length to prevent abuse. */
const MAX_FILE_PATH_LENGTH = 1024;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Verify that the authenticated user owns the given machine.
 * Used as fallback for endpoints called before workspace registration.
 */

/**
 * Check chatroom-based access for a machine.
 * Falls back to direct machine ownership for daemon calls
 * where the machine may not yet have workspace registrations.
 */
async function requireMachineAccess(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: any
): Promise<void> {
  // write-access includes owner fallback — a machine owner always has at least write-access
  await requireAccess(ctx, {
    accessor: { type: 'user', id: userId },
    resource: { type: 'machine', id: machineId },
    permission: 'write-access',
  });
}

/**
 * Validate a file path for security.
 * Rejects path traversal, absolute paths, null bytes, and overly long paths.
 */
function validateFilePath(filePath: string): void {
  if (filePath.length > MAX_FILE_PATH_LENGTH) {
    throw new Error('File path too long');
  }
  if (filePath.includes('..')) {
    throw new Error('Invalid file path: path traversal not allowed');
  }
  if (filePath.startsWith('/')) {
    throw new Error('Invalid file path: absolute paths not allowed');
  }
  if (filePath.includes('\0')) {
    throw new Error('Invalid file path: null bytes not allowed');
  }
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
    treeJsonCompressed: v.optional(v.string()),
    compression: v.optional(v.literal('gzip')),
    treeHash: v.optional(v.string()),
    scannedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Validate size: use compressed size if available, otherwise raw treeJson
    const sizeToCheck = args.treeJsonCompressed
      ? new TextEncoder().encode(args.treeJsonCompressed).length
      : new TextEncoder().encode(args.treeJson).length;
    if (sizeToCheck > MAX_TREE_JSON_BYTES) {
      throw new Error('File tree too large');
    }

    const existing = await ctx.db
      .query('chatroom_workspaceFileTree')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    // Server-side dedup: skip write if tree content hasn't changed
    // Hash is based on original content, not compressed
    if (existing && args.treeHash && existing.treeHash === args.treeHash) {
      return; // No change — skip write
    }

    const data: Record<string, unknown> = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      treeJson: args.treeJson,
      treeHash: args.treeHash,
      scannedAt: args.scannedAt,
    };

    // Store compressed data when provided
    if (args.treeJsonCompressed && args.compression) {
      data.treeJsonCompressed = args.treeJsonCompressed;
      data.compression = args.compression;
    } else {
      // Clear compressed fields if switching back to uncompressed
      data.treeJsonCompressed = undefined;
      data.compression = undefined;
    }

    if (existing) {
      await ctx.db.patch(existing._id, data as any);
    } else {
      await ctx.db.insert('chatroom_workspaceFileTree', data as any);
    }
  },
});

// ─── File Tree Query (frontend) ─────────────────────────────────────────────

/**
 * Returns the file tree for a workspace.
 * Auth-gated: verifies chatroom membership.
 */
export const getFileTree = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      return null;
    }

    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
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

    // Return compressed data when available, otherwise uncompressed
    if (tree.compression && tree.treeJsonCompressed) {
      return {
        treeJsonCompressed: tree.treeJsonCompressed,
        compression: tree.compression,
        scannedAt: tree.scannedAt,
      };
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
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Security: validate file path
    validateFilePath(args.filePath);

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
    if (!auth.ok) {
      return null;
    }

    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
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

    // Return all fields — compressed data alongside regular fields for backward compat
    return {
      content: content.content,
      encoding: content.encoding,
      truncated: content.truncated,
      fetchedAt: content.fetchedAt,
      ...(content.compression && content.contentCompressed
        ? { contentCompressed: content.contentCompressed, compression: content.compression }
        : {}),
    };
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
    if (!auth.ok) {
      return [];
    }

    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return [];
    }

    const requests = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_status', (q: any) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .take(MAX_PENDING_REQUESTS);

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
    contentCompressed: v.optional(v.string()),
    compression: v.optional(v.literal('gzip')),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Validate content size
    if (new TextEncoder().encode(args.content).length > MAX_CONTENT_BYTES) {
      throw new Error('File content too large');
    }

    // Validate file path
    validateFilePath(args.filePath);

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

    const data: Record<string, unknown> = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      filePath: args.filePath,
      content: args.content,
      encoding: args.encoding,
      truncated: args.truncated,
      fetchedAt: now,
    };

    // Store compressed data when provided
    if (args.contentCompressed && args.compression) {
      data.contentCompressed = args.contentCompressed;
      data.compression = args.compression;
    } else {
      // Clear compressed fields if switching back to uncompressed
      data.contentCompressed = undefined;
      data.compression = undefined;
    }

    if (existing) {
      await ctx.db.patch(existing._id, data as any);
    } else {
      await ctx.db.insert('chatroom_workspaceFileContent', data as any);
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

// ─── File Tree Request (frontend → daemon) ──────────────────────────────────

/** Staleness window: don't re-request if tree is fresher than this. */
const FILE_TREE_STALENESS_MS = 10 * 1000; // 10 seconds

/**
 * Requests a fresh file tree scan for a workspace.
 * Returns 'cached' if the tree is fresh, 'pending' if already requested,
 * or 'requested' if a new request was created.
 */
export const requestFileTree = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Check if existing tree is fresh enough
    const existingTree = await ctx.db
      .query('chatroom_workspaceFileTree')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (existingTree && Date.now() - existingTree.scannedAt < FILE_TREE_STALENESS_MS) {
      return { status: 'cached' as const };
    }

    // Check for existing pending request
    const existingRequest = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (existingRequest && existingRequest.status === 'pending') {
      return { status: 'pending' as const };
    }

    const now = Date.now();

    if (existingRequest) {
      await ctx.db.patch(existingRequest._id, {
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_workspaceFileTreeRequests', {
        machineId: args.machineId,
        workingDir: args.workingDir,
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    }

    return { status: 'requested' as const };
  },
});

// ─── Daemon: Pending File Tree Requests ─────────────────────────────────────

/**
 * Returns pending file tree requests for a machine.
 * Daemon subscribes to this reactively.
 */
export const getPendingFileTreeRequests = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      return [];
    }

    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return [];
    }

    const requests = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_status', (q: any) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .take(MAX_PENDING_REQUESTS);

    return requests.map((r) => ({
      _id: r._id,
      workingDir: r.workingDir,
    }));
  },
});

// ─── Daemon: Fulfill File Tree Request ──────────────────────────────────────

/**
 * Marks a file tree request as fulfilled.
 * Called by the daemon after scanning and uploading the tree via syncFileTree.
 */
export const fulfillFileTreeRequest = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    const request = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (request) {
      await ctx.db.patch(request._id, {
        status: 'done',
        updatedAt: Date.now(),
      });
    }
  },
});

// ─── Purge Workspace Data ───────────────────────────────────────────────────

/**
 * Purge file tree data for a specific workspace (machineId + workingDir).
 * Deletes the stored tree and any pending requests.
 */
export const purgeFileTree = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Delete stored file tree
    const tree = await ctx.db
      .query('chatroom_workspaceFileTree')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();
    if (tree) {
      await ctx.db.delete(tree._id);
    }

    // Delete pending requests
    const requests = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const req of requests) {
      await ctx.db.delete(req._id);
    }

    // Delete file content cache
    const contents = await ctx.db
      .query('chatroom_workspaceFileContent')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const content of contents) {
      await ctx.db.delete(content._id);
    }

    // Delete file content requests (uses different index)
    const contentRequests = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_status', (q: any) =>
        q.eq('machineId', args.machineId)
      )
      .filter((q: any) => q.eq(q.field('workingDir'), args.workingDir))
      .collect();
    for (const req of contentRequests) {
      await ctx.db.delete(req._id);
    }
  },
});
