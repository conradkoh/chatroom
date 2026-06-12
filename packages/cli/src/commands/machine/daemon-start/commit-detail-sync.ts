import { gzipSync } from 'node:zlib';

import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { extractDiffStatFromShowOutput } from './git-subscription.js';
import { formatTimestamp } from './utils.js';
import { getWorkspacesForMachine } from './workspace-cache.js';
import { api } from '../../../api.js';
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

/** Shared upsert args builder — reduces repetition across status branches. */
function upsertCommitDetailArgs(
  session: DaemonSessionServiceShape,
  workingDir: string,
  sha: string,
  metadata: GitCommit | undefined,
  overrides: Record<string, unknown>
) {
  return {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    sha,
    message: metadata?.message,
    body: metadata?.body,
    author: metadata?.author,
    date: metadata?.date,
    ...overrides,
  };
}

/**
 * Per-sha prefetch of commit details. Extracted to keep `syncCommitDetailsEffect` under size limits.
 */
const prefetchSingleShaEffect = (
  session: DaemonSessionServiceShape,
  workingDir: string,
  sha: string,
  commits: GitCommit[]
): Effect.Effect<void, never, never> =>
  Effect.catchAll(
    Effect.gen(function* () {
      const metadata = commits.find((c) => c.sha === sha);
      const result = yield* Effect.tryPromise(() => gitReader.getCommitDetail(workingDir, sha));

      if (result.status === 'not_found') {
        yield* Effect.tryPromise(() =>
          session.backend.mutation(
            api.workspaces.upsertCommitDetailV2,
            upsertCommitDetailArgs(session, workingDir, sha, metadata, { status: 'not_found' })
          )
        );
        return;
      }

      if (result.status === 'error') {
        yield* Effect.tryPromise(() =>
          session.backend.mutation(
            api.workspaces.upsertCommitDetailV2,
            upsertCommitDetailArgs(session, workingDir, sha, metadata, {
              status: 'error',
              errorMessage: result.message,
            })
          )
        );
        return;
      }

      const diffStat = extractDiffStatFromShowOutput(result.content);
      const compressed = gzipSync(Buffer.from(result.content));
      const diffContentCompressed = compressed.toString('base64');

      yield* Effect.tryPromise(() =>
        session.backend.mutation(
          api.workspaces.upsertCommitDetailV2,
          upsertCommitDetailArgs(session, workingDir, sha, metadata, {
            status: 'available',
            data: { compression: 'gzip' as const, content: diffContentCompressed },
            truncated: result.truncated,
            diffStat,
          })
        )
      );

      console.log(`[${formatTimestamp()}] ✅ Pre-fetched: ${sha.slice(0, 7)} in ${workingDir}`);
    }),
    (err) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Pre-fetch failed for ${sha.slice(0, 7)}: ${getErrorMessage(err)}`
      );
      return Effect.void;
    }
  );

export const syncCommitDetailsEffect = (
  seenShasMap?: Map<string, Set<string>>
): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

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

    const shasMap = seenShasMap ?? seenShas;

    for (const workingDir of uniqueWorkingDirs) {
      yield* Effect.catchAll(
        Effect.gen(function* () {
          const key = `${session.machineId}::${workingDir}`;
          let seen = shasMap.get(key);
          if (!seen) {
            seen = new Set<string>();
            shasMap.set(key, seen);
          }

          const commits = yield* Effect.tryPromise(() =>
            gitReader.getRecentCommits(workingDir, COMMITS_PER_PAGE)
          );

          const candidateShas = commits.map((c) => c.sha).filter((sha) => !seen.has(sha));
          if (candidateShas.length === 0) return;

          const missingShas = yield* Effect.tryPromise(() =>
            session.backend.query(api.workspaces.getMissingCommitShasV2, {
              sessionId: session.sessionId,
              machineId: session.machineId,
              workingDir,
              shas: candidateShas,
            })
          );

          const missingSet = new Set(missingShas);
          for (const sha of candidateShas) {
            if (!missingSet.has(sha)) {
              seen.add(sha);
            }
          }

          if (missingShas.length === 0) return;

          console.log(
            `[${formatTimestamp()}] 🔍 Pre-fetching ${missingShas.length} commit(s) for ${workingDir}`
          );

          for (const sha of missingShas) {
            yield* prefetchSingleShaEffect(session, workingDir, sha, commits);
            seen.add(sha);
          }
        }),
        (err) =>
          Effect.sync(() => {
            console.warn(
              `[${formatTimestamp()}] ⚠️  Commit-detail sync failed for ${workingDir}: ${getErrorMessage(err)}`
            );
          })
      );
    }
  });
