/**
 * File Tree Subscription — reactive subscription for on-demand file tree requests.
 *
 * Subscribes to `api.workspaceFiles.getPendingFileTreeRequests` via Convex WebSocket,
 * processing requests instantly when they appear. Replaces the previous heartbeat-based
 * push pattern to eliminate ~1GB/day/user of unnecessary bandwidth.
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

/** Handle returned by `startFileTreeSubscription` to stop the subscription. */
export interface FileTreeSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

const fulfillFileTreeRequestsEffect = (
  session: DaemonSessionServiceShape,
  requests: { _id: string; workingDir: string }[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const request of requests) {
      const startTime = Date.now();
      yield* Effect.catchAll(
        Effect.gen(function* () {
          const tree = yield* Effect.tryPromise(() => scanFileTree(request.workingDir));
          const treeJson = JSON.stringify(tree);
          const treeHash = createHash('md5').update(treeJson).digest('hex');
          const compressed = gzipSync(Buffer.from(treeJson));
          const treeJsonCompressed = compressed.toString('base64');

          yield* Effect.tryPromise(() =>
            session.backend.mutation(api.workspaceFiles.syncFileTreeV2, {
              sessionId: session.sessionId,
              machineId: session.machineId,
              workingDir: request.workingDir,
              data: { compression: 'gzip' as const, content: treeJsonCompressed },
              dataHash: treeHash,
              scannedAt: tree.scannedAt,
            })
          );

          yield* Effect.tryPromise(() =>
            session.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
              sessionId: session.sessionId,
              machineId: session.machineId,
              workingDir: request.workingDir,
            })
          );

          const elapsed = Date.now() - startTime;
          console.log(
            `[${formatTimestamp()}] 🌳 File tree fulfilled: ${request.workingDir} (${tree.entries.length} entries, ${(Buffer.byteLength(treeJson) / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB gzip, ${elapsed}ms)`
          );
        }),
        (err) => {
          console.warn(
            `[${formatTimestamp()}] ⚠️  File tree fulfillment failed for ${request.workingDir}: ${getErrorMessage(err)}`
          );
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
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      (requests) => {
        if (!requests || requests.length === 0) return;
        if (processing) return;

        processing = true;
        Effect.runPromise(fulfillFileTreeRequestsEffect(session, requests))
          .catch((err: unknown) => {
            console.warn(
              `[${formatTimestamp()}] ⚠️  File tree subscription processing failed: ${getErrorMessage(err)}`
            );
          })
          .finally(() => {
            processing = false;
          });
      },
      (err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️  File tree subscription error: ${getErrorMessage(err)}`
        );
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
