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
import { getSession } from './auth/session';
import { requireAccess } from '../modules/auth/accessCheck';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max treeJson size: 900KB (stay under Convex's 1MB document limit). */
const MAX_TREE_JSON_BYTES = 900 * 1024;

/** Max file content size: 512KB. */
const MAX_CONTENT_BYTES = 512 * 1024;

/** Max pending requests returned per query (prevent unbounded reads). */
const MAX_PENDING_REQUESTS = 50;

/** Max file path length to prevent abuse. */
const MAX_FILE_PATH_LENGTH = 1024;

const MAX_DIR_LISTING_BYTES = 200 * 1024;
const MAX_SEARCH_BYTES = 200 * 1024;
const DIR_LISTING_STALENESS_MS = 30 * 1000;
const FILE_SEARCH_STALENESS_MS = 30 * 1000;
const MAX_DIR_PATH_LENGTH = 1024;
const MAX_SEARCH_QUERY_LENGTH = 200;

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

function validateDirPath(dirPath: string): void {
  if (dirPath.length > MAX_DIR_PATH_LENGTH) throw new Error('Directory path too long');
  if (dirPath.includes('..')) throw new Error('Invalid directory path');
  if (dirPath.startsWith('/')) throw new Error('Invalid directory path');
  if (dirPath.includes('\0')) throw new Error('Invalid directory path');
}

function validateSearchQuery(query: string): void {
  if (query.length > MAX_SEARCH_QUERY_LENGTH) throw new Error('Search query too long');
  if (query.includes('\0')) throw new Error('Invalid search query');
  // Empty query is allowed — returns up to maxResults workspace files
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
    treeHash: v.optional(v.string()),
    scannedAt: v.number(),
  },
  handler: async () => {
    throw new Error(
      '[DEPRECATED] syncFileTree is no longer supported. Please upgrade your CLI to v1.27.0 or later. ' +
        'Run: npm install -g chatroom-cli@latest'
    );
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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
      await ctx.db.patch('chatroom_workspaceFileContentRequests', existingRequest._id, {
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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

    // Return all fields
    return {
      content: content.content,
      encoding: content.encoding,
      truncated: content.truncated,
      fetchedAt: content.fetchedAt,
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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
  },
  handler: async () => {
    throw new Error(
      '[DEPRECATED] fulfillFileContent is no longer supported. Please upgrade your CLI to v1.27.0 or later. ' +
        'Run: npm install -g chatroom-cli@latest'
    );
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
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    if (!args.force) {
      const existingTree = await ctx.db
        .query('chatroom_workspaceFileTreeV2')
        .withIndex('by_machine_workingDir', (q: any) =>
          q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
        )
        .first();

      if (existingTree && Date.now() - existingTree.scannedAt < FILE_TREE_STALENESS_MS) {
        return { status: 'cached' as const };
      }
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
      await ctx.db.patch('chatroom_workspaceFileTreeRequests', existingRequest._id, {
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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
      await ctx.db.patch('chatroom_workspaceFileTreeRequests', request._id, {
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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
      await ctx.db.delete('chatroom_workspaceFileTree', tree._id);
    }

    // Delete pending requests
    const requests = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const req of requests) {
      await ctx.db.delete('chatroom_workspaceFileTreeRequests', req._id);
    }

    // Delete file content cache
    const contents = await ctx.db
      .query('chatroom_workspaceFileContent')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const content of contents) {
      await ctx.db.delete('chatroom_workspaceFileContent', content._id);
    }

    // Delete file content requests (uses different index)
    const contentRequests = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_status', (q: any) => q.eq('machineId', args.machineId))
      .filter((q: any) => q.eq(q.field('workingDir'), args.workingDir))
      .collect();
    for (const req of contentRequests) {
      await ctx.db.delete('chatroom_workspaceFileContentRequests', req._id);
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
    /** Compressed data object: { compression, content }. */
    data: v.object({
      compression: v.literal('gzip'),
      content: v.string(),
    }),
    /** Hash of uncompressed data for server-side dedup. */
    dataHash: v.string(),
    scannedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Validate size
    const sizeBytes = new TextEncoder().encode(args.data.content).length;
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
      await ctx.db.patch('chatroom_workspaceFileTreeV2', existing._id, row);
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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
    /** Compressed data object: { compression, content }. */
    data: v.object({
      compression: v.literal('gzip'),
      content: v.string(),
    }),
    encoding: v.string(),
    truncated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Validate size
    if (new TextEncoder().encode(args.data.content).length > MAX_CONTENT_BYTES) {
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
      await ctx.db.patch('chatroom_workspaceFileContentV2', existing._id, row);
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
      await ctx.db.patch('chatroom_workspaceFileContentRequests', request._id, {
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
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
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

// ─── File Write Request (frontend → daemon) ─────────────────────────────────
// fallow-ignore-next-line code-duplication

/**
 * Requests a file create, update, or delete on the daemon's local filesystem.
 * Returns an existing pending request for the same path, or creates a new one.
 */
export const requestFileWrite = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),
    operation: v.union(v.literal('create'), v.literal('update'), v.literal('delete')),
    data: v.optional(
      v.object({
        compression: v.literal('gzip'),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);
    validateFilePath(args.filePath);

    if (args.operation === 'delete') {
      if (args.data !== undefined) {
        throw new Error('Delete requests must not include file data');
      }
    } else {
      if (!args.data) {
        throw new Error('File data is required for create and update');
      }
      if (new TextEncoder().encode(args.data.content).length > MAX_CONTENT_BYTES) {
        throw new Error('File content too large');
      }
    }

    const existingRequest = await ctx.db
      .query('chatroom_workspaceFileWriteRequests')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .first();

    if (existingRequest && existingRequest.status === 'pending') {
      return { status: 'pending' as const, requestId: existingRequest._id };
    }

    const now = Date.now();
    const requestPatch = {
      operation: args.operation,
      status: 'pending' as const,
      errorMessage: undefined,
      requestedAt: now,
      updatedAt: now,
      ...(args.operation === 'delete' ? { data: undefined } : { data: args.data }),
    };

    if (existingRequest) {
      await ctx.db.patch('chatroom_workspaceFileWriteRequests', existingRequest._id, requestPatch);
      return { status: 'requested' as const, requestId: existingRequest._id };
    }

    const requestId = await ctx.db.insert('chatroom_workspaceFileWriteRequests', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      filePath: args.filePath,
      ...requestPatch,
    });

    return { status: 'requested' as const, requestId };
  },
});

/**
 * Returns the status of a file write request for polling.
 */
export const getFileWriteRequest = query({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_workspaceFileWriteRequests'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      return null;
    }

    const request = await ctx.db.get('chatroom_workspaceFileWriteRequests', args.requestId);
    if (!request) {
      return null;
    }

    try {
      await requireMachineAccess(ctx, request.machineId, auth.userId);
    } catch {
      return null;
    }

    return {
      status: request.status,
      errorMessage: request.errorMessage,
    };
  },
});

/**
 * Returns pending file write requests for a machine.
 * Daemon subscribes to this reactively.
 */
export const getPendingFileWriteRequests = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      return [];
    }

    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return [];
    }

    const requests = await ctx.db
      .query('chatroom_workspaceFileWriteRequests')
      .withIndex('by_machine_status', (q: any) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .take(MAX_PENDING_REQUESTS);

    return requests.map((r) => ({
      _id: r._id,
      workingDir: r.workingDir,
      filePath: r.filePath,
      operation: r.operation,
      data: r.data,
    }));
  },
});

/**
 * Marks a file write request as done or error.
 * On success, purges cached file content so the next read fetches fresh data.
 */
export const completeFileWriteRequest = mutation({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_workspaceFileWriteRequests'),
    status: v.union(v.literal('done'), v.literal('error')),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    const request = await ctx.db.get('chatroom_workspaceFileWriteRequests', args.requestId);
    if (!request) {
      throw new Error('Write request not found');
    }

    await requireMachineAccess(ctx, request.machineId, auth.userId);

    const now = Date.now();
    await ctx.db.patch('chatroom_workspaceFileWriteRequests', args.requestId, {
      status: args.status,
      errorMessage: args.errorMessage,
      updatedAt: now,
    });

    if (args.status === 'done') {
      const cached = await ctx.db
        .query('chatroom_workspaceFileContentV2')
        .withIndex('by_machine_workingDir_path', (q: any) =>
          q
            .eq('machineId', request.machineId)
            .eq('workingDir', request.workingDir)
            .eq('filePath', request.filePath)
        )
        .first();

      if (cached) {
        await ctx.db.delete('chatroom_workspaceFileContentV2', cached._id);
      }
    }
  },
});

// ─── Purge V2 Functions ─────────────────────────────────────────────────────

/**
 * Purges all file tree data for a workspace (v1 + v2 + requests).
 */
export const purgeFileTreeV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Delete v2 file tree
    const treeV2 = await ctx.db
      .query('chatroom_workspaceFileTreeV2')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();
    if (treeV2) await ctx.db.delete('chatroom_workspaceFileTreeV2', treeV2._id);

    // Delete v1 file tree
    const treeV1 = await ctx.db
      .query('chatroom_workspaceFileTree')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();
    if (treeV1) await ctx.db.delete('chatroom_workspaceFileTree', treeV1._id);

    // Delete pending requests
    const requests = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const req of requests) await ctx.db.delete('chatroom_workspaceFileTreeRequests', req._id);
  },
});

