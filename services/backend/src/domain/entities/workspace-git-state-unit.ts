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

const diffStatValidator = v.object({
  filesChanged: v.number(),
  insertions: v.number(),
  deletions: v.number(),
});

const commitStatusValidator = v.object({
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
  v.object({
    kind: v.literal('remotes'),
    remotes: v.array(v.object({ name: v.string(), url: v.string() })),
  }),
  v.object({
    kind: v.literal('pullRequests'),
    openPullRequests: v.array(
      v.object({
        prNumber: v.number(),
        title: v.string(),
        url: v.string(),
        headRefName: v.string(),
        state: v.string(),
      })
    ),
  }),
  v.object({
    kind: v.literal('checks'),
    headCommitStatus: v.union(commitStatusValidator, v.null()),
  })
);

export type WorkspaceGitStateUnit = Infer<typeof workspaceGitStateUnitValidator>;
