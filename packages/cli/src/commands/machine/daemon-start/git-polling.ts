/**
 * Git Polling Loop — fast polling loop for on-demand workspace git requests.
 *
 * Runs every `GIT_POLLING_INTERVAL_MS` (5 seconds).
 * Processes pending requests from the backend:
 *   - `full_diff` → run `getFullDiff()`, push via `upsertFullDiff()`
 *   - `commit_detail` → run `getCommitDetail()` + `getCommitMetadata()`, push via `upsertCommitDetail()`
 *   - `more_commits` → run `getRecentCommits()` with skip offset, push via `appendMoreCommits()`
 *
 * The heartbeat loop (every 30s) is responsible for pushing incremental
 * git state (branch, isDirty, diffStat, recentCommits) when state changes.
 * This fast loop is only for on-demand requests that require low latency.
 */

import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';

/** How often the git polling loop checks for pending requests (ms). */
export const GIT_POLLING_INTERVAL_MS = 5_000; // 5 seconds

/** Handle returned by `startGitPollingLoop` to stop the loop. */
export interface GitPollingHandle {
  /** Stop the polling loop and clear the timer. */
  stop: () => void;
}

/**
 * Start the fast git polling loop.
 *
 * Called once during daemon startup, after the heartbeat loop is running.
 * Returns a handle with a `stop()` method for clean shutdown.
 *
 * @param ctx - Daemon context (session, machineId, deps)
 */
export function startGitPollingLoop(ctx: DaemonContext): GitPollingHandle {
  const timer = setInterval(() => {
    runPollingTick(ctx).catch((err: Error) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Git polling tick failed: ${err.message}`
      );
    });
  }, GIT_POLLING_INTERVAL_MS);

  // Don't prevent process exit during shutdown
  timer.unref();

  console.log(
    `[${formatTimestamp()}] 🔀 Git polling loop started (interval: ${GIT_POLLING_INTERVAL_MS}ms)`
  );

  return {
    stop: () => {
      clearInterval(timer);
      console.log(`[${formatTimestamp()}] 🔀 Git polling loop stopped`);
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

type PendingRequest = {
  _id: string;
  machineId: string;
  workingDir: string;
  requestType: 'full_diff' | 'commit_detail' | 'more_commits';
  sha?: string;
  offset?: number;
  status: string;
  requestedAt: number;
  updatedAt: number;
};

/**
 * Process a `full_diff` request:
 * Run `git diff HEAD`, parse stats, push via `upsertFullDiff`.
 */
async function processFullDiff(
  ctx: DaemonContext,
  req: PendingRequest
): Promise<void> {
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
 * Process a `commit_detail` request:
 * Run `git show <sha>`, get commit metadata, push via `upsertCommitDetail`.
 */
async function processCommitDetail(
  ctx: DaemonContext,
  req: PendingRequest
): Promise<void> {
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
async function processMoreCommits(
  ctx: DaemonContext,
  req: PendingRequest
): Promise<void> {
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

// ─── Polling Tick ─────────────────────────────────────────────────────────────

/**
 * A single tick of the polling loop.
 *
 * Queries the backend for pending workspace requests and processes each one,
 * transitioning status: `pending` → `processing` → `done` | `error`.
 */
async function runPollingTick(ctx: DaemonContext): Promise<void> {
  // Query backend for pending requests for this machine
  const requests = await ctx.deps.backend.query(api.workspaces.getPendingRequests, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
  });

  if (requests.length === 0) return;

  // Process each request sequentially
  for (const req of requests as PendingRequest[]) {
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
      }

      // Mark as done
      await ctx.deps.backend.mutation(api.workspaces.updateRequestStatus, {
        sessionId: ctx.sessionId,
        requestId: req._id,
        status: 'done',
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Failed to process ${req.requestType} request: ${(err as Error).message}`
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