/**
 * Purges all file content data for a workspace (v1 + v2 + requests).
 */
export const purgeFileContentV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    // Delete v2 file content
    const contentsV2 = await ctx.db
      .query('chatroom_workspaceFileContentV2')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const c of contentsV2) await ctx.db.delete('chatroom_workspaceFileContentV2', c._id);

    // Delete v1 file content
    const contentsV1 = await ctx.db
      .query('chatroom_workspaceFileContent')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const c of contentsV1) await ctx.db.delete('chatroom_workspaceFileContent', c._id);

    // Delete file content requests
    const requests = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .withIndex('by_machine_status', (q: any) => q.eq('machineId', args.machineId))
      .filter((q: any) => q.eq(q.field('workingDir'), args.workingDir))
      .collect();
    for (const req of requests)
      await ctx.db.delete('chatroom_workspaceFileContentRequests', req._id);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Directory Listing V2 — per-directory FS slices
// ═══════════════════════════════════════════════════════════════════════════════
// fallow-ignore-file complexity
// fallow-ignore-file code-duplication

/** Normalize, dedupe, and sort active dir paths for stable storage. */
function normalizeActiveDirPaths(dirPaths: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of dirPaths) {
    const normalized = raw.replace(/\\/g, '/');
    validateDirPath(normalized);
    unique.add(normalized);
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

async function getOrCreateDirListingWatchRow(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string
) {
  const existing = await ctx.db
    .query('chatroom_workspaceDirListingWatch')
    .withIndex('by_machine_workingDir', (q: any) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
  return existing;
}

/**
 * Increment/decrement explorer observer refcount for a workspace.
 * On first observe, seed activeDirPaths to [''] (root).
 * On unobserve to 0, clear activeDirPaths.
 */
export const setDirListingExplorerObserver = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    observing: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    const now = Date.now();
    const existing = await getOrCreateDirListingWatchRow(ctx, args.machineId, args.workingDir);

    if (args.observing) {
      const nextCount = (existing?.observerCount ?? 0) + 1;
      const row = {
        machineId: args.machineId,
        workingDir: args.workingDir,
        observerCount: nextCount,
        activeDirPaths: existing?.activeDirPaths?.length ? existing.activeDirPaths : [''],
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch('chatroom_workspaceDirListingWatch', existing._id, row);
      } else {
        await ctx.db.insert('chatroom_workspaceDirListingWatch', row);
      }
      return { observerCount: nextCount };
    }

    const current = existing?.observerCount ?? 0;
    const nextCount = Math.max(0, current - 1);
    if (!existing) return { observerCount: 0 };

    if (nextCount === 0) {
      await ctx.db.patch('chatroom_workspaceDirListingWatch', existing._id, {
        observerCount: 0,
        activeDirPaths: [],
        updatedAt: now,
      });
    } else {
      await ctx.db.patch('chatroom_workspaceDirListingWatch', existing._id, {
        observerCount: nextCount,
        updatedAt: now,
      });
    }
    return { observerCount: nextCount };
  },
});

