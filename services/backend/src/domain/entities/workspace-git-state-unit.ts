/**
 * Domain Model: Workspace Git State Unit
 *
 * A single, independently-syncable slice of a workspace's git state. The daemon
 * pushes one unit at a time (e.g. only the HEAD branch after a checkout) instead
 * of re-sending the whole git state on every change.
 *
 * Shared by the `patchWorkspaceGitState` mutation and the CLI, which imports the
 * types from `@workspace/backend/src/...`.
 */

import { v, type Infer } from 'convex/values';

import type { TableNames } from '../../../convex/_generated/dataModel';

export const diffStatValidator = v.object({
  filesChanged: v.number(),
  insertions: v.number(),
  deletions: v.number(),
});

export const commitStatusValidator = v.object({
  state: v.string(),
  checkRuns: v.array(
    v.object({
      name: v.string(),
      status: v.string(),
      conclusion: v.union(v.string(), v.null()),
    })
  ),
  totalCount: v.number(),
});

export const remoteValidator = v.object({ name: v.string(), url: v.string() });

export const openPullRequestValidator = v.object({
  prNumber: v.number(),
  title: v.string(),
  url: v.string(),
  headRefName: v.string(),
  state: v.string(),
});

/**
 * Discriminated union on `kind`. Each variant carries only the fields that
 * unit owns; a unit never touches fields belonging to another unit.
 *
 * Constraint: only the `head` unit may change `status`. Non-head units leave
 * the `status` field as the head unit last set it.
 */
export const workspaceGitStateUnitValidator = v.union(
  v.object({ kind: v.literal('head'), status: v.literal('available'), branch: v.string() }),
  v.object({ kind: v.literal('head'), status: v.literal('not_found') }),
  v.object({ kind: v.literal('head'), status: v.literal('error'), errorMessage: v.string() }),
  v.object({ kind: v.literal('worktree'), isDirty: v.boolean(), diffStat: diffStatValidator }),
  v.object({
    kind: v.literal('upstream'),
    commitsAhead: v.number(),
    commitsBehind: v.number(),
  }),
  v.object({ kind: v.literal('remotes'), remotes: v.array(remoteValidator) }),
  v.object({
    kind: v.literal('pullRequests'),
    openPullRequests: v.array(openPullRequestValidator),
  }),
  v.object({
    kind: v.literal('checks'),
    headCommitStatus: v.union(commitStatusValidator, v.null()),
  })
);

export type WorkspaceGitStateUnit = Infer<typeof workspaceGitStateUnitValidator>;

/**
 * The per-unit table that stores each git unit. `satisfies` makes a new unit kind fail to compile
 * until it is given a table.
 */
export const WORKSPACE_GIT_UNIT_TABLE = {
  head: 'chatroom_workspaceGitHead',
  worktree: 'chatroom_workspaceGitWorktree',
  upstream: 'chatroom_workspaceGitUpstream',
  remotes: 'chatroom_workspaceGitRemotes',
  pullRequests: 'chatroom_workspaceGitPullRequests',
  checks: 'chatroom_workspaceGitChecks',
} as const satisfies Record<WorkspaceGitStateUnit['kind'], TableNames>;
