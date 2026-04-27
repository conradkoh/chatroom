/**
 * Git Heartbeat — collects and pushes git state for all tracked workspaces.
 *
 * Called on every daemon heartbeat (every 30s) alongside `api.machines.daemonHeartbeat`.
 * Uses change detection to skip unchanged state and avoid unnecessary backend writes.
 */

import { createHash } from 'node:crypto';

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { makeGitStateKey, COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import type { GitCommit } from '../../../infrastructure/git/types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/**
 * Collect git state for all tracked working directories and push to backend.
 *
 * Queries the backend for registered workspaces on this machine, then runs
 * git commands for each unique working directory and pushes state changes.
 *
 * Safe to call concurrently with the heartbeat — errors per-workspace are
 * caught and logged without aborting the loop.
 */
export async function pushGitState(ctx: DaemonContext): Promise<void> {
  // Query backend for all registered workspaces on this machine
  let workspaces: Array<{ workingDir: string }>;
  try {
    workspaces = await ctx.deps.backend.query(api.workspaces.listWorkspacesForMachine, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to query workspaces for git sync: ${getErrorMessage(err)}`
    );
    return; // Skip this cycle — will retry on next heartbeat
  }

  // Deduplicate working directories (multiple chatrooms may share a workingDir)
  const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));

  if (uniqueWorkingDirs.size === 0) return;

  for (const workingDir of uniqueWorkingDirs) {
    try {
      await pushSingleWorkspaceGitState(ctx, workingDir);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Git state push failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    }
  }
}

export async function pushSingleWorkspaceGitState(
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
  const [branchResult, dirtyResult, commits, commitsAhead] = await Promise.all([
    gitReader.getBranch(workingDir),
    gitReader.isDirty(workingDir),
    gitReader.getRecentCommits(workingDir, COMMITS_PER_PAGE),
    gitReader.getCommitsAhead(workingDir),
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

  // Fetch open PRs for the current branch (non-blocking on failure)
  const openPRs = await gitReader.getOpenPRsForBranch(workingDir, branchResult.branch);

  // Fetch commit status checks for the current branch head (non-blocking on failure)
  const headCommitStatus = await gitReader.getCommitStatusChecks(workingDir, branchResult.branch);

  // Build available state
  const branch = branchResult.branch;
  const isDirty = dirtyResult;
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  // Change detection: hash the relevant state to skip unchanged pushes
  const stateHash = createHash('md5')
    .update(
      JSON.stringify({
        branch,
        isDirty,
        commitsAhead,
        shas: commits.map((c) => c.sha),
        prs: openPRs.map((pr) => pr.prNumber),
        headCommitStatus,
      })
    )
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
    recentCommits: commits,
    hasMoreCommits,
    openPullRequests: openPRs,
    commitsAhead,
    headCommitStatus,
  });

  ctx.lastPushedGitState.set(stateKey, stateHash);
  console.log(
    `[${formatTimestamp()}] 🔀 Git state pushed: ${workingDir} (${branch}${isDirty ? ', dirty' : ', clean'})`
  );
}