/**
 * Replace active dir paths for a workspace with an active observer.
 * No-op (return current state) when observerCount is 0.
 */
export const setDirListingWatchPaths = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    activeDirPaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    const existing = await getOrCreateDirListingWatchRow(ctx, args.machineId, args.workingDir);
    if (!existing || (existing.observerCount ?? 0) <= 0) {
      return { observerCount: 0, activeDirPaths: [] as string[] };
    }

    const normalized = normalizeActiveDirPaths(args.activeDirPaths);
    // Ensure root is always watched when explorer is open
    if (!normalized.includes('')) {
      normalized.unshift('');
    }

    const now = Date.now();
    await ctx.db.patch('chatroom_workspaceDirListingWatch', existing._id, {
      activeDirPaths: normalized,
      updatedAt: now,
    });

    return {
      observerCount: existing.observerCount,
      activeDirPaths: normalized,
    };
  },
});

/** Daemon subscription: workspaces on this machine with active explorer observers. */
export const listDirListingWatchTargets = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return [];
    }

    const rows = await ctx.db
      .query('chatroom_workspaceDirListingWatch')
      .withIndex('by_machineId_observerCount', (q: any) =>
        q.eq('machineId', args.machineId).gte('observerCount', 1)
      )
      .collect();

    return rows.map((row) => ({
      workingDir: row.workingDir,
      observerCount: row.observerCount,
      activeDirPaths: row.activeDirPaths,
      updatedAt: row.updatedAt,
    }));
  },
});

