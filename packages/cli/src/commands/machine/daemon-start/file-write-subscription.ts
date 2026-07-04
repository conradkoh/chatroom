/**
 * File Write Subscription — reactive subscription for on-demand file write requests.
 *
 * Subscribes to `api.workspaceFiles.getPendingFileWriteRequests` via Convex WebSocket,
 * processing requests instantly when they appear (mirrors file-content-subscription.ts).
 */
// fallow-ignore-file code-duplication

import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';

import { DaemonSessionService } from './daemon-services.js';
import { fulfillFileWriteRequestsEffect } from './file-write-fulfillment.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startFileWriteSubscription` to stop the subscription. */
export interface FileWriteSubscriptionHandle {
  /** Stop the subscription and clean up. */
  stop: () => void;
}

export const startFileWriteSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<FileWriteSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    let processing = false;

    const unsubscribe = wsClient.onUpdate(
      api.workspaceFiles.getPendingFileWriteRequests,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      (requests) => {
        if (!requests || requests.length === 0) return;
        if (processing) return;

        processing = true;
        Effect.runPromise(
          fulfillFileWriteRequestsEffect.pipe(Effect.provideService(DaemonSessionService, session))
        )
          .catch((err: unknown) => {
            console.warn(
              `[${formatTimestamp()}] ⚠️  File write subscription processing failed: ${getErrorMessage(err)}`
            );
          })
          .finally(() => {
            processing = false;
          });
      },
      (err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️  File write subscription error: ${getErrorMessage(err)}`
        );
      }
    );

    console.log(`[${formatTimestamp()}] ✏️  File write subscription started (reactive)`);

    return {
      stop: () => {
        unsubscribe();
        console.log(`[${formatTimestamp()}] ✏️  File write subscription stopped`);
      },
    };
  });
