import { OBSERVED_FULL_PUSH_INTERVAL_MS } from '@workspace/backend/config/reliability.js';
import { extractDiffStatFromShowOutput } from './git-subscription.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import type { GitRemoteEntry, CommitStatusCheck } from '../../../infrastructure/git/git-reader.js';
import type { GitStateFieldDef } from '../../../infrastructure/git/git-state-pipeline.js';
import { GitStatePipeline } from '../../../infrastructure/git/git-state-pipeline.js';
import { makeGitStateKey, COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';

/** Tracks the last time a full (non-slim) git state push was performed per workspace.
 *  Key: makeGitStateKey(machineId, workingDir). Value: Date.now() of last full push. */
const lastFullPushMs = new Map<string, number>();

import type {
  GitCommit,
  GitBranchResult,
  GitDiffStatResult,
 GitPullRequest } from '../../../infrastructure/git/types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/**
 * Branch field descriptor — pre-collected before the pipeline runs.
 * `collect` throws because branch is always fetched ahead of time for error checking.
 * The pre-fetched result is passed via `preCollected` to `GitStatePipeline.collect()`.
 */
const branchField: GitStateFieldDef<unknown, unknown, Record<string, unknown>> = {
  key: 'branch',
  includeInSlim: true,
  collect: () => {
    throw new Error('branch must be pre-collected');
  },
  toHashable: (raw) => {
    const r = raw as GitBranchResult;
    return r.status === 'available' ? r.branch : 'unknown';
  },
  toMutationPartial: (raw) => {
    const r = raw as GitBranchResult;
    return r.status === 'available' ? { branch: r.branch } : {};
  },
  defaultValue: { status: 'not_found' } as GitBranchResult,
};

/**
 * All branch-independent fields for the git state pipeline.
 * These can be collected in parallel without knowing the branch name.
 * Note: `branch` is NOT included here — it's pre-collected via branchField.
 */
const GIT_STATE_FIELDS: GitStateFieldDef<unknown, unknown, Record<string, unknown>>[] = [
  {
    key: 'isDirty',
    includeInSlim: true,
    collect: (wd) => gitReader.isDirty(wd),
    toHashable: (raw) => raw,
    toMutationPartial: (raw) => ({ isDirty: raw as boolean }),
    defaultValue: false,
  },
  {
    key: 'diffStat',
    includeInSlim: false,
    collect: (wd) => gitReader.getDiffStat(wd),
    toHashable: (raw) => {
      const r = raw as GitDiffStatResult;
      return r.status === 'available'
        ? r.diffStat
        : { filesChanged: 0, insertions: 0, deletions: 0 };
    },
    toMutationPartial: (raw) => {
      const r = raw as GitDiffStatResult;
      return {
        diffStat:
          r.status === 'available' ? r.diffStat : { filesChanged: 0, insertions: 0, deletions: 0 },
      };
    },
    defaultValue: { status: 'not_found' } as GitDiffStatResult,
  },
  {
    key: 'commitsAhead',
    includeInSlim: false,
    collect: (wd) => gitReader.getCommitsAhead(wd),
    toHashable: (raw) => raw,
    toMutationPartial: (raw) => ({ commitsAhead: raw as number }),
    defaultValue: 0,
  },
  {
    key: 'remotes',
    includeInSlim: false,
    collect: (wd) => gitReader.getRemotes(wd),
    toHashable: (raw) => (raw as GitRemoteEntry[]).map((r) => `${r.name}:${r.url}`),
    toMutationPartial: (raw) => ({ remotes: raw as GitRemoteEntry[] }),
    defaultValue: [] as GitRemoteEntry[],
  },
  {
    key: 'allPullRequests',
    includeInSlim: false,
    collect: (wd) => gitReader.getAllPRs(wd),
    toHashable: (raw) => (raw as GitPullRequest[]).map((pr) => `${pr.prNumber}:${pr.state}`),
    toMutationPartial: (raw) => ({ allPullRequests: raw as GitPullRequest[] }),
    defaultValue: [] as GitPullRequest[],
  },
];

function makeBranchDependentFields(
  branch: string
): GitStateFieldDef<unknown, unknown, Record<string, unknown>>[] {
  return [
    {
      key: 'openPullRequests',
      includeInSlim: true,
      collect: (wd) => gitReader.getOpenPRsForBranch(wd, branch),
      toHashable: (raw) => (raw as GitPullRequest[]).map((pr) => pr.prNumber),
      toMutationPartial: (raw) => ({ openPullRequests: raw as GitPullRequest[] }),
      defaultValue: [] as GitPullRequest[],
    },
    {
      key: 'headCommitStatus',
      includeInSlim: true,
      collect: (wd) => gitReader.getCommitStatusChecks(wd, branch),
      toHashable: (raw) => raw,
      toMutationPartial: (raw) => ({ headCommitStatus: raw as CommitStatusCheck | null }),
      defaultValue: null as CommitStatusCheck | null,
    },
  ];
}

export async function pushGitState(ctx: DaemonContext): Promise<void> {
  let workspaces: { workingDir: string }[];
  try {
    workspaces = await ctx.deps.backend.query(api.workspaces.listWorkspacesForMachine, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to query workspaces for git sync: ${getErrorMessage(err)}`
    );
    return;
  }

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

  const branchResult = await gitReader.getBranch(workingDir);

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
    return;
  }

  const branch = branchResult.branch;
  const allFields = [branchField, ...GIT_STATE_FIELDS, ...makeBranchDependentFields(branch)];
  const pipeline = new GitStatePipeline(allFields);
  const preCollected = new Map<string, unknown>([['branch', branchResult]]);
  const values = await pipeline.collect(workingDir, preCollected);

  // Fetch recent commits separately (not part of the pipeline)
  const commits = await gitReader.getRecentCommits(workingDir, COMMITS_PER_PAGE);
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  // Two independent hashes: one for gitState, one for recentCommits
  const stateHash = pipeline.computeHash(values, false);
  const commitsKey = `${stateKey}:commits`;
  const commitsHash = JSON.stringify(commits.map((c) => c.sha));

  if (ctx.lastPushedGitState.get(stateKey) !== stateHash) {
    await ctx.deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      status: 'available',
      ...pipeline.toMutationArgs(values, false),
    });
    ctx.lastPushedGitState.set(stateKey, stateHash);
    console.log(
      `[${formatTimestamp()}] 🔀 Git state pushed: ${workingDir} (${branch}${values.get('isDirty') ? ', dirty' : ', clean'})`
    );
  }

  if (ctx.lastPushedGitState.get(commitsKey) !== commitsHash) {
    try {
      await ctx.deps.backend.mutation(api.workspaces.upsertRecentCommits, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        workingDir,
        commits,
        hasMoreCommits,
      });
      ctx.lastPushedGitState.set(commitsKey, commitsHash);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Recent commits push failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    }
  }

  prefetchMissingCommitDetails(ctx, workingDir, commits).catch((err: unknown) => {
    console.warn(
      `[${formatTimestamp()}] ⚠️  Commit pre-fetch failed for ${workingDir}: ${getErrorMessage(err)}`
    );
  });
}

export async function pushSingleWorkspaceGitSummaryForObserved(
  ctx: DaemonContext,
  workingDir: string,
  reason: 'safety-poll' | 'refresh' = 'safety-poll'
): Promise<void> {
  const stateKey = makeGitStateKey(ctx.machineId, workingDir);

  const isRepo = await gitReader.isGitRepo(workingDir);
  if (!isRepo) {
    const stateHash = 'not_found';
    if (reason !== 'refresh' && ctx.lastPushedGitState.get(stateKey) === stateHash) return;

    await ctx.deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      status: 'not_found',
    });
    ctx.lastPushedGitState.set(stateKey, stateHash);
    return;
  }

  const branchResult = await gitReader.getBranch(workingDir);

  if (branchResult.status === 'error') {
    const stateHash = `error:${branchResult.message}`;
    if (reason !== 'refresh' && ctx.lastPushedGitState.get(stateKey) === stateHash) return;

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
    return;
  }

  const branch = branchResult.branch;

  // Periodic full push: when enough time has elapsed since the last full push
  // for this workspace, route through the full pipeline to refresh non-slim
  // fields (diffStat, commitsAhead, remotes, allPullRequests, recent commits).
  // On daemon restart the map is empty, so the first observation triggers a
  // full push — that's intentional.
  const now = Date.now();
  const lastFull = lastFullPushMs.get(stateKey) ?? 0;
  if (now - lastFull >= OBSERVED_FULL_PUSH_INTERVAL_MS) {
    lastFullPushMs.set(stateKey, now);
    await pushSingleWorkspaceGitState(ctx, workingDir);
    console.log(
      `[${formatTimestamp()}] 👁️ Observed full git state pushed: ${workingDir} (${branch})${reason === 'refresh' ? ' [refresh]' : ''}`
    );
    return;
  }

  // Slim push: only branch, isDirty, and branch-dependent fields
  const slimFields = [
    branchField,
    ...GIT_STATE_FIELDS.filter((f) => f.includeInSlim),
    ...makeBranchDependentFields(branch),
  ];
  const pipeline = new GitStatePipeline(slimFields);
  const preCollected = new Map<string, unknown>([['branch', branchResult]]);
  const values = await pipeline.collect(workingDir, preCollected);

  const hash = pipeline.computeHash(values, true);
  if (reason !== 'refresh' && ctx.lastPushedGitState.get(stateKey) === hash) {
    return;
  }

  await ctx.deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    status: 'available',
    ...pipeline.toMutationArgs(values, true),
  });

  ctx.lastPushedGitState.set(stateKey, hash);
  console.log(
    `[${formatTimestamp()}] 👁️ Observed git summary pushed: ${workingDir} (${branch}${values.get('isDirty') ? ', dirty' : ', clean'})${reason === 'refresh' ? ' [refresh]' : ''}`
  );
}

async function prefetchMissingCommitDetails(
  ctx: DaemonContext,
  workingDir: string,
  commits: GitCommit[]
): Promise<void> {
  if (commits.length === 0) return;

  const shas = commits.map((c) => c.sha);

  const missingShas = await ctx.deps.backend.query(api.workspaces.getMissingCommitShasV2, {
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
        `[${formatTimestamp()}] ⚠️  Pre-fetch failed for ${sha.slice(0, 7)}: ${getErrorMessage(err)}`
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
    await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      sha,
      status: 'not_found',
      message: metadata?.message,
      body: metadata?.body,
      author: metadata?.author,
      date: metadata?.date,
    });
    return;
  }

  if (result.status === 'error') {
    await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      sha,
      status: 'error',
      errorMessage: result.message,
      message: metadata?.message,
      body: metadata?.body,
      author: metadata?.author,
      date: metadata?.date,
    });
    return;
  }

  const diffStat = extractDiffStatFromShowOutput(result.content);

  const { gzipSync } = await import('node:zlib');
  const compressed = gzipSync(Buffer.from(result.content));
  const diffContentCompressed = compressed.toString('base64');

  await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    sha,
    status: 'available',
    data: { compression: 'gzip' as const, content: diffContentCompressed },
    truncated: result.truncated,
    message: metadata?.message,
    body: metadata?.body,
    author: metadata?.author,
    date: metadata?.date,
    diffStat,
  });

  console.log(`[${formatTimestamp()}] ✅ Pre-fetched: ${sha.slice(0, 7)} in ${workingDir}`);
}
