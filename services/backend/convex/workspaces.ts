/**
 * Convex functions for workspace registry and git integration.
 *
 * This file contains two sections:
 *   1. Workspace Registry — persistent workspace registration (chatroom_workspaces)
 *   2. Workspace Git — git state, diffs, commits (chatroom_workspaceGit* tables)
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';
import type { WorkspaceGitState } from '../src/domain/types/workspace-git';
import { registerWorkspace as registerWorkspaceUseCase } from '../src/domain/usecase/workspace/register-workspace';
import { removeWorkspace as removeWorkspaceUseCase } from '../src/domain/usecase/workspace/remove-workspace';
import { listWorkspacesForMachine as listWorkspacesForMachineUseCase } from '../src/domain/usecase/workspace/list-workspaces-for-machine';
import { listWorkspacesForChatroom as listWorkspacesForChatroomUseCase } from '../src/domain/usecase/workspace/list-workspaces-for-chatroom';

// ─── Workspace Registry (queries + mutations) ────────────────────────────────

/**
 * Registers (or reactivates) a workspace for a chatroom.
 *
 * Called by the daemon or CLI when an agent starts working in a directory.
 * Upsert semantics: if the workspace already exists and is active, no-op.
 * If it was soft-deleted, it gets reactivated.
 */
export const registerWorkspace = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    workingDir: v.string(),
    hostname: v.string(),
    registeredBy: v.string(),
  },
  handler: async (ctx, args) => {
    await validateSession(ctx, args.sessionId);
    return registerWorkspaceUseCase(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      workingDir: args.workingDir,
      hostname: args.hostname,
      registeredBy: args.registeredBy,
    });
  },
});

/**
 * Soft-deletes a workspace by setting its `removedAt` timestamp.
 *
 * Called by users to remove a workspace from the registry.
 */
export const removeWorkspace = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    await validateSession(ctx, args.sessionId);
    return removeWorkspaceUseCase(ctx, { workspaceId: args.workspaceId });
  },
});

/**
 * Lists all active workspaces for a given machine.
 *
 * Called by the daemon to discover which chatrooms/workspaces it manages.
 */
export const listWorkspacesForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) return [];
    return listWorkspacesForMachineUseCase(ctx, { machineId: args.machineId });
  },
});

/**
 * Lists all active workspaces for a given chatroom.
 *
 * Called by the frontend to display workspace information.
 */
export const listWorkspacesForChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) return [];
    return listWorkspacesForChatroomUseCase(ctx, { chatroomId: args.chatroomId });
  },
});

// ─── Workspace Git — Queries (called by frontend) ────────────────────────────

/**
 * Returns the git state for a workspace (machineId + workingDir).
 *
 * Called by the frontend to display branch, diff stats, and recent commits.
 * Returns `{ status: 'loading' }` when no data has been pushed by the daemon yet.
 */
export const getWorkspaceGitState = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args): Promise<WorkspaceGitState> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      return { status: 'loading' };
    }

    const row = await ctx.db
      .query('chatroom_workspaceGitState')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (!row) {
      return { status: 'loading' };
    }

    if (row.status === 'available') {
      return {
        status: 'available',
        branch: row.branch ?? 'HEAD',
        isDirty: row.isDirty ?? false,
        diffStat: row.diffStat ?? { filesChanged: 0, insertions: 0, deletions: 0 },
        recentCommits: row.recentCommits ?? [],
        hasMoreCommits: row.hasMoreCommits ?? false,
        openPullRequests: row.openPullRequests ?? [],
        remotes: row.remotes ?? [],
        updatedAt: row.updatedAt,
      };
    }

    if (row.status === 'not_found') {
      return { status: 'not_found', updatedAt: row.updatedAt };
    }

    // status === 'error'
    return {
      status: 'error',
      message: row.errorMessage ?? 'Unknown error',
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * Returns the full diff content for a workspace's working tree, or null if not yet available.
 *
 * Called by the frontend after `requestFullDiff` to retrieve the result.
 */
export const getFullDiff = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      return null;
    }

    const row = await ctx.db
      .query('chatroom_workspaceFullDiff')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    return row ?? null;
  },
});

/**
 * Returns the commit detail (diff + metadata) for a specific commit SHA, or null if not available.
 *
 * Called by the frontend after `requestCommitDetail` to retrieve the result.
 */
export const getCommitDetail = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    sha: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      return null;
    }

    const row = await ctx.db
      .query('chatroom_workspaceCommitDetail')
      .withIndex('by_machine_workingDir_sha', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('sha', args.sha)
      )
      .first();

    return row ?? null;
  },
});

