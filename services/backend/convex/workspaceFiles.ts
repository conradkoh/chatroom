/**
 * Convex functions for workspace file tree and on-demand file content.
 *
 * - File tree: daemon syncs a JSON blob of the file tree per workspace
 * - File content: frontend requests content; daemon fulfills; cached in DB
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { QueryCtx, MutationCtx } from './_generated/server';
import { getSession } from './auth/session';
import { compactFileTreeDeltaOperationValidator } from './lib/fileTreeDeltaOps';
import * as blobSnapshots from './workspaceFileTree/repositories/blobSnapshotRepository';
import * as shardedSnapshots from './workspaceFileTree/repositories/shardedSnapshotRepository';
import { publishFileTreeCheckpoint as publishCheckpointService } from './workspaceFileTree/services/checkpointPublishService';
import { getFileTreeCheckpointForApi } from './workspaceFileTree/services/checkpointQueryService';
import { applyFileTreeDeltaBatch as applyDeltaService } from './workspaceFileTree/services/deltaApplyService';
import { getFileTreeDeltasForApi } from './workspaceFileTree/services/deltaQueryService';
import { validateFileTreeRevision as validateWorkspaceFileTreeRevision } from './workspaceFileTree/validation';
import {
  normalizeWorkingDir,
  requireRegisteredWorkspaceForMachine,
  validateDirPath,
  validateFilePath,
} from './workspacePathSecurity';
import { requireAccess } from '../modules/auth/accessCheck';
import { getInvalidChatAttachmentUploadPathReason } from '../src/domain/constants/chat-attachment-upload-path';
import { MAX_WORKSPACE_UPLOAD_BYTES } from '../src/domain/constants/workspace-upload';
import { getBlockedUploadTargetReason } from '../src/domain/constants/workspace-upload-path-policy';
import { requestWorkspaceFileTree as requestWorkspaceFileTreeUseCase } from '../src/domain/usecase/workspace/request-workspace-file-tree';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max treeJson size: 900KB (stay under Convex's 1MB document limit). */
const MAX_TREE_JSON_BYTES = 900 * 1024;

/** Max shards per batch mutation. */
const MAX_SHARD_BATCH_SIZE = 8;

/** Keep delta documents comfortably below Convex's document size limit. */
/** Max file content size: 512KB. */
const MAX_CONTENT_BYTES = 512 * 1024;

/** Max pending requests returned per query (prevent unbounded reads). */
const MAX_PENDING_REQUESTS = 50;

const CHAT_ATTACHMENT_RESERVED_PREFIX = '.chatroom/downloads/attachments/';

function validateChatAttachmentWriteRequest(args: {
  uploadKind?: 'chatAttachment';
  storageId?: Id<'_storage'>;
  operation: string;
  filePath: string;
}): void {
  if (args.uploadKind === 'chatAttachment') {
    if (args.operation !== 'create' || !args.storageId) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Chat attachments require create with storageId',
        fields: ['uploadKind'],
      });
    }
    const reason = getInvalidChatAttachmentUploadPathReason(args.filePath);
    if (reason) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: reason,
        fields: ['filePath'],
      });
    }
  }

  if (
    args.storageId &&
    args.filePath.replace(/\\/g, '/').startsWith(CHAT_ATTACHMENT_RESERVED_PREFIX)
  ) {
    const reason = getInvalidChatAttachmentUploadPathReason(args.filePath);
    if (reason) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: reason,
        fields: ['filePath'],
      });
    }
  }
}

/** Fast file write operations that supersede any pending request on the same path. */
const FAST_FILE_WRITE_OPERATIONS = new Set(['delete', 'rename', 'mkdir']);

const MAX_DIR_LISTING_BYTES = 200 * 1024;

