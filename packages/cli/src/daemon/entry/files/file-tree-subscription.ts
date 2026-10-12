/**
 * File Tree Subscription — request and lease adapter for workspace file-tree synchronization.
 *
 * Reads pending file-tree requests and release requests from the backend, then drives the
 * per-directory file-tree host owned by `WorkspaceService.fileTree`. The host owns coordinators
 * and outbox registries; this adapter only decides which host call a request needs.
 */

import { Effect } from 'effect';

import { api } from '../../../api.js';
import { normalizeWorkingDirForLookup } from '../../../infrastructure/services/workspace/normalize-working-dir.js';
import { enqueueFileTreeSync } from '../../../infrastructure/services/workspace/workspace-sync-queue.js';
import { getErrorMessage, isFileTreeSyncDisabledError } from '../../../utils/convex-error.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';
import { formatTimestamp } from '../daemon-utils.js';

type FileTreeHost = DaemonSessionServiceShape['workspaceService']['fileTree'];

function logSubscriptionWarn(label: string, err: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${label}: ${getErrorMessage(err)}`);
}

export interface FileTreeSubscriptionHandle {
  drainPendingFileTreeRequests: () => Promise<void>;
  drainPendingFileTreeReleaseRequests: () => Promise<void>;
}

// fallow-ignore-next-line complexity
async function drainPendingFileTreeReleaseRequests(
  session: DaemonSessionServiceShape,
  fileTree: FileTreeHost
): Promise<void> {
  // Backend returns at most 50 pending rows per query; drain until empty.
  while (true) {
    const releases = await session.backend.query(
      api.workspaceFiles.getPendingFileTreeReleaseRequests,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      }
    );
    if (!releases?.length) return;

    const releasesByDir = new Set<string>();
    for (const release of releases) {
      releasesByDir.add(normalizeWorkingDirForLookup(release.workingDir));
    }

    let successCount = 0;
    for (const normalized of releasesByDir) {
      try {
        await fileTree.disable(normalized);
        await session.backend.mutation(api.workspaceFiles.fulfillFileTreeReleaseRequest, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          workingDir: normalized,
        });
        successCount++;
      } catch (err: unknown) {
        logSubscriptionWarn(`File tree release failed for ${normalized}`, err);
      }
    }

    // Avoid infinite retry when every fulfill in a non-empty batch fails.
    if (successCount === 0) return;
  }
}

// fallow-ignore-next-line complexity
async function processOnePendingFileTreeRequest(
  session: DaemonSessionServiceShape,
  fileTree: FileTreeHost,
  normalized: string,
  force: boolean
): Promise<void> {
  const start = Date.now();
  const lease = await session.backend.query(api.workspaceFiles.getFileTreeWatchLease, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir: normalized,
  });
  if (!lease?.leaseActive) {
    await fileTree.stop(normalized);
    await fileTree.oneShot(normalized);
    console.log(
      `[${formatTimestamp()}] 🌳 File tree ready: ${normalized} (${Date.now() - start}ms, one-shot)`
    );
    return;
  }

  await fileTree.ensure(normalized, { forceReconcile: force });
  await session.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir: normalized,
  });
  const leaseAfterFulfill = await session.backend.query(api.workspaceFiles.getFileTreeWatchLease, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir: normalized,
  });
  if (!leaseAfterFulfill?.leaseActive) {
    await fileTree.stop(normalized);
  }
  console.log(
    `[${formatTimestamp()}] 🌳 File tree ready: ${normalized} (${Date.now() - start}ms${force ? ', reconciled' : ', cached'})`
  );
}

// fallow-ignore-next-line complexity
async function processPendingFileTreeRequests(
  session: DaemonSessionServiceShape,
  fileTree: FileTreeHost,
  requests: { workingDir: string; force?: boolean | undefined }[] | null | undefined
): Promise<void> {
  if (!requests?.length) return;

  const requestsByDir = new Map<string, boolean>();
  for (const request of requests) {
    const normalized = normalizeWorkingDirForLookup(request.workingDir);
    requestsByDir.set(normalized, requestsByDir.get(normalized) === true || request.force === true);
  }

  for (const [normalized, force] of requestsByDir) {
    await enqueueFileTreeSync(session.machineId, normalized, async () => {
      try {
        await processOnePendingFileTreeRequest(session, fileTree, normalized, force);
      } catch (err: unknown) {
        if (isFileTreeSyncDisabledError(err)) {
          await fileTree.disable(normalized);
          return;
        }
        logSubscriptionWarn(`File tree failed for ${normalized}`, err);
      }
    });
  }
}

// fallow-ignore-next-line unused-export
export async function drainPendingFileTreeRequests(
  session: DaemonSessionServiceShape,
  fileTree: FileTreeHost
): Promise<void> {
  const requests = await session.backend.query(api.workspaceFiles.getPendingFileTreeRequests, {
    sessionId: session.sessionId,
    machineId: session.machineId,
  });
  await processPendingFileTreeRequests(session, fileTree, requests);
}

export const startFileTreeSubscriptionEffect = (): Effect.Effect<
  FileTreeSubscriptionHandle,
  never,
  DaemonSessionService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const fileTree = session.workspaceService.fileTree;
    return {
      drainPendingFileTreeRequests: () => drainPendingFileTreeRequests(session, fileTree),
      drainPendingFileTreeReleaseRequests: () =>
        drainPendingFileTreeReleaseRequests(session, fileTree),
    };
  });
