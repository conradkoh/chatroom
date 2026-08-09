// fallow-ignore-file code-duplication
import { Effect } from 'effect';

import { runIncrementalSubscribeLive } from '../../../../infrastructure/incremental-sync/feed-runtime.js';
import {
  DAEMON_ORCHESTRATION_INTENTS_FEED_BUFFER,
  DAEMON_ORCHESTRATION_INTENTS_FEED_LIMIT,
  daemonOrchestrationIntentsFeedDef,
  daemonOrchestrationIntentsSubscribeTarget,
} from '../../../../infrastructure/incremental-sync/feeds/daemon-orchestration-intents.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

/**
 * P7 user-message intent subscriber. User-intent inbound: pulls lean intent rows
 * for the machine and wakes delivery via the local handler. Only registered when
 * DAEMON_ORCHESTRATION_P7 is enabled.
 */
export function startDaemonOrchestrationIntentsSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let stopped = false;

  const startPromise = Effect.runPromise(
    runIncrementalSubscribeLive({
      wsClient: deps.wsClient,
      def: daemonOrchestrationIntentsFeedDef,
      target: daemonOrchestrationIntentsSubscribeTarget,
      args: { sessionId: deps.sessionId, machineId: deps.machineId },
      buffer: DAEMON_ORCHESTRATION_INTENTS_FEED_BUFFER,
      subscribe: { limit: DAEMON_ORCHESTRATION_INTENTS_FEED_LIMIT },
      onItem: ({ item, ack }) =>
        Effect.sync(() => {
          if (stopped) return;
          ack();
          onEvent({
            type: 'user-message.intent',
            chatroomId: item.chatroomId,
            taskId: item.taskId,
            role: item.role,
            revisionKey: item.revisionKey,
            intentType: item.intentType,
            agentHarness: item.agentHarness,
            workingDir: item.workingDir,
            model: item.model,
            createdAt: item.createdAt,
          });
        }),
      onError: (err) => {
        console.warn(`[daemon] daemon-orchestration-intents subscriber error: ${String(err)}`);
      },
    })
  );

  let feedHandle: Awaited<typeof startPromise> | undefined;
  void startPromise.then((handle) => {
    feedHandle = handle;
  });

  return {
    async stop() {
      stopped = true;
      const handle = feedHandle ?? (await startPromise);
      await Effect.runPromise(handle.stop());
    },
  };
}
