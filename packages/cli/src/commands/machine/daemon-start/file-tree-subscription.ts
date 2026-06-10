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

import { DaemonContextService } from './daemon-context-service.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { scanFileTree } from '../../../infrastructure/services/workspace/file-tree-scanner.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startFileTreeSubscription` to stop the subscription. */
export interface FileTreeSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

/**
 * Start the reactive file tree subscription.
 *
 * Subscribes to `api.workspaceFiles.getPendingFileTreeRequests` via the Convex
 * WebSocket client. When new pending requests appear, they are fulfilled immediately.
 */
export function startFileTreeSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient
): FileTreeSubscriptionHandle {
  let processing = false;

  const unsubscribe = wsClient.onUpdate(
    api.workspaceFiles.getPendingFileTreeRequests,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    (requests) => {
      if (!requests || requests.length === 0) return;
      if (processing) return;

      processing = true;
      fulfillFileTreeRequests(ctx, requests)
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
}

/**
 * Fulfill pending file tree requests by scanning and uploading.
 */
async function fulfillFileTreeRequests(
  ctx: DaemonContext,
  requests: { _id: string; workingDir: string }[]
): Promise<void> {
  for (const request of requests) {
    try {
      const tree = await scanFileTree(request.workingDir);
      const treeJson = JSON.stringify(tree);
      const treeHash = createHash('md5').update(treeJson).digest('hex');

      // Compress the tree JSON for efficient transport
      const compressed = gzipSync(Buffer.from(treeJson));
      const treeJsonCompressed = compressed.toString('base64');

      // Upload the tree (v2: compressed only)
      await ctx.deps.backend.mutation(api.workspaceFiles.syncFileTreeV2, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        workingDir: request.workingDir,
        data: { compression: 'gzip' as const, content: treeJsonCompressed },
        dataHash: treeHash,
        scannedAt: tree.scannedAt,
      });

      // Mark request as fulfilled
      await ctx.deps.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        workingDir: request.workingDir,
      });

      console.log(
        `[${formatTimestamp()}] 🌳 File tree fulfilled: ${request.workingDir} (${tree.entries.length} entries, ${(Buffer.byteLength(treeJson) / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB gzip)`
      );
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  File tree fulfillment failed for ${request.workingDir}: ${getErrorMessage(err)}`
      );
    }
  }
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for startFileTreeSubscription — yields DaemonContextService and delegates. */
// fallow-ignore-next-line unused-export
export const startFileTreeSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<FileTreeSubscriptionHandle, never, DaemonContextService> =>
  Effect.gen(function* () {
    const ctx = yield* DaemonContextService;
    return startFileTreeSubscription(ctx, wsClient);
  });