/** Max rows deleted per purgeFileTreeV2 invocation to stay under Convex read limits. */
const PURGE_FILE_TREE_BATCH_SIZE = 200;
const MAX_SEARCH_BYTES = 200 * 1024;
const DIR_LISTING_STALENESS_MS = 10 * 1000; // 10 seconds — align with @ / explorer freshness budget
const FILE_SEARCH_STALENESS_MS = 10 * 1000; // 10 seconds — align with @ / explorer freshness budget
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
    await requireRegisteredWorkspaceForMachine(ctx, args.machineId, args.workingDir);

    const workingDir = normalizeWorkingDir(args.workingDir);

    // Security: validate file path
    validateFilePath(args.filePath);

    // Check for cached content (fresh if < 5 minutes old)
    const cached = await ctx.db
      .query('chatroom_workspaceFileContentV2')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir).eq('filePath', args.filePath)
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
        q.eq('machineId', args.machineId).eq('workingDir', workingDir).eq('filePath', args.filePath)
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
        workingDir,
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
      updatedAt: r.updatedAt,
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

/**
 * Requests that the daemon ensure incremental synchronization for a workspace.
 * `force` is reserved for explicit recovery and performs a reconciliation walk.
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

    return await requestWorkspaceFileTreeUseCase(ctx, {
      machineId: args.machineId,
      workingDir: args.workingDir,
      force: args.force,
    });
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
      force: r.force === true,
      updatedAt: r.updatedAt,
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
    const workingDir = normalizeWorkingDir(args.workingDir);

    const request = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
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
    const workingDir = normalizeWorkingDir(args.workingDir);

    // Validate size
    const sizeBytes = new TextEncoder().encode(args.data.content).length;
    if (sizeBytes > MAX_TREE_JSON_BYTES) {
      throw new Error('File tree too large');
    }

    await blobSnapshots.upsertBlobSnapshot(ctx, {
      machineId: args.machineId,
      workingDir,
      data: args.data,
      dataHash: args.dataHash,
      scannedAt: args.scannedAt,
    });
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

    const workingDir = normalizeWorkingDir(args.workingDir);

    const tree = await blobSnapshots.findBlobSnapshot(ctx, args.machineId, workingDir);
    if (!tree) {
      return null;
    }

    return {
      data: tree.data,
      scannedAt: tree.scannedAt,
    };
  },
});

// ─── File Tree Shard V3 (daemon → backend, large repos) ─────────────────────

/** Batch upsert file tree shards (v3). Returns { written, skipped }. */
export const syncFileTreeShardV3Batch = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    syncGeneration: v.string(),
    items: v.array(
      v.object({
        shardId: v.string(),
        data: v.object({ compression: v.literal('gzip'), content: v.string() }),
        dataHash: v.string(),
        scannedAt: v.number(),
        entryCount: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);

    if (args.items.length > MAX_SHARD_BATCH_SIZE) {
      throw new Error(`Batch size exceeds max ${MAX_SHARD_BATCH_SIZE}`);
    }

    return await shardedSnapshots.upsertShardBatch(
      ctx,
      args.machineId,
      args.workingDir,
      args.syncGeneration,
      args.items
    );
  },
});

/** Upsert manifest for sharded file tree (v3). Deletes shards from prior syncGeneration. */
export const syncFileTreeManifestV3 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    syncGeneration: v.string(),
    shardIds: v.array(v.string()),
    totalEntryCount: v.number(),
    complete: v.boolean(),
    scannedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);
    await shardedSnapshots.upsertManifest(ctx, {
      machineId: args.machineId,
      workingDir: args.workingDir,
      syncGeneration: args.syncGeneration,
      shardIds: args.shardIds,
      totalEntryCount: args.totalEntryCount,
      complete: args.complete,
      scannedAt: args.scannedAt,
    });
  },
});

/** Returns latest manifest for workspace, or null. */
export const getFileTreeManifestV3 = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return null;
    }
    const workingDir = normalizeWorkingDir(args.workingDir);
    const manifest = await shardedSnapshots.findManifest(ctx, args.machineId, workingDir);
    if (!manifest) return null;
    return {
      syncGeneration: manifest.syncGeneration,
      shardIds: manifest.shardIds,
      totalEntryCount: manifest.totalEntryCount,
      complete: manifest.complete,
      scannedAt: manifest.scannedAt,
    };
  },
});

