import { OBSERVED_FULL_PUSH_INTERVAL_MS } from '@workspace/backend/config/reliability.js';
import { Effect, Ref } from 'effect';

import {
  DaemonMutableStateService,
  DaemonSessionService,
  type DaemonSessionServiceShape,
} from './daemon-services.js';
import type { SessionId, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { getWorkspacesForMachine } from './workspace-cache.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import type { GitRemoteEntry, CommitStatusCheck } from '../../../infrastructure/git/git-reader.js';
import type { GitStateFieldDef } from '../../../infrastructure/git/git-state-pipeline.js';
import { GitStatePipeline } from '../../../infrastructure/git/git-state-pipeline.js';
import {
  isGitBranchAvailable,
  isGitBranchError,
  isGitBranchNotFound,
} from '../../../infrastructure/git/result-predicates.js';
import { makeGitStateKey, COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import type {
  GitBranchResult,
  GitDiffStatResult,
  GitPullRequest,
} from '../../../infrastructure/git/types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Tracks the last time a full (non-slim) git state push was performed per workspace.
 *  Key: makeGitStateKey(machineId, workingDir). Value: Date.now() of last full push. */
const lastFullPushMs = new Map<string, number>();

/** Last branch name included in a successful push per workspace. Used to detect branch changes that require a full push (diffStat). */
const lastPushedBranch = new Map<string, string>();

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
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
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
    lastPushedBranch.set(stateKey, branch);
    lastFullPushMs.set(stateKey, Date.now());
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

function pushObservedNotRepoEffect(
  session: DaemonSessionServiceShape,
  lastPushedGitState: Map<string, string>,
  stateKey: string,
  workingDir: string,
  reason: 'safety-poll' | 'refresh'
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stateHash = 'not_found';
    if (reason !== 'refresh' && lastPushedGitState.get(stateKey) === stateHash) {
      return;
    }
    yield* Effect.promise(() =>
      session.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        workingDir,
        status: 'not_found',
      })
    );
    lastPushedGitState.set(stateKey, stateHash);
  });
}

function pushObservedBranchErrorEffect(
  session: DaemonSessionServiceShape,
  lastPushedGitState: Map<string, string>,
  stateKey: string,
  workingDir: string,
  reason: 'safety-poll' | 'refresh',
  message: string
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stateHash = `error:${message}`;
    if (reason !== 'refresh' && lastPushedGitState.get(stateKey) === stateHash) {
      return;
    }
    yield* Effect.promise(() =>
      session.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        workingDir,
        status: 'error',
        errorMessage: message,
      })
    );
    lastPushedGitState.set(stateKey, stateHash);
  });
}

function pushObservedFullGitStateEffect(
  session: DaemonSessionServiceShape,
  lastPushedGitState: Map<string, string>,
  stateKey: string,
  workingDir: string,
  branch: string,
  reason: 'safety-poll' | 'refresh'
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.promise(() =>
      pushSingleWorkspaceGitStateImpl(buildGitStateDeps(session, lastPushedGitState), workingDir)
    );
    lastPushedBranch.set(stateKey, branch);
    lastFullPushMs.set(stateKey, Date.now());
    console.log(
      `[${formatTimestamp()}] 👁️ Observed full git state pushed: ${workingDir} (${branch})${reason === 'refresh' ? ' [refresh]' : ''}`
    );
  });
}

function pushObservedSlimGitSummaryEffect(
  session: DaemonSessionServiceShape,
  lastPushedGitState: Map<string, string>,
  stateKey: string,
  workingDir: string,
  branch: string,
  branchResult: GitBranchResult,
  reason: 'safety-poll' | 'refresh'
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const slimFields = [
      branchField,
      ...GIT_STATE_FIELDS.filter((f) => f.includeInSlim),
      ...makeBranchDependentFields(branch),
    ];
    const pipeline = new GitStatePipeline(slimFields);
    const preCollected = new Map<string, unknown>([['branch', branchResult]]);
    const values = yield* Effect.promise(() => pipeline.collect(workingDir, preCollected));

    const hash = pipeline.computeHash(values, true);
    if (reason !== 'refresh' && lastPushedGitState.get(stateKey) === hash) {
      return;
    }

    yield* Effect.promise(() =>
      session.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        workingDir,
        status: 'available',
        ...pipeline.toMutationArgs(values, true),
      })
    );

    lastPushedGitState.set(stateKey, hash);
    console.log(
      `[${formatTimestamp()}] 👁️ Observed git summary pushed: ${workingDir} (${branch}${values.get('isDirty') ? ', dirty' : ', clean'})${reason === 'refresh' ? ' [refresh]' : ''}`
    );
  });
}

/** Effect twin for pushSingleWorkspaceGitSummaryForObserved — yields GitHeartbeatRequirements. */
export const pushSingleWorkspaceGitSummaryForObservedEffect = (
  workingDir: string,
  reason: 'safety-poll' | 'refresh' = 'safety-poll'
): Effect.Effect<void, never, GitHeartbeatRequirements> =>
  Effect.gen(function* pushObservedGitSummaryForObserved() {
    const session = yield* DaemonSessionService;
    const mutable = yield* DaemonMutableStateService;
    const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);

    const stateKey = makeGitStateKey(session.machineId, workingDir);

    const isRepo = yield* Effect.promise(() => gitReader.isGitRepo(workingDir));
    if (!isRepo) {
      yield* pushObservedNotRepoEffect(session, lastPushedGitState, stateKey, workingDir, reason);
      return;
    }

    const branchResult = yield* Effect.promise(() => gitReader.getBranch(workingDir));
    if (isGitBranchError(branchResult)) {
      yield* pushObservedBranchErrorEffect(
        session,
        lastPushedGitState,
        stateKey,
        workingDir,
        reason,
        branchResult.message
      );
      return;
    }

    if (isGitBranchNotFound(branchResult)) {
      return;
    }

    const branch = branchResult.branch;
    const now = Date.now();
    const lastFull = lastFullPushMs.get(stateKey) ?? 0;
    const previousBranch = lastPushedBranch.get(stateKey);
    const branchChanged = previousBranch !== undefined && previousBranch !== branch;
    const needsFullPush =
      reason === 'refresh' || branchChanged || now - lastFull >= OBSERVED_FULL_PUSH_INTERVAL_MS;

    if (needsFullPush) {
      yield* pushObservedFullGitStateEffect(
        session,
        lastPushedGitState,
        stateKey,
        workingDir,
        branch,
        reason
      );
      return;
    }

    yield* pushObservedSlimGitSummaryEffect(
      session,
      lastPushedGitState,
      stateKey,
      workingDir,
      branch,
      branchResult,
      reason
    );
  });

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

/** @internal — test only */
export function _resetGitHeartbeatBranchTrackingForTests(): void {
  lastPushedBranch.clear();
  lastFullPushMs.clear();
}
