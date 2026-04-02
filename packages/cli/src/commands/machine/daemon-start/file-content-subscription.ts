/**
 * File Content Subscription — reactive subscription for on-demand file content requests.
 *
 * Subscribes to `api.workspaceFiles.getPendingFileContentRequests` via Convex WebSocket,
 * processing requests instantly when they appear (replacing the previous heartbeat-based
 * 30-second polling loop).
 *
 * When a user selects a file in the Cmd+P dialog, the frontend creates a pending request.
 * This subscription picks it up reactively and reads/uploads the file content within
 * milliseconds instead of waiting for the next heartbeat.
 */

import type { ConvexClient } from 'convex/browser';

import { fulfillFileContentRequests } from './file-content-fulfillment.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startFileContentSubscription` to stop the subscription. */
export interface FileContentSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

/**
 * Start the reactive file content subscription.
 *
 * Subscribes to `api.workspaceFiles.getPendingFileContentRequests` via the Convex
 * WebSocket client. When new pending requests appear, they are fulfilled immediately.
 *
 * @param ctx - Daemon context (session, machineId, deps)
 * @param wsClient - Convex WebSocket client for reactive subscriptions
 */
export function startFileContentSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient
): FileContentSubscriptionHandle {
  // Track whether we're currently processing to avoid overlapping batches
  let processing = false;

  const unsubscribe = wsClient.onUpdate(
    api.workspaceFiles.getPendingFileContentRequests,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    (requests) => {
      if (!requests || requests.length === 0) return;
      if (processing) return; // Skip if still processing previous batch

      processing = true;
      fulfillFileContentRequests(ctx)
        .catch((err: unknown) => {
          console.warn(
            `[${formatTimestamp()}] ⚠️  File content subscription processing failed: ${getErrorMessage(err)}`
          );
        })
        .finally(() => {
          processing = false;
        });
    },
    (err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  File content subscription error: ${getErrorMessage(err)}`
      );
    }
  );

  console.log(
    `[${formatTimestamp()}] 📂 File content subscription started (reactive)`
  );

  return {
    stop: () => {
      unsubscribe();
      console.log(`[${formatTimestamp()}] 📂 File content subscription stopped`);
    },
  };
}
