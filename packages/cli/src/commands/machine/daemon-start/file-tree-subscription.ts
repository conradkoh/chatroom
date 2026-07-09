/**
 * File Tree Subscription — reactive subscription for on-demand file tree requests.
 *
 * Subscribes to `api.workspaceFiles.getPendingFileTreeRequests` via Convex WebSocket,
 * scanning the workspace and uploading via `syncFileTreeV2` when requests appear.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { scanFileTree } from '../../../infrastructure/services/workspace/file-tree-scanner.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

function logSubscriptionWarn(label: string, err: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${label}: ${getErrorMessage(err)}`);
}

export interface FileTreeSubscriptionHandle {
  stop: () => void;
}

async function uploadFileTree(
  session: DaemonSessionServiceShape,
  workingDir: string
): Promise<void> {
  const tree = await scanFileTree(workingDir);
  const treeJson = JSON.stringify(tree);
  const dataHash = createHash('md5').update(treeJson).digest('hex');
  const compressed = gzipSync(Buffer.from(treeJson)).toString('base64');

  await session.backend.mutation(api.workspaceFiles.syncFileTreeV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    data: { compression: 'gzip', content: compressed },
    dataHash,
    scannedAt: tree.scannedAt,
  });

  await session.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
  });
}

const fulfillFileTreeRequestsEffect = (
  session: DaemonSessionServiceShape,
  requests: { _id: string; workingDir: string }[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const request of requests) {
      yield* Effect.catchAll(
        Effect.gen(function* () {
          const start = Date.now();
          yield* Effect.tryPromise(() => uploadFileTree(session, request.workingDir));
          console.log(
            `[${formatTimestamp()}] 🌳 File tree fulfilled: ${request.workingDir} (${Date.now() - start}ms)`
          );
        }),
        (err) => {
          logSubscriptionWarn(`File tree failed for ${request.workingDir}`, err);
          return Effect.void;
        }
      );
    }
  });

export const startFileTreeSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<FileTreeSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    let processing = false;

    const unsubscribe = wsClient.onUpdate(
      api.workspaceFiles.getPendingFileTreeRequests,
      { sessionId: session.sessionId, machineId: session.machineId },
      (requests) => {
        if (!requests?.length || processing) return;
        processing = true;
        Effect.runPromise(fulfillFileTreeRequestsEffect(session, requests))
          .catch((err: unknown) => {
            logSubscriptionWarn('File tree subscription processing failed', err);
          })
          .finally(() => {
            processing = false;
          });
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
