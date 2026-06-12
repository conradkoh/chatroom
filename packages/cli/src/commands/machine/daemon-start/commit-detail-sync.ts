import { Effect } from 'effect';

import { DaemonSessionService } from './daemon-services.js';
import { extractDiffStatFromShowOutput } from './git-subscription.js';
import type { SessionId, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { getWorkspacesForMachine } from './workspace-cache.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { COMMITS_PER_PAGE } from '../../../infrastructure/git/types.js';
import type { GitCommit } from '../../../infrastructure/git/types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/**
 * Tracks which commit SHAs have already been fetched (or confirmed not-found / error)
 * for each workspace. Key format: `${machineId}::${workingDir}`.
 *
 * Daemon-lifetime cache — never invalidated. The whole point is steady-state
 * caching to avoid re-fetching commit details that are already in the backend.
 */
const seenShas = new Map<string, Set<string>>();

// ── Minimal dep type used by Core functions + Effect twins ────────────────────

type SyncCommitDetailsDeps = {
  machineId: string;
  sessionId: SessionId;
  backend: BackendOps;
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
};

// ── Core implementations (flat deps, no ctx.deps.xxx) ─────────────────────────

/**
 * Sync commit details for all workspaces registered to this machine.
 *
 * @param seenShasMap Optional injection point for tests. When not supplied,
 *   the module-scope `seenShas` map is used so steady-state caching persists
 *   across heartbeat ticks in production.
 */
async function syncCommitDetailsCore(
  ctx: SyncCommitDetailsDeps,
  seenShasMap?: Map<string, Set<string>>
): Promise<void> {
  const workspaces = await getWorkspacesForMachine({
    workspaceListStore: ctx.workspaceListStore,
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    backend: ctx.backend,
  });
  if (workspaces.length === 0) return;

  const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));
  if (uniqueWorkingDirs.size === 0) return;

  for (const workingDir of uniqueWorkingDirs) {
    try {
      await syncSingleWorkspaceCommitDetailsCore(ctx, workingDir, seenShasMap ?? seenShas);
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
async function syncSingleWorkspaceCommitDetailsCore(
  ctx: SyncCommitDetailsDeps,
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
  const missingShas = await ctx.backend.query(api.workspaces.getMissingCommitShasV2, {
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
      await prefetchSingleCommitCore(ctx, workingDir, sha, commits);
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
 */
async function prefetchSingleCommitCore(
  ctx: SyncCommitDetailsDeps,
  workingDir: string,
  sha: string,
  commits: GitCommit[]
): Promise<void> {
  const metadata = commits.find((c) => c.sha === sha);
  const result = await gitReader.getCommitDetail(workingDir, sha);

  if (result.status === 'not_found') {
    await ctx.backend.mutation(api.workspaces.upsertCommitDetailV2, {
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
    await ctx.backend.mutation(api.workspaces.upsertCommitDetailV2, {
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

  await ctx.backend.mutation(api.workspaces.upsertCommitDetailV2, {
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

// ── Public wrapper (backward-compat — old call sites in command-loop.ts) ──────

// ── Effect twin ───────────────────────────────────────────────────────────────

/** Effect twin for syncCommitDetails — yields DaemonSessionService; DaemonSessionServiceShape satisfies SyncCommitDetailsDeps. */
export const syncCommitDetailsEffect = (
  seenShasMap?: Map<string, Set<string>>
): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() => syncCommitDetailsCore(session, seenShasMap));
  });
