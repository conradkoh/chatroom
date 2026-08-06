/**
 * File Content Subscription — drain pending file content requests on v2 inbound nudges.
 *
 * Legacy WS `onUpdate` removed in U13; v2 `file-content-request` subscriber is the sole listener.
 */

import { Effect } from 'effect';

import { fulfillFileContentRequestsEffect } from './file-content-fulfillment.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';

export async function drainPendingFileContentRequests(
  session: DaemonSessionServiceShape
): Promise<void> {
  await Effect.runPromise(
    fulfillFileContentRequestsEffect.pipe(Effect.provideService(DaemonSessionService, session))
  );
}

/** Handle returned by `startFileContentSubscription` (coordinator init only; no WS). */
export interface FileContentSubscriptionHandle {
  stop: () => void;
}

export const startFileContentSubscriptionEffect = (): Effect.Effect<
  FileContentSubscriptionHandle,
  never,
  DaemonSessionService
> =>
  Effect.sync(() => ({
    stop: () => {},
  }));