/** Returns all shard payloads for a sync generation. */
export const getFileTreeShardsV3 = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    syncGeneration: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return null;
    }
    const workingDir = normalizeWorkingDir(args.workingDir);
    const shards = await shardedSnapshots.findShards(
      ctx,
      args.machineId,
      workingDir,
      args.syncGeneration
    );
    return shards.map((s) => ({
      shardId: s.shardId,
      data: s.data,
      dataHash: s.dataHash,
      scannedAt: s.scannedAt,
      entryCount: s.entryCount,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Incremental File Tree Sync — revisioned deltas over V2/V3 checkpoints
// ═══════════════════════════════════════════════════════════════════════════════

const validateFileTreeRevision = validateWorkspaceFileTreeRevision;

/**
 * Appends one ordered delta batch. A daemon may retry the same operationId
 * indefinitely: its compact receipt survives checkpoint compaction.
 */
export const applyFileTreeDeltaBatch = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    operationId: v.string(),
    baseRevision: v.number(),
    operations: v.array(compactFileTreeDeltaOperationValidator),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);
    const workingDir = normalizeWorkingDir(args.workingDir);

    return await applyDeltaService(ctx, {
      machineId: args.machineId,
      workingDir,
      operationId: args.operationId,
      baseRevision: args.baseRevision,
      operations: args.operations,
    });
  },
});

/** Returns checkpoint metadata; the snapshot payload remains in V2/V3 tables. */
export const getFileTreeCheckpoint = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return null;
    }
    const workingDir = normalizeWorkingDir(args.workingDir);
    return await getFileTreeCheckpointForApi(ctx, args.machineId, workingDir);
  },
});

/**
 * Returns ordered delta batches after a client's revision. A client behind a
 * compacted checkpoint must reload the referenced V2/V3 snapshot first.
 */
export const getFileTreeDeltas = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    afterRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    try {
      await requireMachineAccess(ctx, args.machineId, auth.userId);
    } catch {
      return null;
    }
    const workingDir = normalizeWorkingDir(args.workingDir);
    return await getFileTreeDeltasForApi(ctx, args.machineId, workingDir, args.afterRevision);
  },
});

/**
 * Publishes the current V2/V3 snapshot as a checkpoint, then prunes only the
 * delta payloads it covers. Idempotency receipts are intentionally retained.
 */
export const publishFileTreeCheckpoint = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    revision: v.number(),
    strategyId: v.union(v.literal('blob'), v.literal('sharded')),
    /** V2 dataHash or V3 syncGeneration. */
    snapshotId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await requireMachineAccess(ctx, args.machineId, auth.userId);
    const workingDir = normalizeWorkingDir(args.workingDir);
    validateFileTreeRevision(args.revision, 'revision');
    if (!args.snapshotId) throw new Error('snapshotId is required');

    return await publishCheckpointService(ctx, {
      machineId: args.machineId,
      workingDir,
      revision: args.revision,
      strategyId: args.strategyId,
      snapshotId: args.snapshotId,
    });
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

    const workingDir = normalizeWorkingDir(args.workingDir);
    const content = await ctx.db
      .query('chatroom_workspaceFileContentV2')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir).eq('filePath', args.filePath)
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
 * Returns a short-lived upload URL for workspace file uploads (transient Convex storage).
 */
