/**
 * Local / one-off maintenance for workspace git cache.
 *
 * Deletes every document in `chatroom_workspaceGitState` (daemon repopulates on next heartbeat).
 * Use when legacy rows used GitHub's `number` instead of `prNumber` and schema validation failed.
 *
 * Run from repo root:
 *   bash scripts/clear-workspace-git-state.sh
 *
 * Or from services/backend:
 *   pnpm run clear-workspace-git-state
 *   # or: pnpm exec convex run devWorkspaceGitCleanup:deleteAllWorkspaceGitState --push
 *
 * PR diff / commit cache (wrong shape without `prNumber`):
 *   pnpm run clear-workspace-pr-cache
 */
import { internalMutation } from './_generated/server';

export const deleteAllWorkspaceGitState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('chatroom_workspaceGitState').collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deletedCount: rows.length };
  },
});

/** Clears cached PR diffs (legacy rows may lack `prNumber`). */
export const deleteAllWorkspacePRDiffs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('chatroom_workspacePRDiffs').collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deletedCount: rows.length };
  },
});

/** Clears cached PR commit lists. */
export const deleteAllWorkspacePRCommits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('chatroom_workspacePRCommits').collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deletedCount: rows.length };
  },
});
