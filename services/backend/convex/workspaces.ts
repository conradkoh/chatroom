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
import { str } from './utils/types';
import { validateSession } from './auth/cliSessionAuth';
import { checkAccess, requireAccess } from './auth/accessCheck';
import type { WorkspaceGitState } from '../src/domain/types/workspace-git';
import { registerWorkspace as registerWorkspaceUseCase } from '../src/domain/usecase/workspace/register-workspace';
import { removeWorkspace as removeWorkspaceUseCase } from '../src/domain/usecase/workspace/remove-workspace';
import { listWorkspacesForMachine as listWorkspacesForMachineUseCase } from '../src/domain/usecase/workspace/list-workspaces-for-machine';
import { listWorkspacesForChatroom as listWorkspacesForChatroomUseCase } from '../src/domain/usecase/workspace/list-workspaces-for-chatroom';

// ─── Workspace Registry (queries + mutations) ────────────────────────────────

/** Convert a Convex Id to a plain string for the pure-function layer. */

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
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) throw new Error('Authentication required');

    // Verify the user owns the machine being registered
    await requireAccess(ctx, {
      accessor: { type: 'user', id: session.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'owner',
    });

    // Verify the user has access to the chatroom
    await requireAccess(ctx, {
      accessor: { type: 'user', id: session.userId },
      resource: { type: 'chatroom', id: str(args.chatroomId) },
      permission: 'write-access',
    });

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
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) throw new Error('Authentication required');

    // Look up the workspace to verify access
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    // Verify the user has write-access to the machine this workspace belongs to
    await requireAccess(ctx, {
      accessor: { type: 'user', id: session.userId },
      resource: { type: 'machine', id: workspace.machineId },
      permission: 'write-access',
    });

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
    if (!session.ok) return [];
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
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
    if (!session.ok) return [];

    const chatroomAccessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: session.userId },
      resource: { type: 'chatroom', id: str(args.chatroomId) },
      permission: 'read-access',
    });
    if (!chatroomAccessResult.ok) return [];

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
    if (!session.ok) {
      return { status: 'loading' };
    }
    const accessResult = await checkAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
    if (!accessResult.ok) {
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
        allPullRequests: row.allPullRequests ?? [],
        remotes: row.remotes ?? [],
        commitsAhead: row.commitsAhead ?? 0,
        defaultBranch: row.defaultBranch ?? null,
        headCommitStatus: row.headCommitStatus ?? null,
        defaultBranchStatus: row.defaultBranchStatus ?? null,
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
    if (!session.ok) {
      return null;
    }
    const accessResult = await checkAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
    if (!accessResult.ok) return null;

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
 * Returns the stored PR diff for a machine/workingDir, or null if not available.
 *
 * Called by the frontend after `requestPRDiff` to retrieve the result.
 */
export const getPRDiff = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) {
      return null;
    }
    const accessResult = await checkAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
    if (!accessResult.ok) return null;

    const row = await ctx.db
      .query('chatroom_workspacePRDiffs')
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
    if (!session.ok) {
      return null;
    }
    const accessResult = await checkAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
    if (!accessResult.ok) return null;

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
    if (!session.ok) return [];
    const accessResult = await checkAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
    if (!accessResult.ok) return [];

    if (args.shas.length === 0) return [];

    // Individual lookups using the full 3-field index (machineId, workingDir, sha).
    // This avoids reading all commit documents (which include large diffContent)
    // and only reads the specific documents that match each requested SHA.
    const missingShas: string[] = [];
    for (const sha of args.shas) {
      const existing = await ctx.db
        .query('chatroom_workspaceCommitDetail')
        .withIndex('by_machine_workingDir_sha', (q) =>
          q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('sha', sha)
        )
        .first();
      if (!existing) {
        missingShas.push(sha);
      }
    }
    return missingShas;
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
    if (!session.ok) {
      return [];
    }
    const accessResult = await checkAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
    if (!accessResult.ok) return [];

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
    allPullRequests: v.optional(
      v.array(
        v.object({
          number: v.number(),
          title: v.string(),
          url: v.string(),
          headRefName: v.string(),
          baseRefName: v.optional(v.string()),
          state: v.string(),
          author: v.optional(v.string()),
          createdAt: v.optional(v.string()),
          updatedAt: v.optional(v.string()),
          mergedAt: v.optional(v.union(v.string(), v.null())),
          closedAt: v.optional(v.union(v.string(), v.null())),
          isDraft: v.optional(v.boolean()),
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
    // Commits ahead of upstream (unpushed)
    commitsAhead: v.optional(v.number()),
    // Default branch name
    defaultBranch: v.optional(v.union(v.string(), v.null())),
    // CI/CD status checks for current branch head
    headCommitStatus: v.optional(v.union(
      v.object({
        state: v.string(),
        checkRuns: v.array(v.object({
          name: v.string(),
          status: v.string(),
          conclusion: v.union(v.string(), v.null()),
        })),
        totalCount: v.number(),
      }),
      v.null()
    )),
    // CI/CD status checks for default branch
    defaultBranchStatus: v.optional(v.union(
      v.object({
        state: v.string(),
        checkRuns: v.array(v.object({
          name: v.string(),
          status: v.string(),
          conclusion: v.union(v.string(), v.null()),
        })),
        totalCount: v.number(),
      }),
      v.null()
    )),
    // Field present when status === 'error'
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

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
      allPullRequests: args.allPullRequests,
      remotes: args.remotes,
      commitsAhead: args.commitsAhead,
      defaultBranch: args.defaultBranch,
      headCommitStatus: args.headCommitStatus,
      defaultBranchStatus: args.defaultBranchStatus,
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
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

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
 * Persists the PR diff content for a machine/workingDir (upsert).
 *
 * Called by the daemon after processing a `pr_diff` request.
 */
export const upsertPRDiff = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    baseBranch: v.string(),
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
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    const now = Date.now();

    const data = {
      machineId: args.machineId,
      workingDir: args.workingDir,
      baseBranch: args.baseBranch,
      diffContent: args.diffContent,
      truncated: args.truncated,
      diffStat: args.diffStat,
      updatedAt: now,
    };

    const existing = await ctx.db
      .query('chatroom_workspacePRDiffs')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .first();

    if (existing) {
      await ctx.db.patch('chatroom_workspacePRDiffs', existing._id, data);
    } else {
      await ctx.db.insert('chatroom_workspacePRDiffs', data);
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
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

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
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

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
    if (!session.ok) {
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
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

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
 * Requests a PR diff (diff between base branch and HEAD) for a workspace.
 *
 * Idempotent: if a pending request already exists, it is not duplicated.
 * The frontend subscribes to `getPRDiff` to receive the result.
 */
export const requestPRDiff = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    baseBranch: v.string(),
    prNumber: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    // Idempotency: check for existing pending request
    const existing = await ctx.db
      .query('chatroom_workspaceDiffRequests')
      .withIndex('by_machine_workingDir_type', (q) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('requestType', 'pr_diff')
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
      requestType: 'pr_diff',
      baseBranch: args.baseBranch,
      prNumber: args.prNumber,
      status: 'pending',
      requestedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Requests a PR action (merge/close) to be executed by the daemon.
 *
 * NOT idempotent — each call creates a new request.
 */
export const requestPRAction = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    prNumber: v.number(),
    prAction: v.union(v.literal('merge_squash'), v.literal('merge_no_squash'), v.literal('close')),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    const now = Date.now();
    await ctx.db.insert('chatroom_workspaceDiffRequests', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      requestType: 'pr_action',
      prAction: args.prAction,
      prNumber: args.prNumber,
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
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

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
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

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

// ─── PR Commits ─────────────────────────────────────────────────────────────

/**
 * Returns the cached list of commits for a specific PR, or null if not available.
 *
 * Called by the frontend after `requestPRCommits` to retrieve the result.
 */
export const getPRCommits = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) {
      return null;
    }
    const accessResult = await checkAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });
    if (!accessResult.ok) return null;

    const row = await ctx.db
      .query('chatroom_workspacePRCommits')
      .withIndex('by_machine_workingDir_prNumber', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('prNumber', args.prNumber)
      )
      .first();

    return row ?? null;
  },
});

/**
 * Requests the daemon to fetch the list of commits for a specific PR.
 *
 * Idempotent: if a pending request already exists, this is a no-op.
 * The frontend subscribes to `getPRCommits` to receive the result.
 */
export const requestPRCommits = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    prNumber: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) {
      throw new Error('Authentication required');
    }
    await requireAccess(ctx, { accessor: { type: 'user', id: session.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    // Idempotency: check for existing pending request
    const existing = await ctx.db
      .query('chatroom_workspaceDiffRequests')
      .withIndex('by_machine_workingDir_type', (q) =>
        q
          .eq('machineId', args.machineId)
          .eq('workingDir', args.workingDir)
          .eq('requestType', 'pr_commits')
      )
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .first();

    if (existing) {
      return;
    }

    const now = Date.now();
    await ctx.db.insert('chatroom_workspaceDiffRequests', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      requestType: 'pr_commits',
      prNumber: args.prNumber,
      status: 'pending',
      requestedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Called by the daemon after processing a `pr_commits` request.
 * Upserts the PR commit list for the given workspace + PR number.
 */
export const upsertPRCommits = mutation({
  args: {
    machineId: v.string(),
    workingDir: v.string(),
    prNumber: v.number(),
    commits: v.array(
      v.object({
        sha: v.string(),
        shortSha: v.string(),
        message: v.string(),
        author: v.string(),
        date: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const existing = await ctx.db
      .query('chatroom_workspacePRCommits')
      .withIndex('by_machine_workingDir_prNumber', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('prNumber', args.prNumber)
      )
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        commits: args.commits,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_workspacePRCommits', {
        machineId: args.machineId,
        workingDir: args.workingDir,
        prNumber: args.prNumber,
        commits: args.commits,
        updatedAt: now,
      });
    }
  },
});
