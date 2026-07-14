/**
 * Git Request Subscription — reactive subscription for on-demand workspace git requests.
 *
 * Subscribes to `api.workspaces.getPendingRequests` via Convex WebSocket,
 * processing requests instantly when they appear (replacing the previous
 * 5-second setInterval polling loop).
 *
 * Processes pending requests from the backend:
 *   - `full_diff` → run `getFullDiff()`, push via `upsertFullDiff()`
 *   - `commit_detail` → run `getCommitDetail()` + `getCommitMetadata()`, push via `upsertCommitDetailV2()`
 *   - `more_commits` → run `getRecentCommits()` with skip offset, push via `appendMoreCommits()`
 *   - `all_pull_requests` → run `getAllPRs()`, push via `upsertAllPullRequests()`
 *   - `recent_commits` → run `getRecentCommits()` with offset 0, push via `upsertRecentCommits()`
 *
 * The heartbeat loop (every 30s) is responsible for pushing incremental
 * git state (branch, isDirty, diffStat, recentCommits) when state changes.
 * This subscription is only for on-demand requests that require low latency.
 */

import { gzipSync } from 'node:zlib';

import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Layer, Runtime } from 'effect';

import {
  DaemonMutableStateServiceLive,
  DaemonSessionService,
  type DaemonSessionServiceShape,
} from './daemon-services.js';
import { pushGitStateEffect, type GitStateDeps } from './git-heartbeat.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { isGitContentAvailable } from '../../../infrastructure/git/result-predicates.js';
import { runGh } from '../../../infrastructure/git/run-command.js';
import { COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Timeout for PR action execAsync calls (60s) — prevents indefinite hangs. */
const EXEC_TIMEOUT_MS = 60_000;

/** Handle returned by `startGitRequestSubscription` to stop the subscription. */
export interface GitSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

// ── Minimal dep type used by Core functions + Effect twins ────────────────────

/**
 * Flat deps required by processor functions (processFullDiff, etc.).
 * Includes lastPushedGitState (for pushGitStateEffect after PR actions) and
 * workspaceListStore (for getWorkspacesForMachine inside pushGitStateEffect).
 * DaemonSessionServiceShape structurally satisfies this type.
 */
export type GitSubscriptionDeps = GitStateDeps & {
  logger?: Pick<Console, 'log' | 'warn'>;
  runtime: Runtime.Runtime<DaemonSessionService>;
};

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Extract diff statistics from `git show` output.
 *
 * The `--stat` portion of `git show` includes a summary line like:
 * " 3 files changed, 45 insertions(+), 12 deletions(-)"
 * This appears before the diff hunks (which start with "diff --git").
 */
export function extractDiffStatFromShowOutput(content: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  for (const line of content.split('\n')) {
    if (/\d+\s+file.*changed/.test(line)) {
      return gitReader.parseDiffStatLine(line);
    }
  }
  return { filesChanged: 0, insertions: 0, deletions: 0 };
}

// ─── Request Processors ───────────────────────────────────────────────────────

/** Inferred type for a single pending request from the backend query. */
export type PendingRequest = FunctionReturnType<typeof api.workspaces.getPendingRequests>[number];

/**
 * Process a `full_diff` request:
 * Run `git diff HEAD`, parse stats, push via `upsertFullDiff`.
 */
async function processFullDiff(deps: GitSubscriptionDeps, req: PendingRequest): Promise<void> {
  const result = await gitReader.getFullDiff(req.workingDir);

  if (isGitContentAvailable(result)) {
    // Fetch diff stat separately (more reliable than parsing from diff content)
    const diffStatResult = await gitReader.getDiffStat(req.workingDir);
    const diffStat =
      diffStatResult.status === 'available'
        ? diffStatResult.diffStat
        : { filesChanged: 0, insertions: 0, deletions: 0 };

    // Compress diff content for efficient transport
    const compressed = gzipSync(Buffer.from(result.content));
    const diffContentCompressed = compressed.toString('base64');

    await deps.backend.mutation(api.workspaces.upsertFullDiffV2, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      workingDir: req.workingDir,
      data: { compression: 'gzip' as const, content: diffContentCompressed },
      truncated: result.truncated,
      diffStat,
    });

    console.log(
      `[${formatTimestamp()}] 📄 Full diff pushed: ${req.workingDir} (${diffStat.filesChanged} files, ${(Buffer.byteLength(result.content) / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB gzip, ${result.truncated ? 'truncated' : 'complete'})`
    );
  } else {
    // For not_found / no_commits / error — push empty diff
    const emptyCompressed = gzipSync(Buffer.from('')).toString('base64');
    await deps.backend.mutation(api.workspaces.upsertFullDiffV2, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      workingDir: req.workingDir,
      data: { compression: 'gzip' as const, content: emptyCompressed },
      truncated: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });

    console.log(
      `[${formatTimestamp()}] 📄 Full diff pushed (empty): ${req.workingDir} (${result.status})`
    );
  }
}