export const requestDirListing = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    dirPath: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);
    validateDirPath(args.dirPath);

    if (!args.force) {
      const existing = await ctx.db
        .query('chatroom_workspaceDirListingV2')
        .withIndex('by_machine_workingDir_dirPath', (q: any) =>
          q
            .eq('machineId', args.machineId)
            .eq('workingDir', args.workingDir)
            .eq('dirPath', args.dirPath)
        )
        .first();
      if (existing && Date.now() - existing.scannedAt < DIR_LISTING_STALENESS_MS) {
        return { status: 'cached' as const };
      }
    }

    const existingRequest = await ctx.db
      .query('chatroom_workspaceDirListingRequests')
      .withIndex('by_machine_workingDir_dirPath', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('dirPath', args.dirPath)
      )
      .first();

    if (existingRequest?.status === 'pending') {
      return { status: 'pending' as const };
    }

    const now = Date.now();
    if (existingRequest) {
      await ctx.db.patch('chatroom_workspaceDirListingRequests', existingRequest._id, {
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_workspaceDirListingRequests', {
        machineId: args.machineId,
        workingDir: args.workingDir,
        dirPath: args.dirPath,
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    }
    return { status: 'requested' as const };
  },
});

export const getDirListingV2 = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    dirPath: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return null;
    }

    const row = await ctx.db
      .query('chatroom_workspaceDirListingV2')
      .withIndex('by_machine_workingDir_dirPath', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('dirPath', args.dirPath)
      )
      .first();

    if (!row) return null;
    return {
      data: row.data,
      scannedAt: row.scannedAt,
      truncated: row.truncated,
      totalCount: row.totalCount,
    };
  },
});

export const getPendingDirListingRequests = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return [];
    }

    const requests = await ctx.db
      .query('chatroom_workspaceDirListingRequests')
      .withIndex('by_machine_status', (q: any) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .take(MAX_PENDING_REQUESTS);

    return requests.map((r) => ({
      _id: r._id,
      workingDir: r.workingDir,
      dirPath: r.dirPath,
    }));
  },
});

