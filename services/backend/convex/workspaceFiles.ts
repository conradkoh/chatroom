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
    treeJson: v.optional(v.string()),
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
    const contentToCheck = args.treeJsonCompressed ?? args.treeJson;
    if (!contentToCheck) {
      throw new Error('Either treeJson or treeJsonCompressed must be provided');
    }
    const sizeToCheck = new TextEncoder().encode(contentToCheck).length;
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
      treeHash: args.treeHash,
      scannedAt: args.scannedAt,
    };

    // Store compressed data when provided (preferred)
    if (args.treeJsonCompressed && args.compression) {
      data.treeJsonCompressed = args.treeJsonCompressed;
      data.compression = args.compression;
      // Store uncompressed too if provided (backward compat)
      if (args.treeJson) {
        data.treeJson = args.treeJson;
      }
    } else if (args.treeJson) {
      // Legacy path: uncompressed only
      data.treeJson = args.treeJson;
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
      treeJson: tree.treeJson ?? '',
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
      content: content.content ?? '',
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
    content: v.optional(v.string()),
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
    const contentToCheck = args.contentCompressed ?? args.content;
    if (!contentToCheck) {
      throw new Error('Either content or contentCompressed must be provided');
    }
    if (args.content && new TextEncoder().encode(args.content).length > MAX_CONTENT_BYTES) {
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
      encoding: args.encoding,
      truncated: args.truncated,
      fetchedAt: now,
    };

    // Store compressed data when provided (preferred)
    if (args.contentCompressed && args.compression) {
      data.contentCompressed = args.contentCompressed;
      data.compression = args.compression;
      // Store uncompressed too if provided (backward compat)
      if (args.content) {
        data.content = args.content;
      }
    } else if (args.content) {
      // Legacy path: uncompressed only
      data.content = args.content;
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

// ═══════════════════════════════════════════════════════════════════════════════
// V2 Functions — Compressed-Only
// ═══════════════════════════════════════════════════════════════════════════════
// These functions read/write the v2 tables which use a single `data` field
// (always base64-encoded gzip). No raw/compressed branching.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── File Tree Sync V2 (daemon → backend) ───────────────────────────────────

/**
 * Upserts the file tree for a workspace (v2, compressed only).
 * `data` is always base64-encoded gzip of FileTree JSON.
 * Dedup: skip write if `dataHash` matches existing row.
 */
export const syncFileTreeV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    /** Base64-encoded gzip of FileTree JSON. */
    data: v.string(),
    /** Hash of uncompressed data for server-side dedup. */
    dataHash: v.string(),
    scannedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Validate size
    const sizeBytes = new TextEncoder().encode(args.data).length;
    if (sizeBytes > MAX_TREE_JSON_BYTES) {
      throw new Error('File tree too large');
    }

    const existing = await ctx.db
      .query('chatroom_workspaceFileTreeV2')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    // Server-side dedup: skip write if hash unchanged
    if (existing && existing.dataHash === args.dataHash) {
      return;
    }

    const row = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      data: args.data,
      dataHash: args.dataHash,
      scannedAt: args.scannedAt,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert('chatroom_workspaceFileTreeV2', row);
    }
  },
});

// ─── File Tree Query V2 (frontend) ──────────────────────────────────────────

/**
 * Returns the file tree for a workspace (v2, compressed only).
 * Returns `{ data, scannedAt }` or null.
 */
export const getFileTreeV2 = query({
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
      .query('chatroom_workspaceFileTreeV2')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (!tree) {
      return null;
    }

    return {
      data: tree.data,
      scannedAt: tree.scannedAt,
    };
  },
});

// ─── Daemon: Fulfill File Content V2 ────────────────────────────────────────

/**
 * Uploads file content from the daemon (v2, compressed only).
 * `data` is always base64-encoded gzip of the file content.
 * Upserts content and marks any pending request as done.
 */
export const fulfillFileContentV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),
    /** Base64-encoded gzip of the file content. */
    data: v.string(),
    encoding: v.string(),
    truncated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Validate size
    if (new TextEncoder().encode(args.data).length > MAX_CONTENT_BYTES) {
      throw new Error('File content too large');
    }

    // Validate file path
    validateFilePath(args.filePath);

    const now = Date.now();

    // Upsert file content
    const existing = await ctx.db
      .query('chatroom_workspaceFileContentV2')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    const row = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      filePath: args.filePath,
      data: args.data,
      encoding: args.encoding,
      truncated: args.truncated,
      fetchedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert('chatroom_workspaceFileContentV2', row);
    }

    // Mark request as done (requests table is shared, not v2-specific)
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

// ─── File Content Query V2 (frontend) ───────────────────────────────────────

/**
 * Returns file content for a specific file (v2, compressed only).
 * Returns `{ data, encoding, truncated, fetchedAt }` or null.
 */
export const getFileContentV2 = query({
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
      .query('chatroom_workspaceFileContentV2')
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
      data: content.data,
      encoding: content.encoding,
      truncated: content.truncated,
      fetchedAt: content.fetchedAt,
    };
  },
});
