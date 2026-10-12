/**
 * Remote workspace-state unit collector.
 *
 * Reads open pull requests and commit status checks from GitHub through `gh`, and maps them to
 * the `pullRequests` and `checks` units. Pure over the S3b result-typed readers: no state, no
 * timers, no decision about whether to send a unit.
 */
import {
  readCommitStatusChecks,
  readOpenPRsForBranch,
  type CommitStatusCheck,
} from '../../../infrastructure/git/git-reader.js';
import type { GitPullRequest } from '../../../infrastructure/git/types.js';
import type { WorkspaceStateUnit } from '../../../infrastructure/outbox/workspace-state-outbox-schema.js';

type UnitOf<K extends WorkspaceStateUnit['kind']> = Extract<WorkspaceStateUnit, { kind: K }>;
type PullRequestEntry = UnitOf<'pullRequests'>['openPullRequests'][number];
type ChecksUnitStatus = UnitOf<'checks'>['headCommitStatus'];

export type RemoteCollectResult =
  | { ok: true; units: [WorkspaceStateUnit, WorkspaceStateUnit]; checksState: string | null }
  | { ok: false; error: string };

/**
 * Reads open PRs for `branch` and commit status checks for `branch`, returning
 * `units` as `[pullRequestsUnit, checksUnit]`.
 *
 * Constraints:
 * - Any reader returning `ok:false` makes the whole result `ok:false`. A failed read says nothing
 *   about the remote state, so the caller keeps its last-known values instead of publishing an
 *   empty list or a null status.
 * - The checks ref is `branch`, the same value the git heartbeat has always passed. GitHub resolves
 *   a branch name to its head commit in the `commits/<ref>` endpoint.
 * - `checksState` is the aggregate state from the reader, or null when there are no check runs.
 *   The monitor reads it to choose the `pending` polling cadence.
 */
export async function collectRemoteUnits(
  workingDir: string,
  branch: string
): Promise<RemoteCollectResult> {
  const [prs, checks] = await Promise.all([
    readOpenPRsForBranch(workingDir, branch),
    readCommitStatusChecks(workingDir, branch),
  ]);
  if (!prs.ok) return { ok: false, error: prs.error };
  if (!checks.ok) return { ok: false, error: checks.error };

  return {
    ok: true,
    units: [
      { kind: 'pullRequests', openPullRequests: prs.value.flatMap(toPullRequestEntry) },
      { kind: 'checks', headCommitStatus: toChecksStatus(checks.value) },
    ],
    checksState: checksStateOf(checks.value),
  };
}

/**
 * The reader always sets `prNumber`, but `GitPullRequest` types it as optional. A PR without a
 * number cannot be represented in the `pullRequests` schema, so it is dropped rather than
 * published with an invalid value.
 */
function toPullRequestEntry(pr: GitPullRequest): PullRequestEntry[] {
  if (pr.prNumber === undefined) return [];
  return [
    {
      prNumber: pr.prNumber,
      title: pr.title,
      url: pr.url,
      headRefName: pr.headRefName,
      state: pr.state,
    },
  ];
}

/** Copies the wire fields only. `null` (no origin repo) passes through unchanged. */
function toChecksStatus(status: CommitStatusCheck | null): ChecksUnitStatus {
  if (status === null) return null;
  return {
    state: status.state,
    totalCount: status.totalCount,
    checkRuns: status.checkRuns.map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
    })),
  };
}

/**
 * Aggregate state for the monitor's polling cadence. The reader's `state` is already the
 * aggregate of every run, so it is reused rather than recomputed. With no runs, the reader
 * still reports `success`, which would be misleading, so this returns null instead.
 */
function checksStateOf(status: CommitStatusCheck | null): string | null {
  if (status === null || status.totalCount === 0) return null;
  return status.state;
}