/** Shared upsert logic for one dir listing row. Returns whether a write occurred. */
async function upsertDirListingV2Row(
  ctx: MutationCtx,
  args: {
    machineId: string;
    workingDir: string;
    dirPath: string;
    data: { compression: 'gzip'; content: string };
    dataHash: string;
    scannedAt: number;
    truncated: boolean;
    totalCount: number;
  }
): Promise<boolean> {
  validateDirPath(args.dirPath);
  const sizeBytes = new TextEncoder().encode(args.data.content).length;
  if (sizeBytes > MAX_DIR_LISTING_BYTES) {
    throw new Error('Directory listing too large');
  }

  const existing = await ctx.db
    .query('chatroom_workspaceDirListingV2')
    .withIndex('by_machine_workingDir_dirPath', (q: any) =>
      q
        .eq('machineId', args.machineId)
        .eq('workingDir', args.workingDir)
        .eq('dirPath', args.dirPath)
    )
    .first();

  if (existing && existing.dataHash === args.dataHash) return false;

  const row = {
    machineId: args.machineId,
    workingDir: args.workingDir,
    dirPath: args.dirPath,
    data: args.data,
    dataHash: args.dataHash,
    scannedAt: args.scannedAt,
    truncated: args.truncated,
    totalCount: args.totalCount,
  };

  if (existing) {
    await ctx.db.patch('chatroom_workspaceDirListingV2', existing._id, row);
  } else {
    await ctx.db.insert('chatroom_workspaceDirListingV2', row);
  }

  return true;
}

export const syncDirListingV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    dirPath: v.string(),
    data: v.object({
      compression: v.literal('gzip'),
      content: v.string(),
    }),
    dataHash: v.string(),
    scannedAt: v.number(),
    truncated: v.boolean(),
    totalCount: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    await upsertDirListingV2Row(ctx, {
      machineId: args.machineId,
      workingDir: args.workingDir,
      dirPath: args.dirPath,
      data: args.data,
      dataHash: args.dataHash,
      scannedAt: args.scannedAt,
      truncated: args.truncated,
      totalCount: args.totalCount,
    });
  },
});

export const syncDirListingV2Batch = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    items: v.array(
      v.object({
        dirPath: v.string(),
        data: v.object({
          compression: v.literal('gzip'),
          content: v.string(),
        }),
        dataHash: v.string(),
        scannedAt: v.number(),
        truncated: v.boolean(),
        totalCount: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    let written = 0;
    for (const item of args.items) {
      const didWrite = await upsertDirListingV2Row(ctx, {
        machineId: args.machineId,
        workingDir: args.workingDir,
        ...item,
      });
      if (didWrite) written++;
    }
    return { written, skipped: args.items.length - written };
  },
});

export const fulfillDirListingRequest = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    dirPath: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    const request = await ctx.db
      .query('chatroom_workspaceDirListingRequests')
      .withIndex('by_machine_workingDir_dirPath', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('dirPath', args.dirPath)
      )
      .first();

    if (request) {
      await ctx.db.patch('chatroom_workspaceDirListingRequests', request._id, {
        status: 'done',
        updatedAt: Date.now(),
      });
    }
  },
});

// ─── File Search V2 ─────────────────────────────────────────────────────────

