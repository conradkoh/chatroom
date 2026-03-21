/**
 * Git Heartbeat — collects and pushes git state for all tracked workspaces.
 *
 * Called on every daemon heartbeat (every 30s) alongside `api.machines.daemonHeartbeat`.
 * Uses change detection to skip unchanged state and avoid unnecessary backend writes.
 */

import { createHash } from 'node:crypto';

import { extractDiffStatFromShowOutput } from './git-polling.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { makeGitStateKey, COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import type { GitCommit } from '../../../infrastructure/git/types.js';

/**
 * Collect git state for all tracked working directories and push to backend.
 *
 * Queries the backend for registered workspaces on this machine, then runs
 * git commands for each unique working directory and pushes state changes.
 * Falls back to `ctx.activeWorkingDirs` if the backend query fails.
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
      `[${formatTimestamp()}] ⚠️ Failed to query workspaces for git sync: ${(err as Error).message}`
    );
    // Fallback to activeWorkingDirs for resilience
    workspaces = Array.from(ctx.activeWorkingDirs).map((wd) => ({ workingDir: wd }));
  }

  // Deduplicate working directories (multiple chatrooms may share a workingDir)
  const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));

  if (uniqueWorkingDirs.size === 0) return;

  for (const workingDir of uniqueWorkingDirs) {
    try {
      await pushSingleWorkspaceGitState(ctx, workingDir);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Git state push failed for ${workingDir}: ${(err as Error).message}`
      );
    }
  }
}

async function pushSingleWorkspaceGitState(ctx: DaemonContext, workingDir: string): Promise<void> {
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

  // Fetch open PRs for the current branch (non-blocking on failure)
  const openPRs = await gitReader.getOpenPRsForBranch(workingDir, branchResult.branch);

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
    .update(JSON.stringify({ branch, isDirty, diffStat, shas: commits.map((c) => c.sha), prs: openPRs.map((pr) => pr.number) }))
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
    openPullRequests: openPRs,
  });

  ctx.lastPushedGitState.set(stateKey, stateHash);
  console.log(
    `[${formatTimestamp()}] 🔀 Git state pushed: ${workingDir} (${branch}${isDirty ? ', dirty' : ', clean'})`
  );

  // Pre-fetch commit details for commits not yet stored (background, non-blocking)
  prefetchMissingCommitDetails(ctx, workingDir, commits).catch((err: Error) => {
    console.warn(
      `[${formatTimestamp()}] ⚠️  Commit pre-fetch failed for ${workingDir}: ${err.message}`
    );
  });
}

/**
 * Eagerly pre-fetches commit details for any commits not yet stored in the backend.
 * Called after each successful git state push to fill the commit detail cache
 * so users see instant results when clicking on commits.
 */
async function prefetchMissingCommitDetails(
  ctx: DaemonContext,
  workingDir: string,
  commits: GitCommit[]
): Promise<void> {
  if (commits.length === 0) return;

  const shas = commits.map((c) => c.sha);

  // Ask backend which SHAs we don't have yet
  const missingShas = await ctx.deps.backend.query(api.workspaces.getMissingCommitShas, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    shas,
  });

  if (missingShas.length === 0) return;

  console.log(
    `[${formatTimestamp()}] 🔍 Pre-fetching ${missingShas.length} commit(s) for ${workingDir}`
  );

  for (const sha of missingShas) {
    try {
      await prefetchSingleCommit(ctx, workingDir, sha, commits);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Pre-fetch failed for ${sha.slice(0, 7)}: ${(err as Error).message}`
      );
    }
  }
}

async function prefetchSingleCommit(
  ctx: DaemonContext,
  workingDir: string,
  sha: string,
  commits: GitCommit[]
): Promise<void> {
  const metadata = commits.find((c) => c.sha === sha);
  const result = await gitReader.getCommitDetail(workingDir, sha);

  if (result.status === 'not_found') {
    await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetail, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      sha,
      status: 'not_found',
      message: metadata?.message,
      author: metadata?.author,
      date: metadata?.date,
    });
    return;
  }

  if (result.status === 'error') {
    await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetail, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      sha,
      status: 'error',
      errorMessage: result.message,
      message: metadata?.message,
      author: metadata?.author,
      date: metadata?.date,
    });
    return;
  }

  // available or truncated
  const diffStat = extractDiffStatFromShowOutput(result.content);
  await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetail, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    sha,
    status: 'available',
    diffContent: result.content,
    truncated: result.truncated,
    message: metadata?.message,
    author: metadata?.author,
    date: metadata?.date,
    diffStat,
  });

  console.log(`[${formatTimestamp()}] ✅ Pre-fetched: ${sha.slice(0, 7)} in ${workingDir}`);
}