export const generateWorkspaceFileUploadUrl = mutation({
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
    await requireRegisteredWorkspaceForMachine(ctx, args.machineId, args.workingDir);

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

/**
 * Whether a new write request on the same path should supersede an existing
 * pending request instead of silently returning it. Fast ops (delete/rename/
 * mkdir) always supersede; storage-backed create/update retries replace their
 * upload blob. Inline create/update dedups so a second write coalesces onto the
 * pending request already in flight.
 */
function shouldSupersedePendingRequest(
  _existingOperation: string,
  args: { operation: string; storageId?: unknown }
): boolean {
  if (FAST_FILE_WRITE_OPERATIONS.has(args.operation)) return true;
  // Preserve existing storageId replace behavior for create/update uploads
  if (
    args.storageId !== undefined &&
    (args.operation === 'create' || args.operation === 'update')
  ) {
    return true;
  }
  return false;
}

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
    operation: v.union(
      v.literal('create'),
      v.literal('update'),
      v.literal('delete'),
      v.literal('rename'),
      v.literal('mkdir')
    ),
    data: v.optional(
      v.object({
        compression: v.literal('gzip'),
        content: v.string(),
      })
    ),
    storageId: v.optional(v.id('_storage')),
    targetFilePath: v.optional(v.string()),
    uploadKind: v.optional(v.literal('chatAttachment')),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);
    await requireRegisteredWorkspaceForMachine(ctx, args.machineId, args.workingDir);
    validateFilePath(args.filePath);

    if (args.operation === 'mkdir') {
      if (args.data !== undefined) {
        throw new Error('Mkdir requests must not include file data');
      }
      if (args.storageId !== undefined) {
        throw new Error('Mkdir requests must not include storageId');
      }
      if (args.targetFilePath !== undefined) {
        throw new Error('Mkdir requests must not include targetFilePath');
      }
    } else if (args.operation === 'rename') {
      if (!args.targetFilePath) {
        throw new Error('Target path is required for rename');
      }
      if (args.data !== undefined) {
        throw new Error('Rename requests must not include file data');
      }
      if (args.storageId !== undefined) {
        throw new Error('Rename requests must not include storageId');
      }
      validateFilePath(args.targetFilePath);
      if (args.targetFilePath === args.filePath) {
        throw new Error('Rename target must differ from source path');
      }
    } else if (args.operation === 'delete') {
      if (args.data !== undefined) {
        throw new Error('Delete requests must not include file data');
      }
      if (args.storageId !== undefined) {
        throw new Error('Delete requests must not include storageId');
      }
    } else {
      const hasData = args.data !== undefined;
      const hasStorage = args.storageId !== undefined;
      if (hasData === hasStorage) {
        throw new Error('Create and update require exactly one of data or storageId');
      }

      if (args.storageId !== undefined) {
        const blockedReason = getBlockedUploadTargetReason(args.filePath);
        if (blockedReason) {
          throw new Error(blockedReason);
        }
      }

      validateChatAttachmentWriteRequest(args);

      if (args.storageId) {
        const metadata = await ctx.storage.getMetadata(args.storageId);
        if (!metadata) {
          throw new Error('Upload not found');
        }
        if (metadata.size > MAX_WORKSPACE_UPLOAD_BYTES) {
          throw new Error('File content too large');
        }
      } else if (args.data) {
        if (new TextEncoder().encode(args.data.content).length > MAX_CONTENT_BYTES) {
          throw new Error('File content too large');
        }
      }
    }

    const pathRequests = await ctx.db
      .query('chatroom_workspaceFileWriteRequests')
      .withIndex('by_machine_workingDir_path', (q: any) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('filePath', args.filePath)
      )
      .collect();

    const pendingRequest = pathRequests.find((row) => row.status === 'pending');
    const processingRequest = pathRequests.find((row) => row.status === 'processing');

    if (pendingRequest) {
      if (!shouldSupersedePendingRequest(pendingRequest.operation, args)) {
        return { status: 'pending' as const, requestId: pendingRequest._id };
      }
      // Supersede pending row — fall through to patch/replace below.
    } else if (processingRequest) {
      // Never mutate processing rows — insert a new request below.
    }

    const now = Date.now();
    const uploadKindField =
      args.uploadKind === 'chatAttachment' ? { uploadKind: 'chatAttachment' as const } : {};
    const requestPatch = {
      operation: args.operation,
      status: 'pending' as const,
      errorMessage: undefined,
      requestedAt: now,
      updatedAt: now,
      claimedAt: undefined,
      ...uploadKindField,
      ...(args.operation === 'rename'
        ? { data: undefined, storageId: undefined, targetFilePath: args.targetFilePath }
        : args.operation === 'delete' || args.operation === 'mkdir'
          ? { data: undefined, storageId: undefined, targetFilePath: undefined }
          : args.storageId
            ? { data: undefined, storageId: args.storageId, targetFilePath: undefined }
            : { data: args.data, storageId: undefined, targetFilePath: undefined }),
    };

    if (pendingRequest) {
      const nextRevision = (pendingRequest.revision ?? 1) + 1;
      const keepsStorageBlob =
        args.storageId !== undefined &&
        (args.operation === 'create' || args.operation === 'update') &&
        args.storageId === pendingRequest.storageId;
      if (pendingRequest.storageId && !keepsStorageBlob) {
        await ctx.storage.delete(pendingRequest.storageId);
      }

      if (args.storageId && (args.operation === 'create' || args.operation === 'update')) {
        await ctx.db.replace('chatroom_workspaceFileWriteRequests', pendingRequest._id, {
          machineId: args.machineId,
          workingDir: args.workingDir,
          filePath: args.filePath,
          operation: args.operation,
          status: 'pending',
          revision: nextRevision,
          requestedAt: now,
          updatedAt: now,
          storageId: args.storageId,
          ...uploadKindField,
        });
      } else {
        await ctx.db.patch('chatroom_workspaceFileWriteRequests', pendingRequest._id, {
          ...requestPatch,
          revision: nextRevision,
        });
      }
      return { status: 'requested' as const, requestId: pendingRequest._id };
    }

    const insertPayload =
      args.storageId && (args.operation === 'create' || args.operation === 'update')
        ? {
            machineId: args.machineId,
            workingDir: args.workingDir,
            filePath: args.filePath,
            operation: args.operation,
            status: 'pending' as const,
            revision: 1,
            requestedAt: now,
            updatedAt: now,
            storageId: args.storageId,
            ...uploadKindField,
          }
        : {
            machineId: args.machineId,
            workingDir: args.workingDir,
            filePath: args.filePath,
            revision: 1,
            ...requestPatch,
          };

    const requestId = await ctx.db.insert('chatroom_workspaceFileWriteRequests', insertPayload);

    return { status: 'requested' as const, requestId };
  },
});

