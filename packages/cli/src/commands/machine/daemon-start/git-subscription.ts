/**
 * Git Request Subscription — reactive subscription for on-demand workspace git requests.
 *
 * Subscribes to `api.workspaces.getPendingRequests` via Convex WebSocket,
 * processing requests instantly when they appear (replacing the previous
 * 5-second setInterval polling loop).
 *
 * Processes pending requests from the backend:
 *   - `full_diff` → run `getFullDiff()`, push via `upsertFullDiff()`
 *   - `commit_detail` → run `getCommitDetail()` + `getCommitMetadata()`, push via `upsertCommitDetail()`
 *   - `more_commits` → run `getRecentCommits()` with skip offset, push via `appendMoreCommits()`
 *
 * The heartbeat loop (every 30s) is responsible for pushing incremental
 * git state (branch, isDirty, diffStat, recentCommits) when state changes.
 * This subscription is only for on-demand requests that require low latency.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { pushGitState } from './git-heartbeat.js';

/** Handle returned by `startGitRequestSubscription` to stop the subscription. */
export interface GitSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

/**
 * Start the reactive git request subscription.
 *
 * Subscribes to `api.workspaces.getPendingRequests` via the Convex WebSocket
 * client. When new pending requests appear, they are processed immediately.
 *
 * Called once during daemon startup, after the heartbeat loop is running.
 * Returns a handle with a `stop()` method for clean shutdown.
 *
 * @param ctx - Daemon context (session, machineId, deps)
 * @param wsClient - Convex WebSocket client for reactive subscriptions
 */
export function startGitRequestSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient
): GitSubscriptionHandle {
  // Session-scoped dedup — prevents re-processing the same request within a single daemon run.
  // Map<requestId, processedAt timestamp>. Entries are evicted when older than 5 minutes.
  const processedRequestIds = new Map<string, number>();
  const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Track whether we're currently processing to avoid overlapping batches
  let processing = false;

  const unsubscribe = wsClient.onUpdate(
    api.workspaces.getPendingRequests,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    (requests) => {
      if (!requests || requests.length === 0) return;
      if (processing) return; // Skip if still processing previous batch

      processing = true;
      processRequests(ctx, requests, processedRequestIds, DEDUP_TTL_MS)
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

  console.log(
    `[${formatTimestamp()}] 🔀 Git request subscription started (reactive)`
  );

  return {
    stop: () => {
      unsubscribe();
      console.log(`[${formatTimestamp()}] 🔀 Git request subscription stopped`);
    },
  };
}

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
async function processFullDiff(ctx: DaemonContext, req: PendingRequest): Promise<void> {
  const result = await gitReader.getFullDiff(req.workingDir);

  if (result.status === 'available' || result.status === 'truncated') {
    // Fetch diff stat separately (more reliable than parsing from diff content)
    const diffStatResult = await gitReader.getDiffStat(req.workingDir);
    const diffStat =
      diffStatResult.status === 'available'
        ? diffStatResult.diffStat
        : { filesChanged: 0, insertions: 0, deletions: 0 };

    await ctx.deps.backend.mutation(api.workspaces.upsertFullDiff, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir: req.workingDir,
      diffContent: result.content,
      truncated: result.truncated,
      diffStat,
    });

    console.log(
      `[${formatTimestamp()}] 📄 Full diff pushed: ${req.workingDir} (${diffStat.filesChanged} files, ${result.truncated ? 'truncated' : 'complete'})`
    );
  } else {
    // For not_found / no_commits / error — push empty diff
    await ctx.deps.backend.mutation(api.workspaces.upsertFullDiff, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir: req.workingDir,
      diffContent: '',
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
async function processPRDiff(ctx: DaemonContext, req: PendingRequest): Promise<void> {
  const baseBranch = req.baseBranch ?? 'main';

  // If a PR number is specified, use `gh pr diff <number>` for the exact PR diff
  if (req.prNumber) {
    const result = await gitReader.getPRDiffByNumber(req.workingDir, req.prNumber);

    if (result.status === 'available' || result.status === 'truncated') {
      await ctx.deps.backend.mutation(api.workspaces.upsertPRDiff, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        workingDir: req.workingDir,
        baseBranch,
        diffContent: result.content,
        truncated: result.truncated,
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      });
      console.log(
        `[${formatTimestamp()}] 📄 PR diff pushed: ${req.workingDir} (#${req.prNumber}, ${result.truncated ? 'truncated' : 'complete'})`
      );
    } else {
      await ctx.deps.backend.mutation(api.workspaces.upsertPRDiff, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        workingDir: req.workingDir,
        baseBranch,
        diffContent: '',
        truncated: false,
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      });
      console.log(
        `[${formatTimestamp()}] 📄 PR diff pushed (empty): ${req.workingDir} (#${req.prNumber}, ${result.status})`
      );
    }
    return;
  }

  // Fallback: use branch comparison (origin/<baseBranch>...HEAD)
  const result = await gitReader.getPRDiff(req.workingDir, baseBranch);

  if (result.status === 'available' || result.status === 'truncated') {
    const diffStatResult = await gitReader.getPRDiffStat(req.workingDir, baseBranch);
    const diffStat =
      diffStatResult.status === 'available'
        ? diffStatResult.diffStat
        : { filesChanged: 0, insertions: 0, deletions: 0 };

    await ctx.deps.backend.mutation(api.workspaces.upsertPRDiff, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir: req.workingDir,
      baseBranch,
      diffContent: result.content,
      truncated: result.truncated,
      diffStat,
    });

    console.log(
      `[${formatTimestamp()}] 📄 PR diff pushed: ${req.workingDir} (${baseBranch}...HEAD, ${diffStat.filesChanged} files, ${result.truncated ? 'truncated' : 'complete'})`
    );
  } else {
    await ctx.deps.backend.mutation(api.workspaces.upsertPRDiff, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir: req.workingDir,
      baseBranch,
      diffContent: '',
      truncated: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });

    console.log(
      `[${formatTimestamp()}] 📄 PR diff pushed (empty): ${req.workingDir} (${result.status})`
    );
  }
}

