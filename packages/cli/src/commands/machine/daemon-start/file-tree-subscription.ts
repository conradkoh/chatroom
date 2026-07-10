/**
 * File Tree Subscription — reactive subscription for on-demand file tree requests.
 *
 * Subscribes to `api.workspaceFiles.getPendingFileTreeRequests` via Convex WebSocket,
 * scanning the workspace and uploading via `syncFileTreeV2` when requests appear.
 */

import { gzipSync } from 'node:zlib';

import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { isGitRepo } from '../../../infrastructure/git/git-reader.js';
import { computeFileTreeDataHash } from '../../../infrastructure/services/workspace/file-tree-data-hash.js';
import { shouldUseV3Upload } from '../../../infrastructure/services/workspace/file-tree-partition.js';
import { scanFileTree } from '../../../infrastructure/services/workspace/file-tree-scanner.js';
import { uploadFileTreeV3 } from '../../../infrastructure/services/workspace/file-tree-v3-upload.js';
import { normalizeWorkingDirForLookup } from '../../../infrastructure/services/workspace/normalize-working-dir.js';
import {
  diffPathIndexes,
  formatPathDiffSummary,
} from '../../../infrastructure/services/workspace/workspace-sync-diff.js';
import { enqueueFileTreeSync } from '../../../infrastructure/services/workspace/workspace-sync-queue.js';
import {
  buildPathIndex,
  createManifestFromTree,
  loadWorkspaceSyncManifest,
  saveWorkspaceSyncManifest,
} from '../../../infrastructure/services/workspace/workspace-sync-state.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

function logSubscriptionWarn(label: string, err: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${label}: ${getErrorMessage(err)}`);
}

export interface FileTreeSubscriptionHandle {
  stop: () => void;
}

async function syncScannedFileTree(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string,
  tree: Awaited<ReturnType<typeof scanFileTree>>,
  dataHash: string,
  syncGeneration: string
): Promise<void> {
  if (shouldUseV3Upload(tree)) {
    await uploadFileTreeV3(session, normalizedWorkingDir, tree, syncGeneration);
    return;
  }
  const treeJson = JSON.stringify(tree);
  const compressed = gzipSync(Buffer.from(treeJson)).toString('base64');
  await session.backend.mutation(api.workspaceFiles.syncFileTreeV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir: normalizedWorkingDir,
    data: { compression: 'gzip', content: compressed },
    dataHash,
    scannedAt: tree.scannedAt,
  });
}

// fallow-ignore-next-line complexity
async function uploadFileTree(
  session: DaemonSessionServiceShape,
  workingDir: string
): Promise<void> {
  const normalizedWorkingDir = normalizeWorkingDirForLookup(workingDir);

  const previousManifest = await loadWorkspaceSyncManifest(session.machineId, normalizedWorkingDir);

  const tree = await scanFileTree(normalizedWorkingDir);
  const dataHash = computeFileTreeDataHash(tree);

  if (previousManifest?.dataHash === dataHash) {
    await session.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      workingDir: normalizedWorkingDir,
    });
    console.log(
      `[${formatTimestamp()}] 🌳 File tree unchanged, skipped upload: ${normalizedWorkingDir}`
    );
    return;
  }

  const pathDiff = diffPathIndexes(previousManifest?.paths, buildPathIndex(tree.entries));
  if (previousManifest) {
    console.log(
      `[${formatTimestamp()}] 🌳 File tree diff: ${formatPathDiffSummary(pathDiff)} (${normalizedWorkingDir})`
    );
  }

  const scanner = (await isGitRepo(normalizedWorkingDir)) ? 'git' : 'filesystem';
  const manifest = createManifestFromTree({
    machineId: session.machineId,
    workingDir: normalizedWorkingDir,
    scanner,
    dataHash,
    tree,
  });

  await syncScannedFileTree(session, normalizedWorkingDir, tree, dataHash, manifest.syncGeneration);

  await session.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir: normalizedWorkingDir,
  });

  await saveWorkspaceSyncManifest(manifest);
}

export const startFileTreeSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<FileTreeSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    const unsubscribe = wsClient.onUpdate(
      api.workspaceFiles.getPendingFileTreeRequests,
      { sessionId: session.sessionId, machineId: session.machineId },
      (requests) => {
        if (!requests?.length) return;

        const uniqueDirs = [
          ...new Set(requests.map((r) => normalizeWorkingDirForLookup(r.workingDir))),
        ];

        for (const workingDir of uniqueDirs) {
          const normalized = normalizeWorkingDirForLookup(workingDir);
          void enqueueFileTreeSync(session.machineId, normalized, () => {
            const start = Date.now();
            return uploadFileTree(session, normalized)
              .then(() => {
                console.log(
                  `[${formatTimestamp()}] 🌳 File tree fulfilled: ${normalized} (${Date.now() - start}ms)`
                );
              })
              .catch((err: unknown) => {
                logSubscriptionWarn(`File tree failed for ${normalized}`, err);
              });
          }).catch((err: unknown) => {
            logSubscriptionWarn('File tree queue drain failed', err);
          });
        }
      },
      (err: unknown) => {
        logSubscriptionWarn('File tree subscription error', err);
      }
    );

    console.log(`[${formatTimestamp()}] 🌳 File tree subscription started (reactive)`);

    return {
      stop: () => {
        unsubscribe();
        console.log(`[${formatTimestamp()}] 🌳 File tree subscription stopped`);
      },
    };
  });
