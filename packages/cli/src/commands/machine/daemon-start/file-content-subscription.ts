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
import { Effect } from 'effect';

import { DaemonSessionService } from './daemon-services.js';
import {
  fulfillFileContentRequestsCore,
  type FulfillFileContentDeps,
} from './file-content-fulfillment.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startFileContentSubscription` to stop the subscription. */
export interface FileContentSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

// ── Minimal dep type used by Core functions + Effect twins ────────────────────

// FulfillFileContentDeps = { machineId, sessionId: SessionId, backend }
// Re-exported from file-content-fulfillment — reuse the same shape.
type FileContentSubscriptionDeps = FulfillFileContentDeps;

// ── Core implementation (flat deps, no ctx.deps.xxx) ─────────────────────────

function startFileContentSubscriptionCore(
  deps: FileContentSubscriptionDeps,
  wsClient: ConvexClient
): FileContentSubscriptionHandle {
  // Track whether we're currently processing to avoid overlapping batches
  let processing = false;

  const unsubscribe = wsClient.onUpdate(
    api.workspaceFiles.getPendingFileContentRequests,
    {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
    },
    (requests) => {
      if (!requests || requests.length === 0) return;
      if (processing) return; // Skip if still processing previous batch

      processing = true;
      fulfillFileContentRequestsCore(deps)
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

  console.log(`[${formatTimestamp()}] 📂 File content subscription started (reactive)`);

  return {
    stop: () => {
      unsubscribe();
      console.log(`[${formatTimestamp()}] 📂 File content subscription stopped`);
    },
  };
}

// ── Effect twin ───────────────────────────────────────────────────────────────

/**
 * Effect twin for startFileContentSubscription.
 * Yields DaemonSessionService; DaemonSessionServiceShape satisfies FileContentSubscriptionDeps
 * (same shape as FulfillFileContentDeps: sessionId, machineId, backend).
 */
export const startFileContentSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<FileContentSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    return startFileContentSubscriptionCore(session, wsClient);
  });