/**
 * Process a `pr_action` request:
 * Execute the appropriate `gh` CLI command for merge/close.
 */
async function processPRAction(ctx: DaemonContext, req: PendingRequest): Promise<void> {
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

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const result = await execAsync(cmd, { cwd: req.workingDir });
  console.log(
    `[${formatTimestamp()}] ✅ PR action: ${action} on #${prNumber}${result.stdout ? ` — ${result.stdout.trim()}` : ''}`
  );

  // Refresh git state so the UI updates (PR list, branch, etc.)
  await pushGitState(ctx).catch((err: unknown) => {
    console.warn(`[${formatTimestamp()}] ⚠️  Failed to refresh git state after PR action: ${getErrorMessage(err)}`);
  });
}

/**
 * Process a `commit_detail` request:
 * Run `git show <sha>`, get commit metadata, push via `upsertCommitDetail`.
 */
async function processCommitDetail(ctx: DaemonContext, req: PendingRequest): Promise<void> {
  if (!req.sha) {
    throw new Error('commit_detail request missing sha');
  }

  const [result, metadata] = await Promise.all([
    gitReader.getCommitDetail(req.workingDir, req.sha),
    gitReader.getCommitMetadata(req.workingDir, req.sha),
  ]);

  if (result.status === 'not_found') {
    await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetail, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir: req.workingDir,
      sha: req.sha,
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
      workingDir: req.workingDir,
      sha: req.sha,
      status: 'error',
      errorMessage: (result as { status: 'error'; message: string }).message,
      message: metadata?.message,
      author: metadata?.author,
      date: metadata?.date,
    });
    return;
  }

  // result.status is 'available' or 'truncated'
  const diffStat = extractDiffStatFromShowOutput(result.content);

  await ctx.deps.backend.mutation(api.workspaces.upsertCommitDetail, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir: req.workingDir,
    sha: req.sha,
    status: 'available',
    diffContent: result.content,
    truncated: result.truncated,
    message: metadata?.message,
    author: metadata?.author,
    date: metadata?.date,
    diffStat,
  });

  console.log(
    `[${formatTimestamp()}] 🔍 Commit detail pushed: ${req.sha.slice(0, 7)} in ${req.workingDir}`
  );
}

/**
 * Process a `more_commits` request:
 * Run `git log` with skip offset, push via `appendMoreCommits`.
 */
async function processMoreCommits(ctx: DaemonContext, req: PendingRequest): Promise<void> {
  const offset = req.offset ?? 0;
  const commits = await gitReader.getRecentCommits(req.workingDir, COMMITS_PER_PAGE, offset);
  const hasMoreCommits = commits.length >= COMMITS_PER_PAGE;

  await ctx.deps.backend.mutation(api.workspaces.appendMoreCommits, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir: req.workingDir,
    commits,
    hasMoreCommits,
  });

  console.log(
    `[${formatTimestamp()}] 📜 More commits appended: ${req.workingDir} (+${commits.length} commits, offset=${offset})`
  );
}

// ─── Request Processing ───────────────────────────────────────────────────────

/**
 * Process a batch of pending requests from a subscription update.
 *
 * Handles deduplication and transitions each request through
 * `pending` → `processing` → `done` | `error`.
 */
export async function processRequests(
  ctx: DaemonContext,
  requests: PendingRequest[],
  processedRequestIds: Map<string, number>,
  dedupTtlMs: number
): Promise<void> {
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
      await ctx.deps.backend.mutation(api.workspaces.updateRequestStatus, {
        sessionId: ctx.sessionId,
        requestId: req._id,
        status: 'processing',
      });

      switch (req.requestType) {
        case 'full_diff':
          await processFullDiff(ctx, req);
          break;
        case 'commit_detail':
          await processCommitDetail(ctx, req);
          break;
        case 'more_commits':
          await processMoreCommits(ctx, req);
          break;
        case 'pr_diff':
          await processPRDiff(ctx, req);
          break;
        case 'pr_action':
          await processPRAction(ctx, req);
          break;
      }

      // Mark as done
      await ctx.deps.backend.mutation(api.workspaces.updateRequestStatus, {
        sessionId: ctx.sessionId,
        requestId: req._id,
        status: 'done',
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Failed to process ${req.requestType} request: ${getErrorMessage(err)}`
      );
      // Best-effort: mark as error (don't abort the loop on mutation failure)
      await ctx.deps.backend
        .mutation(api.workspaces.updateRequestStatus, {
          sessionId: ctx.sessionId,
          requestId: req._id,
          status: 'error',
        })
        .catch(() => {});
    }
  }
}