/**
 * Process a `pr_diff` request:
 * Run `git diff origin/<baseBranch>...HEAD`, get diff stat, push via `upsertPRDiff`.
 */
async function processPRDiff(deps: GitSubscriptionDeps, req: PendingRequest): Promise<void> {
  // prNumber is now REQUIRED for PR diff requests
  if (!req.prNumber) {
    throw new Error('PR diff request missing prNumber');
  }

  const baseBranch = req.baseBranch ?? 'main';
  const result = await gitReader.getPRDiffByNumber(req.workingDir, req.prNumber);

  if (isGitContentAvailable(result)) {
    await deps.backend.mutation(api.workspaces.upsertPRDiff, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      workingDir: req.workingDir,
      baseBranch,
      prNumber: req.prNumber,
      diffContent: result.content,
      truncated: result.truncated,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
    console.log(
      `[${formatTimestamp()}] 📄 PR diff pushed: ${req.workingDir} (#${req.prNumber}, ${result.truncated ? 'truncated' : 'complete'})`
    );
  } else {
    await deps.backend.mutation(api.workspaces.upsertPRDiff, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      workingDir: req.workingDir,
      baseBranch,
      prNumber: req.prNumber,
      diffContent: '',
      truncated: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
    console.log(
      `[${formatTimestamp()}] 📄 PR diff pushed (empty): ${req.workingDir} (#${req.prNumber}, ${result.status})`
    );
  }
}

/**
 * Process a `pr_action` request:
 * Execute the appropriate `gh` CLI command for merge/close.
 */
async function processPRAction(deps: GitSubscriptionDeps, req: PendingRequest): Promise<void> {
  const prNumber = req.prNumber;
  const action = req.prAction;
  if (!prNumber || !action) {
    throw new Error('pr_action request missing prNumber or prAction');
  }

  let ghArgs: string[];
  switch (action) {
    case 'merge_squash':
      ghArgs = ['pr', 'merge', String(prNumber), '--squash', '--delete-branch'];
      break;
    case 'merge_no_squash':
      ghArgs = ['pr', 'merge', String(prNumber), '--merge'];
      break;
    case 'close':
      ghArgs = ['pr', 'close', String(prNumber)];
      break;
    default:
      throw new Error(`Unknown PR action: ${action}`);
  }

  const result = await runGh(ghArgs, req.workingDir, { timeout: EXEC_TIMEOUT_MS });
  if ('error' in result) {
    throw result.error;
  }
  console.log(
    `[${formatTimestamp()}] ✅ PR action: ${action} on #${prNumber}${result.stdout ? ` — ${result.stdout.trim()}` : ''}`
  );

  // Refresh git state so the UI updates (PR list, branch, etc.)
  Runtime.runFork(deps.runtime)(
    pushGitStateEffect.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(DaemonSessionService, deps as unknown as DaemonSessionServiceShape),
          DaemonMutableStateServiceLive({
            lastPushedGitState: deps.lastPushedGitState,
            lastPushedModels: null,
            lastPushedHarnessFingerprint: null,
            workspaceListStore: deps.workspaceListStore,
          })
        )
      ),
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[${formatTimestamp()}] ⚠️  Failed to refresh git state after PR action: ${getErrorMessage(err)}`
          )
        )
      )
    )
  );
}

/**
 * Process a `pr_commits` request:
 * Run `gh pr view <number> --json commits`, push via `upsertPRCommits`.
 */
async function processPRCommits(deps: GitSubscriptionDeps, req: PendingRequest): Promise<void> {
  const prNumber = req.prNumber;
  if (!prNumber) {
    throw new Error('pr_commits request missing prNumber');
  }

  const commits = await gitReader.getPRCommits(req.workingDir, prNumber);
  await deps.backend.mutation(api.workspaces.upsertPRCommits, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    workingDir: req.workingDir,
    prNumber,
    commits,
  });

  console.log(
    `[${formatTimestamp()}] 📋 PR commits pushed: ${req.workingDir} (#${prNumber}, ${commits.length} commits)`
  );
}

/**
 * Process a `commit_detail` request:
 * Run `git show <sha>`, get commit metadata, push via `upsertCommitDetailV2`.
 */
async function processCommitDetail(deps: GitSubscriptionDeps, req: PendingRequest): Promise<void> {
  if (!req.sha) {
    throw new Error('commit_detail request missing sha');
  }

  const [result, metadata] = await Promise.all([
    gitReader.getCommitDetail(req.workingDir, req.sha),
    gitReader.getCommitMetadata(req.workingDir, req.sha),
  ]);

  await upsertCommitDetailResult(deps, req, result, metadata);

  if (isGitContentAvailable(result)) {
    const compressed = gzipSync(Buffer.from(result.content));
    console.log(
      `[${formatTimestamp()}] 🔍 Commit detail pushed: ${req.sha.slice(0, 7)} in ${req.workingDir} (${(Buffer.byteLength(result.content) / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB gzip)`
    );
  }
}

async function upsertCommitDetailResult(
  deps: GitSubscriptionDeps,
  req: PendingRequest,
  result: Awaited<ReturnType<typeof gitReader.getCommitDetail>>,
  metadata: Awaited<ReturnType<typeof gitReader.getCommitMetadata>>
): Promise<void> {
  const baseArgs = {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    workingDir: req.workingDir,
    sha: req.sha,
    message: metadata?.message,
    body: metadata?.body,
    author: metadata?.author,
    date: metadata?.date,
  };

  if (result.status === 'not_found') {
    await deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
      ...baseArgs,
      status: 'not_found',
    });
    return;
  }

  if (result.status === 'error') {
    await deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
      ...baseArgs,
      status: 'error',
      errorMessage: (result as { status: 'error'; message: string }).message,
    });
    return;
  }

  const diffStat = extractDiffStatFromShowOutput(result.content);
  const compressed = gzipSync(Buffer.from(result.content));
  const diffContentCompressed = compressed.toString('base64');

  await deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
    ...baseArgs,
    status: 'available',
    data: { compression: 'gzip' as const, content: diffContentCompressed },
    truncated: result.truncated,
    diffStat,
  });
}

