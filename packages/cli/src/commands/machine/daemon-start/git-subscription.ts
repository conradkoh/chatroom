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

import { exec } from 'child_process';
import { gzipSync } from 'node:zlib';
import { promisify } from 'util';

import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Ref } from 'effect';

import {
  DaemonMutableStateService,
  DaemonSessionService,
  type DaemonMutableStateServiceShape,
  type DaemonSessionServiceShape,
} from './daemon-services.js';
import { pushGitStateEffect, type GitStateDeps } from './git-heartbeat.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
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

  if (result.status === 'available' || result.status === 'truncated') {
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

  if (result.status === 'available' || result.status === 'truncated') {
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

  let cmd: string;
  switch (action) {
    case 'merge_squash':
      cmd = `gh pr merge ${prNumber} --squash --delete-branch`;
      break;
    case 'merge_no_squash':
      cmd = `gh pr merge ${prNumber} --merge`;
      break;
    case 'close':
      cmd = `gh pr close ${prNumber}`;
      break;
    default:
      throw new Error(`Unknown PR action: ${action}`);
  }

  const execAsync = promisify(exec);
  const result = await execAsync(cmd, {
    cwd: req.workingDir,
    timeout: EXEC_TIMEOUT_MS,
  });
  console.log(
    `[${formatTimestamp()}] ✅ PR action: ${action} on #${prNumber}${result.stdout ? ` — ${result.stdout.trim()}` : ''}`
  );

  // Refresh git state so the UI updates (PR list, branch, etc.)
  await Effect.runPromise(
    pushGitStateEffect.pipe(
      Effect.provideService(DaemonSessionService, deps as unknown as DaemonSessionServiceShape),
      Effect.provideService(DaemonMutableStateService, {
        lastPushedGitState: Ref.unsafeMake(deps.lastPushedGitState),
        lastPushedModels: Ref.unsafeMake(null),
        lastPushedHarnessFingerprint: Ref.unsafeMake(null),
        workspaceListStore: Ref.unsafeMake(undefined),
      } as unknown as DaemonMutableStateServiceShape)
    )
  ).catch((err: unknown) => {
    console.warn(
      `[${formatTimestamp()}] ⚠️  Failed to refresh git state after PR action: ${getErrorMessage(err)}`
    );
  });
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

  if (result.status === 'not_found') {
    await deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      workingDir: req.workingDir,
      sha: req.sha,
      status: 'not_found',
      message: metadata?.message,
      body: metadata?.body,
      author: metadata?.author,
      date: metadata?.date,
    });
    return;
  }

  if (result.status === 'error') {
    await deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      workingDir: req.workingDir,
      sha: req.sha,
      status: 'error',
      errorMessage: (result as { status: 'error'; message: string }).message,
      message: metadata?.message,
      body: metadata?.body,
      author: metadata?.author,
      date: metadata?.date,
    });
    return;
  }

  // result.status is 'available' or 'truncated'
  const diffStat = extractDiffStatFromShowOutput(result.content);

  // Compress diff content for efficient transport
  const compressed = gzipSync(Buffer.from(result.content));
  const diffContentCompressed = compressed.toString('base64');

  await deps.backend.mutation(api.workspaces.upsertCommitDetailV2, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    workingDir: req.workingDir,
    sha: req.sha,
    status: 'available',
    data: { compression: 'gzip' as const, content: diffContentCompressed },
    truncated: result.truncated,
    message: metadata?.message,
    body: metadata?.body,
    author: metadata?.author,
    date: metadata?.date,
    diffStat,
  });

  console.log(
    `[${formatTimestamp()}] 🔍 Commit detail pushed: ${req.sha.slice(0, 7)} in ${req.workingDir} (${(Buffer.byteLength(result.content) / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB gzip)`
  );
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

/** Starts the git request subscription — yields DaemonSessionService. */
export const startGitRequestSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<GitSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    // Session-scoped dedup — prevents re-processing the same request within a single daemon run.
    const processedRequestIds = new Map<string, number>();
    const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

    let processing = false;

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

        const logger = session.logger ?? console;
        logger.log(
          `[${formatTimestamp()}] 📬 Git subscription: received ${requests.length} pending request(s)`
        );

        if (processing) return;

        processing = true;
        Effect.runPromise(
          processRequestsEffect(requests, processedRequestIds, DEDUP_TTL_MS).pipe(
            Effect.provideService(DaemonSessionService, session)
          )
        )
          .catch((err: unknown) => {
            console.warn(
              `[${formatTimestamp()}] ⚠️  Git request processing failed: ${getErrorMessage(err)}`
            );
          })
          .finally(() => {
            processing = false;
          });
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
  dedupTtlMs: number
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

        switch (req.requestType) {
          case 'full_diff':
            yield* Effect.promise(() => processFullDiff(session, req));
            break;
          case 'commit_detail':
            yield* Effect.promise(() => processCommitDetail(session, req));
            break;
          case 'more_commits':
            yield* Effect.promise(() => processMoreCommits(session, req));
            break;
          case 'pr_diff':
            yield* Effect.promise(() => processPRDiff(session, req));
            break;
          case 'pr_action':
            yield* Effect.promise(() => processPRAction(session, req));
            break;
          case 'pr_commits':
            yield* Effect.promise(() => processPRCommits(session, req));
            break;
          case 'all_pull_requests':
            yield* Effect.promise(() => processAllPullRequests(session, req));
            break;
          case 'recent_commits':
            yield* Effect.promise(() => processRecentCommits(session, req));
            break;
        }

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