function getWriteRequestRevision(revision: number | undefined): number {
  return revision ?? 1;
}

async function hasNewerActiveRequestForPath(
  ctx: MutationCtx,
  request: {
    _id: Id<'chatroom_workspaceFileWriteRequests'>;
    machineId: string;
    workingDir: string;
    filePath: string;
    requestedAt: number;
  }
): Promise<boolean> {
  const pathRequests = await ctx.db
    .query('chatroom_workspaceFileWriteRequests')
    .withIndex('by_machine_workingDir_path', (q: any) =>
      q
        .eq('machineId', request.machineId)
        .eq('workingDir', request.workingDir)
        .eq('filePath', request.filePath)
    )
    .collect();

  return pathRequests.some(
    (row) => row._id !== request._id && (row.status === 'pending' || row.status === 'processing')
  );
}

/**
 * Atomically claims a pending write request for daemon fulfillment.
 */
export const claimFileWriteRequest = mutation({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_workspaceFileWriteRequests'),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    const request = await ctx.db.get('chatroom_workspaceFileWriteRequests', args.requestId);
    if (!request) {
      return { status: 'stale' as const };
    }

    await requireMachineAccess(ctx, request.machineId, auth.userId);

    const revision = getWriteRequestRevision(request.revision);
    if (request.status !== 'pending' || revision !== args.expectedRevision) {
      return { status: 'stale' as const };
    }

    if (await hasNewerActiveRequestForPath(ctx, request)) {
      return { status: 'stale' as const };
    }

    const claimedAt = Date.now();
    await ctx.db.patch('chatroom_workspaceFileWriteRequests', args.requestId, {
      status: 'processing',
      claimedAt,
      updatedAt: claimedAt,
    });

    return {
      status: 'claimed' as const,
      request: {
        _id: request._id,
        revision,
        workingDir: request.workingDir,
        filePath: request.filePath,
        operation: request.operation,
        storageId: request.storageId,
        targetFilePath: request.targetFilePath,
        uploadKind: request.uploadKind,
        data: request.storageId ? undefined : request.data,
      },
    };
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
      operation: request.operation,
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
      revision: getWriteRequestRevision(r.revision),
      workingDir: r.workingDir,
      filePath: r.filePath,
      operation: r.operation,
      data: r.storageId ? undefined : r.data,
      storageId: r.storageId,
      targetFilePath: r.targetFilePath,
      uploadKind: r.uploadKind,
      updatedAt: r.updatedAt,
    }));
  },
});

