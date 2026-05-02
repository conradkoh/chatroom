import { extractDiffStatFromShowOutput } from './git-subscription.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import type { GitRemoteEntry, CommitStatusCheck } from '../../../infrastructure/git/git-reader.js';
import type { GitStateFieldDef } from '../../../infrastructure/git/git-state-pipeline.js';
import { GitStatePipeline } from '../../../infrastructure/git/git-state-pipeline.js';
import { makeGitStateKey, COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
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
    key: 'commits',
    includeInSlim: false,
    collect: (wd) => gitReader.getRecentCommits(wd, COMMITS_PER_PAGE),
    toHashable: (raw) => (raw as GitCommit[]).map((c) => c.sha),
    toMutationPartial: () => ({}),
    defaultValue: [] as GitCommit[],
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

  const commits = values.get('commits') as GitCommit[];
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  const hash = pipeline.computeHash(values, false);
  if (ctx.lastPushedGitState.get(stateKey) === hash) {
    return;
  }

  await ctx.deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    status: 'available',
    ...pipeline.toMutationArgs(values, false),
    recentCommits: commits,
    hasMoreCommits,
  });

  ctx.lastPushedGitState.set(stateKey, hash);
  console.log(
    `[${formatTimestamp()}] 🔀 Git state pushed: ${workingDir} (${branch}${values.get('isDirty') ? ', dirty' : ', clean'})`
  );

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
    author: metadata?.author,
    date: metadata?.date,
    diffStat,
  });

  console.log(`[${formatTimestamp()}] ✅ Pre-fetched: ${sha.slice(0, 7)} in ${workingDir}`);
}
