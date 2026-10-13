/**
 * Background job for a `daemon.gitClone` command.
 *
 * Owns progress throttling, keepalive, and result reporting. Command dispatch starts this job
 * without awaiting it, so a long clone never blocks the machine command chain.
 */

import type { GitCloneErrorCode } from '@workspace/shared/domain/git-clone';

import { formatTimestamp } from './daemon-utils.js';
import {
  runGitClone,
  type GitCloneOutcome,
  type GitCloneProgress,
} from '../../infrastructure/local-actions/git-clone.js';
import { getErrorMessage } from '../../utils/convex-error.js';

export type GitCloneResultReport =
  | { status: 'completed'; clonedPath: string }
  | { status: 'failed'; errorCode: GitCloneErrorCode; errorMessage: string };

export interface GitCloneJobDeps {
  /** Backed by api.gitCloneRequests.reportProgress. */
  reportProgress: (progress: GitCloneProgress) => Promise<unknown>;
  /** Backed by api.gitCloneRequests.reportResult. */
  reportResult: (result: GitCloneResultReport) => Promise<unknown>;
  runClone?: typeof runGitClone | undefined;
  now?: (() => number) | undefined;
  setIntervalFn?: typeof setInterval | undefined;
}

/** Progress without a phase change is sent at most this often. */
const GIT_CLONE_PROGRESS_MIN_INTERVAL_MS = 1500;
/** The last progress is re-sent this often so the backend row's updatedAt keeps moving. */
const GIT_CLONE_KEEPALIVE_MS = 30_000;
/** Wait before each result-report retry. One initial attempt plus one retry per entry. */
const RESULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function warn(message: string): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${message}`);
}

/** Runs a report without letting a rejection or synchronous throw escape. Progress is best effort. */
function reportQuietly(label: string, report: () => Promise<unknown>): void {
  report().catch((error: unknown) => {
    warn(`Git clone ${label} report failed: ${getErrorMessage(error)}`);
  });
}

async function reportResultWithRetry(
  deps: Pick<GitCloneJobDeps, 'reportResult'>,
  result: GitCloneResultReport
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.reportResult(result);
      return;
    } catch (error) {
      const delayMs = RESULT_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        warn(`Git clone result report failed after retries: ${getErrorMessage(error)}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function toResultReport(outcome: GitCloneOutcome): GitCloneResultReport {
  return outcome.ok
    ? { status: 'completed', clonedPath: outcome.clonedPath }
    : { status: 'failed', errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
}

/**
 * Decides whether a progress update is sent. Phase changes and 100% always pass.
 * Otherwise the update must be at least GIT_CLONE_PROGRESS_MIN_INTERVAL_MS after the last send.
 */
function shouldForwardProgress(
  last: GitCloneProgress | undefined,
  next: GitCloneProgress,
  elapsedMs: number
): boolean {
  return (
    last?.phase !== next.phase ||
    next.percent === 100 ||
    elapsedMs >= GIT_CLONE_PROGRESS_MIN_INTERVAL_MS
  );
}

/** Sends progress through the deps, remembering the last send for throttling and keepalive. */
function createProgressReporter(
  reportProgress: GitCloneJobDeps['reportProgress'],
  now: () => number
) {
  let lastSent: GitCloneProgress | undefined;
  let lastSentAt = 0;
  const send = (progress: GitCloneProgress) => {
    lastSent = progress;
    lastSentAt = now();
    reportQuietly('progress', async () => reportProgress(progress));
  };
  return {
    send,
    forward: (progress: GitCloneProgress) => {
      if (shouldForwardProgress(lastSent, progress, now() - lastSentAt)) send(progress);
    },
    resendLast: () => {
      if (lastSent) send(lastSent);
    },
  };
}

/** Runs the clone. An unexpected exception becomes an `unknown` outcome, so the job never rejects. */
async function cloneOrUnknown(
  runClone: typeof runGitClone,
  input: { repoUrl: string; targetPath: string },
  onProgress: (progress: GitCloneProgress) => void
): Promise<GitCloneOutcome> {
  try {
    return await runClone({ ...input, onProgress });
  } catch (error) {
    return { ok: false, errorCode: 'unknown', errorMessage: getErrorMessage(error) };
  }
}

/**
 * Clones `input` and reports progress and the final result. Never rejects.
 * The keepalive timer is cleared before the result is reported.
 */
export async function runGitCloneJob(
  deps: GitCloneJobDeps,
  input: { repoUrl: string; targetPath: string }
): Promise<void> {
  const progress = createProgressReporter(deps.reportProgress, deps.now ?? Date.now);

  // The first report moves the row from pending to cloning.
  progress.send({ phase: 'Starting' });
  const keepalive = (deps.setIntervalFn ?? setInterval)(
    progress.resendLast,
    GIT_CLONE_KEEPALIVE_MS
  );

  const outcome = await cloneOrUnknown(
    deps.runClone ?? runGitClone,
    input,
    progress.forward
  ).finally(() => clearInterval(keepalive));

  await reportResultWithRetry(deps, toResultReport(outcome));
}
