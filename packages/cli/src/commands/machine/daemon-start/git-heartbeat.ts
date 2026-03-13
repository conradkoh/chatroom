/**
 * Git Heartbeat — collects and pushes git state for all tracked workspaces.
 *
 * Called on every daemon heartbeat (every 30s) alongside `api.machines.daemonHeartbeat`.
 * Uses change detection to skip unchanged state and avoid unnecessary backend writes.
 */

import { createHash } from 'node:crypto';

import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { makeGitStateKey } from '../../../infrastructure/git/types.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';

const COMMITS_PER_PAGE = 20;

/**
 * Collect git state for all tracked working directories and push to backend.
 *
 * Iterates over `ctx.activeWorkingDirs`, runs git commands for each, and
 * calls `api.workspaces.upsertWorkspaceGitState` when the state has changed.
 *
 * Safe to call concurrently with the heartbeat — errors per-workspace are
 * caught and logged without aborting the loop.
 */
export async function pushGitState(ctx: DaemonContext): Promise<void> {
  if (ctx.activeWorkingDirs.size === 0) return;

  for (const workingDir of ctx.activeWorkingDirs) {
    try {
      await pushSingleWorkspaceGitState(ctx, workingDir);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Git state push failed for ${workingDir}: ${(err as Error).message}`
      );
    }
  }
}

async function pushSingleWorkspaceGitState(
  ctx: DaemonContext,
  workingDir: string
): Promise<void> {
  const stateKey = makeGitStateKey(ctx.machineId, workingDir);

  // Check if it's a git repo first
  const isRepo = await gitReader.isGitRepo(workingDir);
  if (!isRepo) {
    const stateHash = 'not_found';
    if (ctx.lastPushedGitState.get(stateKey) === stateHash) return;

    await ctx.deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      status: 'not_found',
    });
    ctx.lastPushedGitState.set(stateKey, stateHash);
    return;
  }

  // Collect git state in parallel for efficiency
  const [branchResult, dirtyResult, diffStatResult, commits] = await Promise.all([
    gitReader.getBranch(workingDir),
    gitReader.isDirty(workingDir),
    gitReader.getDiffStat(workingDir),
    gitReader.getRecentCommits(workingDir, COMMITS_PER_PAGE),
  ]);

  // Handle error state from branch (primary indicator)
  if (branchResult.status === 'error') {
    const stateHash = `error:${branchResult.message}`;
    if (ctx.lastPushedGitState.get(stateKey) === stateHash) return;

    await ctx.deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      status: 'error',
      errorMessage: branchResult.message,
    });
    ctx.lastPushedGitState.set(stateKey, stateHash);
    return;
  }

  if (branchResult.status === 'not_found') {
    // Shouldn't happen since isGitRepo() passed, but handle gracefully
    return;
  }

  // Build available state
  const branch = branchResult.branch;
  const isDirty = dirtyResult;
  const diffStat =
    diffStatResult.status === 'available'
      ? diffStatResult.diffStat
      : { filesChanged: 0, insertions: 0, deletions: 0 };
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  // Change detection: hash the relevant state to skip unchanged pushes
  const stateHash = createHash('md5')
    .update(JSON.stringify({ branch, isDirty, diffStat, shas: commits.map((c) => c.sha) }))
    .digest('hex');

  if (ctx.lastPushedGitState.get(stateKey) === stateHash) {
    return; // No change — skip push
  }

  // Push to backend
  await ctx.deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    status: 'available',
    branch,
    isDirty,
    diffStat,
    recentCommits: commits,
    hasMoreCommits,
  });

  ctx.lastPushedGitState.set(stateKey, stateHash);
  console.log(
    `[${formatTimestamp()}] 🔀 Git state pushed: ${workingDir} (${branch}${isDirty ? ', dirty' : ', clean'})`
  );
}