/**
 * Process a `more_commits` request:
 * Run `git log` with skip offset, push via `appendMoreCommits`.
 */
async function processMoreCommits(deps: GitSubscriptionDeps, req: PendingRequest): Promise<void> {
  const offset = req.offset ?? 0;
  const commits = await gitReader.getRecentCommits(req.workingDir, COMMITS_PER_PAGE, offset);
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  await deps.backend.mutation(api.workspaces.appendMoreCommits, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    workingDir: req.workingDir,
    commits,
    hasMoreCommits,
  });

  console.log(
    `[${formatTimestamp()}] 📜 More commits appended: ${req.workingDir} (+${commits.length} commits, offset=${offset})`
  );
}

/**
 * Process an `all_pull_requests` request:
 * Run `gh pr list --state all`, push via `upsertAllPullRequests`.
 */
async function processAllPullRequests(
  deps: GitSubscriptionDeps,
  req: PendingRequest
): Promise<void> {
  const pullRequests = await gitReader.getAllPRs(req.workingDir);

  await deps.backend.mutation(api.workspaces.upsertAllPullRequests, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    workingDir: req.workingDir,
    pullRequests,
  });

  console.log(
    `[${formatTimestamp()}] 📋 All pull requests pushed: ${req.workingDir} (${pullRequests.length} PRs)`
  );
}

/**
 * Process a `recent_commits` request:
 * Run `git log` from offset 0, push via `upsertRecentCommits` (replaces existing).
 */
async function processRecentCommits(deps: GitSubscriptionDeps, req: PendingRequest): Promise<void> {
  const commits = await gitReader.getRecentCommits(req.workingDir, COMMITS_PER_PAGE, 0);
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  await deps.backend.mutation(api.workspaces.upsertRecentCommits, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    workingDir: req.workingDir,
    commits,
    hasMoreCommits,
  });

  console.log(
    `[${formatTimestamp()}] 📜 Recent commits pushed: ${req.workingDir} (${commits.length} commits)`
  );
}

function dispatchGitRequest(
  deps: GitSubscriptionDeps,
  req: PendingRequest
): Effect.Effect<void, never, never> {
  switch (req.requestType) {
    case 'full_diff':
      return Effect.promise(() => processFullDiff(deps, req));
    case 'commit_detail':
      return Effect.promise(() => processCommitDetail(deps, req));
    case 'more_commits':
      return Effect.promise(() => processMoreCommits(deps, req));
    case 'pr_diff':
      return Effect.promise(() => processPRDiff(deps, req));
    case 'pr_action':
      return Effect.promise(() => processPRAction(deps, req));
    case 'pr_commits':
      return Effect.promise(() => processPRCommits(deps, req));
    case 'all_pull_requests':
      return Effect.promise(() => processAllPullRequests(deps, req));
    case 'recent_commits':
      return Effect.promise(() => processRecentCommits(deps, req));
  }
}