/**
 * Returns the subset of provided SHAs that are NOT yet in chatroom_workspaceCommitDetail.
 * Used by the daemon to skip pre-fetching commits already stored.
 */
export const getMissingCommitShas = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    shas: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) return [];

    const missing: string[] = [];
    for (const sha of args.shas) {
      const row = await ctx.db
        .query('chatroom_workspaceCommitDetail')
        .withIndex('by_machine_workingDir_sha', (q) =>
          q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('sha', sha)
        )
        .first();
      if (!row) missing.push(sha);
    }
    return missing;
  },
});

// ─── Queries (called by daemon) ───────────────────────────────────────────────

/**
 * Returns all pending diff/commit requests for a machine.
 *
 * Called by the daemon's fast polling loop (~5s) to find work to process.
 */
export const getPendingRequests = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      return [];
    }

    const rows = await ctx.db
      .query('chatroom_workspaceDiffRequests')
      .withIndex('by_machine_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .collect();

    return rows;
  },
});

// ─── Mutations (called by daemon) ─────────────────────────────────────────────

/**
 * Persists the git state for a workspace.
 *
 * Called by the daemon on each heartbeat when the state has changed.
 * Uses upsert pattern: query by index → patch existing or insert new.
 */
export const upsertWorkspaceGitState = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    // Discriminated union status
    status: v.union(v.literal('available'), v.literal('not_found'), v.literal('error')),
    // Fields present when status === 'available'
    branch: v.optional(v.string()),
    isDirty: v.optional(v.boolean()),
    diffStat: v.optional(
      v.object({
        filesChanged: v.number(),
        insertions: v.number(),
        deletions: v.number(),
      })
    ),
    recentCommits: v.optional(
      v.array(
        v.object({
          sha: v.string(),
          shortSha: v.string(),
          message: v.string(),
          author: v.string(),
          date: v.string(),
        })
      )
    ),
    hasMoreCommits: v.optional(v.boolean()),
    // Open pull requests for the current branch
    openPullRequests: v.optional(
      v.array(
        v.object({
          number: v.number(),
          title: v.string(),
          url: v.string(),
          headRefName: v.string(),
          state: v.string(),
        })
      )
    ),
    // Git remotes
    remotes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          url: v.string(),
        })
      )
    ),
    // Field present when status === 'error'
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    const now = Date.now();

    const data = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      status: args.status,
      branch: args.branch,
      isDirty: args.isDirty,
      diffStat: args.diffStat,
      recentCommits: args.recentCommits,
      hasMoreCommits: args.hasMoreCommits,
      openPullRequests: args.openPullRequests,
      remotes: args.remotes,
      errorMessage: args.errorMessage,
      updatedAt: now,
    };

    const existing = await ctx.db
      .query('chatroom_workspaceGitState')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (existing) {
      await ctx.db.patch('chatroom_workspaceGitState', existing._id, data);
    } else {
      await ctx.db.insert('chatroom_workspaceGitState', data);
    }
  },
});

/**
 * Persists the full diff content for a workspace.
 *
 * Called by the daemon after processing a `full_diff` request.
 */
export const upsertFullDiff = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    diffContent: v.string(),
    truncated: v.boolean(),
    diffStat: v.object({
      filesChanged: v.number(),
      insertions: v.number(),
      deletions: v.number(),
    }),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    const now = Date.now();

    const data = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      diffContent: args.diffContent,
      truncated: args.truncated,
      diffStat: args.diffStat,
      updatedAt: now,
    };

    const existing = await ctx.db
      .query('chatroom_workspaceFullDiff')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (existing) {
      await ctx.db.patch('chatroom_workspaceFullDiff', existing._id, data);
    } else {
      await ctx.db.insert('chatroom_workspaceFullDiff', data);
    }
  },
});

/**
 * Persists the diff content and metadata for a specific commit.
 *
 * Called by the daemon after processing a `commit_detail` request.
 */
export const upsertCommitDetail = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    sha: v.string(),
    status: v.union(
      v.literal('available'),
      v.literal('too_large'),
      v.literal('error'),
      v.literal('not_found')
    ),
    // Available when status === 'available'
    diffContent: v.optional(v.string()),
    truncated: v.optional(v.boolean()),
    diffStat: v.optional(
      v.object({
        filesChanged: v.number(),
        insertions: v.number(),
        deletions: v.number(),
      })
    ),
    // Available when status === 'available' or 'too_large'
    message: v.optional(v.string()),
    author: v.optional(v.string()),
    date: v.optional(v.string()),
    // Available when status === 'error'
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    const now = Date.now();

    const existing = await ctx.db
      .query('chatroom_workspaceCommitDetail')
      .withIndex('by_machine_workingDir_sha', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('sha', args.sha)
      )
      .first();

    // Never overwrite a successfully resolved result
    if (existing?.status === 'available') return;

    const data = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      sha: args.sha,
      status: args.status,
      diffContent: args.diffContent,
      truncated: args.truncated,
      diffStat: args.diffStat,
      message: args.message,
      author: args.author,
      date: args.date,
      errorMessage: args.errorMessage,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch('chatroom_workspaceCommitDetail', existing._id, data);
    } else {
      await ctx.db.insert('chatroom_workspaceCommitDetail', data);
    }
  },
});