/**
 * Returns a signed URL for the storage blob attached to a pending write request.
 * Daemon uses this to download upload payloads.
 */
export const getWriteRequestStorageUrl = query({
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
    if (!request?.storageId) {
      return null;
    }

    try {
      await requireMachineAccess(ctx, request.machineId, auth.userId);
    } catch {
      return null;
    }

    return await ctx.storage.getUrl(request.storageId);
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
    revision: v.number(),
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

    const revision = getWriteRequestRevision(request.revision);
    if (request.status !== 'processing' || revision !== args.revision) {
      throw new Error('Stale write request');
    }

    if (await hasNewerActiveRequestForPath(ctx, request)) {
      throw new Error('Stale write request');
    }

    const now = Date.now();
    await ctx.db.patch('chatroom_workspaceFileWriteRequests', args.requestId, {
      status: args.status,
      errorMessage: args.errorMessage,
      updatedAt: now,
    });

    if (request.storageId) {
      await ctx.storage.delete(request.storageId);
    }

    if (args.status === 'done') {
      const workingDir = normalizeWorkingDir(request.workingDir);

      if ((request.operation === 'create' || request.operation === 'update') && request.data) {
        const now = Date.now();
        const existing = await ctx.db
          .query('chatroom_workspaceFileContentV2')
          .withIndex('by_machine_workingDir_path', (q: any) =>
            q
              .eq('machineId', request.machineId)
              .eq('workingDir', workingDir)
              .eq('filePath', request.filePath)
          )
          .first();

        const row = {
          machineId: request.machineId,
          workingDir,
          filePath: request.filePath,
          data: request.data,
          encoding: 'utf8' as const,
          truncated: false,
          fetchedAt: now,
        };

        if (existing) {
          await ctx.db.patch('chatroom_workspaceFileContentV2', existing._id, row);
        } else {
          await ctx.db.insert('chatroom_workspaceFileContentV2', row);
        }

        const contentRequest = await ctx.db
          .query('chatroom_workspaceFileContentRequests')
          .withIndex('by_machine_workingDir_path', (q: any) =>
            q
              .eq('machineId', request.machineId)
              .eq('workingDir', workingDir)
              .eq('filePath', request.filePath)
          )
          .first();
        if (contentRequest) {
          await ctx.db.patch('chatroom_workspaceFileContentRequests', contentRequest._id, {
            status: 'done' as const,
            updatedAt: now,
          });
        }
      } else if (request.operation === 'delete') {
        const cached = await ctx.db
          .query('chatroom_workspaceFileContentV2')
          .withIndex('by_machine_workingDir_path', (q: any) =>
            q
              .eq('machineId', request.machineId)
              .eq('workingDir', workingDir)
              .eq('filePath', request.filePath)
          )
          .first();
        if (cached) {
          await ctx.db.delete('chatroom_workspaceFileContentV2', cached._id);
        }
      }
    }
  },
});

/**
 * Discards a storage blob that was uploaded but never attached to a write request.
 */
export const discardUnattachedWorkspaceUpload = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    await requireMachineAccess(ctx, args.machineId, auth.userId);
    await requireRegisteredWorkspaceForMachine(ctx, args.machineId, args.workingDir);

    const attached = await ctx.db
      .query('chatroom_workspaceFileWriteRequests')
      .filter((q: any) => q.eq(q.field('storageId'), args.storageId))
      .first();

    if (attached && (attached.status === 'pending' || attached.status === 'processing')) {
      throw new Error('Upload is attached to an active write request');
    }

    await ctx.storage.delete(args.storageId);
  },
});

// ─── Purge V2 Functions ─────────────────────────────────────────────────────

/**
 * Purges all file tree data for a workspace (v1 + v2 + requests).
 * Batched across invocations to stay under Convex read limits.
 */
