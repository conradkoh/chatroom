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
import { fulfillFileContentRequestsEffect } from './file-content-fulfillment.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startFileContentSubscription` to stop the subscription. */
export interface FileContentSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

export const startFileContentSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<FileContentSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    let processing = false;

    const unsubscribe = wsClient.onUpdate(
      api.workspaceFiles.getPendingFileContentRequests,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      (requests) => {
        if (!requests || requests.length === 0) return;
        if (processing) return;

        processing = true;
        Effect.runPromise(
          fulfillFileContentRequestsEffect.pipe(
            Effect.provideService(DaemonSessionService, session)
          )
        )
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
  });