/**
 * Appends additional commits to the git state's `recentCommits` array.
 *
 * Called by the daemon after processing a `more_commits` request.
 * Reads the existing state, appends new commits, and updates `hasMoreCommits`.
 */
export const appendMoreCommits = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    commits: v.array(
      v.object({
        sha: v.string(),
        shortSha: v.string(),
        message: v.string(),
        author: v.string(),
        date: v.string(),
      })
    ),
    hasMoreCommits: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    const existing = await ctx.db
      .query('chatroom_workspaceGitState')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (!existing) {
      // Nothing to append to — daemon should upsert git state first
      return;
    }

    const currentCommits = existing.recentCommits ?? [];
    const updatedCommits = [...currentCommits, ...args.commits];

    await ctx.db.patch('chatroom_workspaceGitState', existing._id, {
      recentCommits: updatedCommits,
      hasMoreCommits: args.hasMoreCommits,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Updates the status of a diff request row.
 *
 * Called by the daemon to transition requests through:
 * `pending` → `processing` → `done` | `error`
 */
export const updateRequestStatus = mutation({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_workspaceDiffRequests'),
    status: v.union(
      v.literal('pending'),
      v.literal('processing'),
      v.literal('done'),
      v.literal('error')
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    await ctx.db.patch('chatroom_workspaceDiffRequests', args.requestId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

// ─── Mutations (called by frontend) ──────────────────────────────────────────

/**
 * Requests the full diff content for a workspace's working tree.
 *
 * The daemon processes the request on its fast polling loop (~5s response).
 * Idempotent: if a pending request already exists, it is not duplicated.
 * The frontend subscribes to `getFullDiff` to receive the result.
 */
export const requestFullDiff = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    // Idempotency: check for existing pending request
    const existing = await ctx.db
      .query('chatroom_workspaceDiffRequests')
      .withIndex('by_machine_workingDir_type', (q) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('requestType', 'full_diff')
      )
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .first();

    if (existing) {
      // Already pending — no-op
      return;
    }

    const now = Date.now();
    await ctx.db.insert('chatroom_workspaceDiffRequests', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      requestType: 'full_diff',
      status: 'pending',
      requestedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Requests the full diff for a specific commit SHA.
 *
 * Idempotent: if a pending request already exists for the same SHA, it is not duplicated.
 * The frontend subscribes to `getCommitDetail` to receive the result.
 */
export const requestCommitDetail = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    sha: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    // Idempotency: check for existing pending request for this sha
    const existing = await ctx.db
      .query('chatroom_workspaceDiffRequests')
      .withIndex('by_machine_workingDir_type', (q) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('requestType', 'commit_detail')
      )
      .filter((q) => q.and(q.eq(q.field('status'), 'pending'), q.eq(q.field('sha'), args.sha)))
      .first();

    if (existing) {
      // Already pending — no-op
      return;
    }

    const now = Date.now();
    await ctx.db.insert('chatroom_workspaceDiffRequests', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      requestType: 'commit_detail',
      sha: args.sha,
      status: 'pending',
      requestedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Requests more commits (pagination) for a workspace's git log.
 *
 * Idempotent: if a pending request already exists for the same offset, it is not duplicated.
 * The daemon appends the new commits via `appendMoreCommits`.
 */
export const requestMoreCommits = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    offset: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    // Idempotency: check for existing pending request for this offset
    const existing = await ctx.db
      .query('chatroom_workspaceDiffRequests')
      .withIndex('by_machine_workingDir_type', (q) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('requestType', 'more_commits')
      )
      .filter((q) =>
        q.and(q.eq(q.field('status'), 'pending'), q.eq(q.field('offset'), args.offset))
      )
      .first();

    if (existing) {
      // Already pending — no-op
      return;
    }

    const now = Date.now();
    await ctx.db.insert('chatroom_workspaceDiffRequests', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      requestType: 'more_commits',
      offset: args.offset,
      status: 'pending',
      requestedAt: now,
      updatedAt: now,
    });
  },
});
