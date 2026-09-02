import { Effect, Ref, type Context } from 'effect';

import { api } from '../../../api.js';
import {
  DaemonMutableStateService,
  DaemonSessionService,
  type DaemonSessionServiceShape,
} from '../daemon-services.js';
import type { SessionId, WorkspaceForSync } from '../daemon-types.js';
import { formatTimestamp } from '../daemon-utils.js';
import { getWorkspacesForMachine } from './workspace-cache.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import * as gitReader from '../../infrastructure/git/git-reader.js';
import type { GitRemoteEntry, CommitStatusCheck } from '../../infrastructure/git/git-reader.js';
import type { GitStateFieldDef } from '../../infrastructure/git/git-state-pipeline.js';
import { GitStatePipeline } from '../../infrastructure/git/git-state-pipeline.js';
import {
  isGitBranchAvailable,
  isGitBranchError,
  isGitBranchNotFound,
} from '../../infrastructure/git/result-predicates.js';
import { makeGitStateKey, COMMITS_PER_PAGE } from '../../infrastructure/git/types.js';
import type {
  GitBranchResult,
  GitDiffStatResult,
  GitPullRequest,
} from '../../infrastructure/git/types.js';

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
    return isGitBranchAvailable(r) ? r.branch : 'unknown';
  },
  toMutationPartial: (raw) => {
    const r = raw as GitBranchResult;
    return isGitBranchAvailable(r) ? { branch: r.branch } : {};
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
    key: 'commitsBehind',
    includeInSlim: false,
    collect: (wd) => gitReader.getCommitsBehind(wd),
    toHashable: (raw) => raw,
    toMutationPartial: (raw) => ({ commitsBehind: raw as number }),
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

// ── Minimal dep type used by Effect twins ────────────────────

type GitHeartbeatRequirements = DaemonSessionService | DaemonMutableStateService;

function buildGitStateDeps(
  session: DaemonSessionServiceShape,
  lastPushedGitState: Map<string, string>
): GitStateDeps {
  return {
    machineId: session.machineId,
    sessionId: session.sessionId,
    backend: session.backend,
    lastPushedGitState,
    workspaceListStore: session.workspaceListStore,
  };
}

export type GitStateDeps = {
  machineId: string;
  sessionId: SessionId;
  backend: BackendOps;
  lastPushedGitState: Map<string, string>;
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number } | undefined;
};

// ── Core implementations (flat deps, no ctx.deps.xxx) ─────────────────────────

/**
 * Per-workspace git state push — shared by both the Effect twin and Core callers.
 * Takes flat GitStateDeps so the Effect twin can pass session (DaemonSessionServiceShape
 * satisfies GitStateDeps structurally) and Core callers can pass ctx directly.
 */
async function pushSingleWorkspaceGitStateImpl(
  ctx: GitStateDeps,
  workingDir: string
): Promise<void> {
  const stateKey = makeGitStateKey(ctx.machineId, workingDir);

  const isRepo = await gitReader.isGitRepo(workingDir);
  if (!isRepo) {
    await pushNotFoundGitState(ctx, workingDir, stateKey);
    return;
  }

  const branchResult = await gitReader.getBranch(workingDir);

  if (isGitBranchError(branchResult)) {
    await pushErrorGitState(ctx, workingDir, stateKey, branchResult.message);
    return;
  }

  if (isGitBranchNotFound(branchResult)) {
    return;
  }

  await pushAvailableGitState(ctx, workingDir, stateKey, branchResult);
}

async function pushNotFoundGitState(
  ctx: GitStateDeps,
  workingDir: string,
  stateKey: string
): Promise<void> {
  const stateHash = 'not_found';
  if (ctx.lastPushedGitState.get(stateKey) === stateHash) return;

  await ctx.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    status: 'not_found',
  });
  ctx.lastPushedGitState.set(stateKey, stateHash);
}

async function pushErrorGitState(
  ctx: GitStateDeps,
  workingDir: string,
  stateKey: string,
  message: string
): Promise<void> {
  const stateHash = `error:${message}`;
  if (ctx.lastPushedGitState.get(stateKey) === stateHash) return;

  await ctx.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    status: 'error',
    errorMessage: message,
  });
  ctx.lastPushedGitState.set(stateKey, stateHash);
}

async function pushAvailableGitState(
  ctx: GitStateDeps,
  workingDir: string,
  stateKey: string,
  branchResult: { branch: string }
): Promise<void> {
  const branch = branchResult.branch;
  const allFields = [branchField, ...GIT_STATE_FIELDS, ...makeBranchDependentFields(branch)];
  const pipeline = new GitStatePipeline(allFields);
  const preCollected = new Map<string, unknown>([['branch', branchResult]]);
  const values = await pipeline.collect(workingDir, preCollected);

  const commits = await gitReader.getRecentCommits(workingDir, COMMITS_PER_PAGE);
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  const stateHash = pipeline.computeHash(values, false);
  const commitsKey = `${stateKey}:commits`;
  const commitsHash = JSON.stringify(commits.map((c) => c.sha));

  if (ctx.lastPushedGitState.get(stateKey) !== stateHash) {
    await ctx.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
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
      await ctx.backend.mutation(api.workspaces.upsertRecentCommits, {
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
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for pushGitState — yields GitHeartbeatRequirements. */
export const pushGitStateEffect: Effect.Effect<void, never, GitHeartbeatRequirements> = Effect.gen(
  function* () {
    const session = yield* DaemonSessionService;
    const mutable = yield* DaemonMutableStateService;
    const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);

    const workspaces = yield* Effect.promise(() =>
      getWorkspacesForMachine({
        workspaceListStore: session.workspaceListStore,
        sessionId: session.sessionId,
        machineId: session.machineId,
        backend: session.backend,
      })
    );
    if (workspaces.length === 0) return;

    const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));
    if (uniqueWorkingDirs.size === 0) return;

    for (const workingDir of uniqueWorkingDirs) {
      try {
        yield* Effect.promise(() =>
          pushSingleWorkspaceGitStateImpl(
            buildGitStateDeps(session, lastPushedGitState),
            workingDir
          )
        );
      } catch (err) {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Git state push failed for ${workingDir}: ${getErrorMessage(err)}`
        );
      }
    }
  }
);

export async function drainGitStateSync(
  effectContext: Context.Context<DaemonSessionService | DaemonMutableStateService>
): Promise<void> {
  await Effect.runPromise(pushGitStateEffect.pipe(Effect.provide(effectContext)));
}

/** Effect twin for pushSingleWorkspaceGitState — yields GitHeartbeatRequirements. */
export const pushSingleWorkspaceGitStateEffect = (
  workingDir: string
): Effect.Effect<void, never, GitHeartbeatRequirements> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const mutable = yield* DaemonMutableStateService;
    const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);
    yield* Effect.promise(() =>
      pushSingleWorkspaceGitStateImpl(buildGitStateDeps(session, lastPushedGitState), workingDir)
    );
  });