export const requestFileSearch = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    query: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);
    validateSearchQuery(args.query);

    if (!args.force) {
      const existing = await ctx.db
        .query('chatroom_workspaceFileSearchV2')
        .withIndex('by_machine_workingDir_query', (q: any) =>
          q
            .eq('machineId', args.machineId)
            .eq('workingDir', args.workingDir)
            .eq('query', args.query)
        )
        .first();
      if (existing && Date.now() - existing.scannedAt < FILE_SEARCH_STALENESS_MS) {
        return { status: 'cached' as const };
      }
    }

    const existingRequest = await ctx.db
      .query('chatroom_workspaceFileSearchRequests')
      .withIndex('by_machine_workingDir_query', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('query', args.query)
      )
      .first();

    if (existingRequest?.status === 'pending') {
      return { status: 'pending' as const };
    }

    const now = Date.now();
    if (existingRequest) {
      await ctx.db.patch('chatroom_workspaceFileSearchRequests', existingRequest._id, {
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_workspaceFileSearchRequests', {
        machineId: args.machineId,
        workingDir: args.workingDir,
        query: args.query,
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    }
    return { status: 'requested' as const };
  },
});

export const getFileSearchV2 = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return null;
    }

    const row = await ctx.db
      .query('chatroom_workspaceFileSearchV2')
      .withIndex('by_machine_workingDir_query', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('query', args.query)
      )
      .first();

    if (!row) return null;
    return {
      data: row.data,
      scannedAt: row.scannedAt,
      truncated: row.truncated,
      totalCount: row.totalCount,
    };
  },
});

export const getPendingFileSearchRequests = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return [];
    }

    const requests = await ctx.db
      .query('chatroom_workspaceFileSearchRequests')
      .withIndex('by_machine_status', (q: any) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .take(MAX_PENDING_REQUESTS);

    return requests.map((r) => ({
      _id: r._id,
      workingDir: r.workingDir,
      query: r.query,
    }));
  },
});

export const syncFileSearchV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    query: v.string(),
    data: v.object({
      compression: v.literal('gzip'),
      content: v.string(),
    }),
    dataHash: v.string(),
    scannedAt: v.number(),
    truncated: v.boolean(),
    totalCount: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);
    validateSearchQuery(args.query);

    const sizeBytes = new TextEncoder().encode(args.data.content).length;
    if (sizeBytes > MAX_SEARCH_BYTES) {
      throw new Error('File search result too large');
    }

    const existing = await ctx.db
      .query('chatroom_workspaceFileSearchV2')
      .withIndex('by_machine_workingDir_query', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('query', args.query)
      )
      .first();

    if (existing && existing.dataHash === args.dataHash) return;

    const row = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      query: args.query,
      data: args.data,
      dataHash: args.dataHash,
      scannedAt: args.scannedAt,
      truncated: args.truncated,
      totalCount: args.totalCount,
    };

    if (existing) {
      await ctx.db.patch('chatroom_workspaceFileSearchV2', existing._id, row);
    } else {
      await ctx.db.insert('chatroom_workspaceFileSearchV2', row);
    }
  },
});

export const fulfillFileSearchRequest = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    const request = await ctx.db
      .query('chatroom_workspaceFileSearchRequests')
      .withIndex('by_machine_workingDir_query', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('query', args.query)
      )
      .first();

    if (request) {
      await ctx.db.patch('chatroom_workspaceFileSearchRequests', request._id, {
        status: 'done',
        updatedAt: Date.now(),
      });
    }
  },
});

export const purgeDirListingsV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    const listings = await ctx.db
      .query('chatroom_workspaceDirListingV2')
      .withIndex('by_machine_workingDir_dirPath', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const row of listings) await ctx.db.delete('chatroom_workspaceDirListingV2', row._id);

    const listingRequests = await ctx.db
      .query('chatroom_workspaceDirListingRequests')
      .withIndex('by_machine_workingDir_dirPath', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const row of listingRequests)
      await ctx.db.delete('chatroom_workspaceDirListingRequests', row._id);

    const searches = await ctx.db
      .query('chatroom_workspaceFileSearchV2')
      .withIndex('by_machine_workingDir_query', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const row of searches) await ctx.db.delete('chatroom_workspaceFileSearchV2', row._id);

    const searchRequests = await ctx.db
      .query('chatroom_workspaceFileSearchRequests')
      .withIndex('by_machine_workingDir_query', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
    for (const row of searchRequests)
      await ctx.db.delete('chatroom_workspaceFileSearchRequests', row._id);
  },
});
