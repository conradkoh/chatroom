/**
 * Convex functions for workspace git integration.
 *
 * These functions expose the workspace git domain use cases to the frontend
 * and daemon CLI.
 *
 * Phase 2: Returns mock data from domain use cases. Phase 5+ will read/write
 * to database tables (`chatroom_workspaceGitState`, `chatroom_workspaceDiffRequests`).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { validateSession } from './auth/cliSessionAuth';
import { getWorkspaceGitState as getWorkspaceGitStateUseCase } from '../src/domain/usecase/workspace/get-workspace-git-state';
import { requestFullDiff as requestFullDiffUseCase } from '../src/domain/usecase/workspace/request-full-diff';
import { upsertWorkspaceGitState as upsertWorkspaceGitStateUseCase } from '../src/domain/usecase/workspace/upsert-workspace-git-state';
import type { WorkspaceGitState } from '../src/domain/types/workspace-git';

// ─── Queries ─────────────────────────────────────────────────────────────────

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

    return getWorkspaceGitStateUseCase(args.machineId, args.workingDir);
  },
});

// ─── Mutations (called by frontend) ──────────────────────────────────────────

/**
 * Requests the full diff content for a workspace's working tree.
 *
 * The daemon processes the request on its fast polling loop (~5s response).
 * The frontend subscribes to `getFullDiff` to receive the result.
 *
 * Phase 2: No-op stub.
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

    await requestFullDiffUseCase(ctx, {
      machineId: args.machineId,
      workingDir: args.workingDir,
    });
  },
});

// ─── Mutations (called by daemon) ─────────────────────────────────────────────

/**
 * Persists the git state for a workspace.
 *
 * Called by the daemon on each heartbeat when the state has changed.
 * Uses change-detection: daemon skips this mutation when state is unchanged.
 *
 * Phase 2: No-op stub.
 */
export const upsertWorkspaceGitState = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    // Discriminated union status
    status: v.union(
      v.literal('available'),
      v.literal('not_found'),
      v.literal('error')
    ),
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
    // Field present when status === 'error'
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await validateSession(ctx, args.sessionId);
    if (!session.valid) {
      throw new Error('Authentication required');
    }

    // Build the WorkspaceGitState discriminated union from flat args
    let state: WorkspaceGitState;
    const now = Date.now();

    if (args.status === 'available') {
      state = {
        status: 'available',
        branch: args.branch ?? 'HEAD',
        isDirty: args.isDirty ?? false,
        diffStat: args.diffStat ?? { filesChanged: 0, insertions: 0, deletions: 0 },
        recentCommits: args.recentCommits ?? [],
        hasMoreCommits: args.hasMoreCommits ?? false,
        updatedAt: now,
      };
    } else if (args.status === 'not_found') {
      state = { status: 'not_found', updatedAt: now };
    } else {
      state = {
        status: 'error',
        message: args.errorMessage ?? 'Unknown error',
        updatedAt: now,
      };
    }

    await upsertWorkspaceGitStateUseCase(ctx, {
      machineId: args.machineId,
      workingDir: args.workingDir,
      state,
    });
  },
});
