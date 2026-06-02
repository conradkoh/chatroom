import { extractDiffStatFromShowOutput } from './git-subscription.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import type { GitCommit } from '../../../infrastructure/git/types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { getWorkspacesForMachine } from './workspace-cache.js';

/**
 * Tracks which commit SHAs have already been fetched (or confirmed not-found / error)
 * for each workspace. Key format: `${machineId}::${workingDir}`.
 *
 * Daemon-lifetime cache — never invalidated. The whole point is steady-state
 * caching to avoid re-fetching commit details that are already in the backend.
 */
const seenShas = new Map<string, Set<string>>();

/**
 * Sync commit details for all workspaces registered to this machine.
 *
 * For each workspace, fetches recent commits, queries the backend for any
 * that are missing, and pre-fetches their details (including compressed diffs).
 * Already-seen SHAs are skipped to keep bandwidth low in steady state.
 *
 * @param seenShasMap Optional injection point for tests. When not supplied,
 *   the module-scope `seenShas` map is used so steady-state caching persists
 *   across heartbeat ticks in production.
 */
export async function syncCommitDetails(
  ctx: DaemonContext,
  seenShasMap?: Map<string, Set<string>>
): Promise<void> {
  const workspaces = await getWorkspacesForMachine(ctx);
  if (workspaces.length === 0) return;

  const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));

  if (uniqueWorkingDirs.size === 0) return;

  for (const workingDir of uniqueWorkingDirs) {
    try {
      await syncSingleWorkspaceCommitDetails(ctx, workingDir, seenShasMap ?? seenShas);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Commit-detail sync failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    }
  }
}

/**
 * Per-workspace commit-detail sync.
 */
async function syncSingleWorkspaceCommitDetails(
  ctx: DaemonContext,
  workingDir: string,
  seenShasMap: Map<string, Set<string>>
): Promise<void> {
  const key = `${ctx.machineId}::${workingDir}`;
  let seen = seenShasMap.get(key);
  if (!seen) {
    seen = new Set<string>();
    seenShasMap.set(key, seen);
  }

  // (a) Fetch recent commits from local git — no DB cost.
  const commits = await gitReader.getRecentCommits(workingDir, COMMITS_PER_PAGE);

  // (b) Filter out already-seen SHAs.
  const candidateShas = commits.map((c) => c.sha).filter((sha) => !seen.has(sha));

  // (c) Steady-state silence: nothing new to fetch.
  if (candidateShas.length === 0) return;

  // (d) Ask backend which of these are missing.
  const missingShas = await ctx.deps.backend.query(api.workspaces.getMissingCommitShasV2, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    shas: candidateShas,
  });

  // (e) SHAs that came back as NOT missing — add to seen set immediately.
  const missingSet = new Set(missingShas);
  for (const sha of candidateShas) {
    if (!missingSet.has(sha)) {
      seen.add(sha);
    }
  }

  // (f) Pre-fetch details for missing SHAs.
  if (missingShas.length === 0) return;

  console.log(
    `[${formatTimestamp()}] 🔍 Pre-fetching ${missingShas.length} commit(s) for ${workingDir}`
  );

  for (const sha of missingShas) {
    try {
      await prefetchSingleCommit(ctx, workingDir, sha, commits);
      // (g) After successful upsert (any terminal status), memoize.
      seen.add(sha);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Pre-fetch failed for ${sha.slice(0, 7)}: ${getErrorMessage(err)}`
      );
    }
  }
}

/**
 * Fetch and upsert a single commit's details.
 *
 * This is moved from git-heartbeat.ts and preserves the original semantics:
 * - `not_found`: upserts with status 'not_found' + metadata from recent-commits list
 * - `error`   : upserts with status 'error' + errorMessage + metadata
 * - `available`: compresses the diff with gzip, computes diffStat, and upserts
 */
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
