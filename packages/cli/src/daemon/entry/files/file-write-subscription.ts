/**
 * File Write Subscription — drain pending file write requests on v2 inbound nudges.
 *
 * Legacy WS `onUpdate` removed in U13; v2 `file-write-request` subscriber is the sole listener.
 */
// fallow-ignore-file code-duplication

import { Effect } from 'effect';

import { fulfillFileWriteRequestsEffect } from './file-write-fulfillment.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';

export async function drainPendingFileWriteRequests(
  session: DaemonSessionServiceShape
): Promise<void> {
  await Effect.runPromise(
    fulfillFileWriteRequestsEffect.pipe(Effect.provideService(DaemonSessionService, session))
  );
}

/** Handle returned by `startFileWriteSubscription` (no WS). */
export interface FileWriteSubscriptionHandle {
  stop: () => void;
}

export const startFileWriteSubscriptionEffect = (): Effect.Effect<
  FileWriteSubscriptionHandle,
  never,
  DaemonSessionService
> =>
  Effect.sync(() => ({
    stop: () => {},
  }));