export const purgeFileTreeV2 = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  returns: v.object({ complete: v.boolean() }),
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    await requireMachineAccess(ctx, args.machineId, auth.userId);
    const workingDir = normalizeWorkingDir(args.workingDir);

    let hitBatchLimit = false;

    // Delete v2 file tree (singleton)
    const treeV2 = await ctx.db
      .query('chatroom_workspaceFileTreeV2')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
      )
      .first();
    if (treeV2) await ctx.db.delete('chatroom_workspaceFileTreeV2', treeV2._id);

    // Delete v3 manifest + shards (batch shards, delete manifest only after all done)
    const manifestV3 = await ctx.db
      .query('chatroom_workspaceFileTreeManifestV3')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
      )
      .first();
    if (manifestV3) {
      const shards = await ctx.db
        .query('chatroom_workspaceFileTreeShardV3')
        .withIndex('by_machine_workingDir_syncGeneration', (q: any) =>
          q
            .eq('machineId', args.machineId)
            .eq('workingDir', workingDir)
            .eq('syncGeneration', manifestV3.syncGeneration)
        )
        .take(PURGE_FILE_TREE_BATCH_SIZE);
      for (const shard of shards) {
        await ctx.db.delete('chatroom_workspaceFileTreeShardV3', shard._id);
      }
      if (shards.length === PURGE_FILE_TREE_BATCH_SIZE) {
        hitBatchLimit = true;
      } else {
        await ctx.db.delete('chatroom_workspaceFileTreeManifestV3', manifestV3._id);
      }
    }

    // Delete incremental checkpoint (singleton)
    const checkpoint = await ctx.db
      .query('chatroom_workspaceFileTreeCheckpoint')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
      )
      .first();
    if (checkpoint) {
      await ctx.db.delete('chatroom_workspaceFileTreeCheckpoint', checkpoint._id);
    }

    // Delete deltas (batched)
    const deltas = await ctx.db
      .query('chatroom_workspaceFileTreeDelta')
      .withIndex('by_machine_workingDir_revision', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
      )
      .take(PURGE_FILE_TREE_BATCH_SIZE);
    for (const delta of deltas) {
      await ctx.db.delete('chatroom_workspaceFileTreeDelta', delta._id);
    }
    if (deltas.length === PURGE_FILE_TREE_BATCH_SIZE) hitBatchLimit = true;

    // Delete delta operations (batched)
    const deltaOperations = await ctx.db
      .query('chatroom_workspaceFileTreeDeltaOperation')
      .withIndex('by_machine_workingDir_operationId', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
      )
      .take(PURGE_FILE_TREE_BATCH_SIZE);
    for (const operation of deltaOperations) {
      await ctx.db.delete('chatroom_workspaceFileTreeDeltaOperation', operation._id);
    }
    if (deltaOperations.length === PURGE_FILE_TREE_BATCH_SIZE) hitBatchLimit = true;

    // Delete v1 file tree (singleton)
    const treeV1 = await ctx.db
      .query('chatroom_workspaceFileTree')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
      )
      .first();
    if (treeV1) await ctx.db.delete('chatroom_workspaceFileTree', treeV1._id);

    // Delete pending requests (batched)
    const requests = await ctx.db
      .query('chatroom_workspaceFileTreeRequests')
      .withIndex('by_machine_workingDir', (q: any) =>
        q.eq('machineId', args.machineId).eq('workingDir', workingDir)
      )
      .take(PURGE_FILE_TREE_BATCH_SIZE);
    for (const req of requests) await ctx.db.delete('chatroom_workspaceFileTreeRequests', req._id);
    if (requests.length === PURGE_FILE_TREE_BATCH_SIZE) hitBatchLimit = true;

    return { complete: !hitBatchLimit };
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
 * @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code.
 *
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
 * @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code.
 *
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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
    await requireRegisteredWorkspaceForMachine(ctx, args.machineId, args.workingDir);
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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
    await requireRegisteredWorkspaceForMachine(ctx, args.machineId, args.workingDir);
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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

/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
/** @deprecated Superseded by unified file tree (V2/V3). Retained for backward compatibility; do not use in new code. */
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