/** Starts the git request subscription — yields DaemonSessionService. */
export const startGitRequestSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<GitSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const runtime = yield* Effect.runtime<DaemonSessionService>();

    // Session-scoped dedup — prevents re-processing the same request within a single daemon run.
    const processedRequestIds = new Map<string, number>();
    const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

    const sessionWithRuntime = { ...session, runtime } as unknown as DaemonSessionServiceShape;

    const processingState = { isProcessing: false };

    // Reset any orphaned 'processing' requests left behind by a previous daemon crash.
    session.backend
      .mutation(api.workspaces.resetProcessingRequests, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
      .then((resetCount: number) => {
        if (resetCount > 0) {
          console.log(
            `[${formatTimestamp()}] 🔀 Reset ${resetCount} orphaned processing request(s) to pending`
          );
        }
      })
      .catch((err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Failed to reset orphaned processing requests: ${getErrorMessage(err)}`
        );
      });

    const unsubscribe = wsClient.onUpdate(
      api.workspaces.getPendingRequests,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      (requests) => {
        if (!requests || requests.length === 0) return;

        const logger = sessionWithRuntime.logger ?? console;
        logger.log(
          `[${formatTimestamp()}] 📬 Git subscription: received ${requests.length} pending request(s)`
        );

        if (processingState.isProcessing) return;
        processingState.isProcessing = true;
        Runtime.runFork(runtime)(
          processRequestsEffect(requests, processedRequestIds, DEDUP_TTL_MS, runtime).pipe(
            Effect.provideService(DaemonSessionService, sessionWithRuntime),
            Effect.catchAll((err) =>
              Effect.sync(() =>
                console.warn(
                  `[${formatTimestamp()}] ⚠️  Git request processing failed: ${getErrorMessage(err)}`
                )
              )
            ),
            Effect.ensuring(
              Effect.sync(() => {
                processingState.isProcessing = false;
              })
            )
          )
        );
      },
      (err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Git request subscription error: ${getErrorMessage(err)}`
        );
      }
    );

    console.log(`[${formatTimestamp()}] 🔀 Git request subscription started (reactive)`);

    return {
      stop: () => {
        unsubscribe();
        console.log(`[${formatTimestamp()}] 🔀 Git request subscription stopped`);
      },
    };
  });

/** Processes pending git requests — yields DaemonSessionService. */
// fallow-ignore-next-line unused-export
export const processRequestsEffect = (
  requests: PendingRequest[],
  processedRequestIds: Map<string, number>,
  dedupTtlMs: number,
  runtime: Runtime.Runtime<DaemonSessionService>
): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    // Evict stale dedup entries
    const evictBefore = Date.now() - dedupTtlMs;
    for (const [id, ts] of processedRequestIds) {
      if (ts < evictBefore) processedRequestIds.delete(id);
    }

    // Process each request sequentially
    for (const req of requests) {
      const requestId = req._id.toString();

      // Skip already-processed requests (dedup within this daemon session)
      if (processedRequestIds.has(requestId)) continue;
      processedRequestIds.set(requestId, Date.now());

      try {
        // Mark as processing
        yield* Effect.promise(() =>
          session.backend.mutation(api.workspaces.updateRequestStatus, {
            sessionId: session.sessionId,
            requestId: req._id,
            status: 'processing',
          })
        );

        const logger = session.logger ?? console;
        logger.log(
          `[${formatTimestamp()}] ⚙️  Processing git request: type=${req.requestType}, id=${requestId}`
        );

        const sessionWithRuntime = { ...session, runtime } as unknown as GitSubscriptionDeps;

        yield* dispatchGitRequest(sessionWithRuntime, req);

        // Mark as done
        yield* Effect.promise(() =>
          session.backend.mutation(api.workspaces.updateRequestStatus, {
            sessionId: session.sessionId,
            requestId: req._id,
            status: 'done',
          })
        );
      } catch (err) {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Failed to process ${req.requestType} request: ${getErrorMessage(err)}`
        );
        // Best-effort: mark as error (don't abort the loop on mutation failure)
        yield* Effect.promise(() =>
          session.backend
            .mutation(api.workspaces.updateRequestStatus, {
              sessionId: session.sessionId,
              requestId: req._id,
              status: 'error',
            })
            .catch(() => {})
        );
      }
    }
  });
